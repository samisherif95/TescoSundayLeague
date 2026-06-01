import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { assertCronAuth } from "@/lib/cron";
import { MIN_PLAYERS, nextSundayNoon } from "@/lib/game";
import { sendEmail } from "@/lib/email";
import { lockGame } from "@/lib/lock";
import { openWeeklyGame } from "@/lib/weekly-game";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await assertCronAuth(req);
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const now = new Date();
  const upcoming = await prisma.game.findMany({
    where: {
      status: GameStatus.OPEN,
      kickoffAt: { gte: now },
    },
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        include: {
          user: { select: { email: true } },
        },
      },
    },
  });

  const results: Array<{
    gameId: string;
    outcome: "LOCKED" | "CANCELLED" | "SKIPPED";
    nextGameId?: string;
    error?: string;
  }> = [];

  for (const game of upcoming) {
    const confirmed = game.signups;
    if (confirmed.length < MIN_PLAYERS) {
      await prisma.game.update({
        where: { id: game.id },
        data: { status: GameStatus.CANCELLED },
      });
      // notify everyone
      await Promise.allSettled(
        confirmed
          .map((s) => s.user.email)
          .filter((e): e is string => Boolean(e))
          .map((email) =>
            sendEmail({
              to: email,
              subject: "Sunday football cancelled — not enough players",
              html: `<p>Heads up — only ${confirmed.length}/${MIN_PLAYERS} signed up, so this Sunday's game is cancelled.</p>
                <p>No worries — a fresh game is already open for next Sunday. Sign up early and rope a mate in.</p>`,
            }),
          ),
      );
      // Roll straight on to the following Sunday so the squad can regroup.
      // Idempotent on kickoff, so Monday's cron will just no-op on this game.
      const { gameId: nextGameId } = await openWeeklyGame(
        nextSundayNoon(game.kickoffAt),
      );
      results.push({ gameId: game.id, outcome: "CANCELLED", nextGameId });
      continue;
    }

    // Lock + pick booker + assign duties + generate teams + notify. Shared with
    // the admin "Lock game now" button so the two can never drift apart.
    const locked = await lockGame(game.id);
    if (locked.ok) {
      results.push({ gameId: game.id, outcome: "LOCKED" });
    } else {
      results.push({ gameId: game.id, outcome: "SKIPPED", error: locked.error });
    }
  }

  return NextResponse.json({ results });
}
