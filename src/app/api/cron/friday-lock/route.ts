import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { assertCronAuth } from "@/lib/cron";
import {
  MIN_PLAYERS,
  generateTeams,
  nextSundayNoon,
  pickBooker,
  type BookerCandidate,
} from "@/lib/game";
import { sendEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";
import { assignExtras, isExemptFromDuties } from "@/lib/duties";
import { openWeeklyGame } from "@/lib/weekly-game";
import { env } from "@/lib/env";

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
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              skillScore: true,
            },
          },
        },
      },
    },
  });

  const results: Array<{
    gameId: string;
    outcome: "LOCKED" | "CANCELLED" | "SKIPPED";
    nextGameId?: string;
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

    // Fairly pick the booker: spread the chore by past-booking history.
    // Exempt players are quietly never picked for a duty.
    const eligible = confirmed.filter(
      (s) => !isExemptFromDuties(s.user.email),
    );
    const bookerPool = eligible.length > 0 ? eligible : confirmed;
    // Aggregate each candidate's booking count + last-booked date in the DB
    // rather than pulling every past game and scanning in JS.
    const bookingStats = await prisma.game.groupBy({
      by: ["bookerId"],
      where: {
        bookerId: { in: bookerPool.map((s) => s.user.id) },
        status: { in: [GameStatus.BOOKED, GameStatus.COMPLETED] },
      },
      _count: { _all: true },
      _max: { kickoffAt: true },
    });
    const statByUser = new Map(bookingStats.map((s) => [s.bookerId, s]));
    const candidates: BookerCandidate[] = bookerPool.map((s) => {
      const stat = statByUser.get(s.user.id);
      return {
        userId: s.user.id,
        bookCount: stat?._count._all ?? 0,
        lastBookedAt: stat?._max.kickoffAt ?? null,
      };
    });
    const bookerId = pickBooker(candidates);
    const booker = confirmed.find((s) => s.user.id === bookerId)!.user;

    // Randomly assign who brings the bibs and the football (distinct people).
    const { bibsUserId, footballUserId } = assignExtras(
      confirmed.map((s) => ({ id: s.user.id, email: s.user.email })),
      bookerId,
    );

    // Lock + pick booker + generate teams in a single transaction
    const draftable = confirmed.map((s) => ({
      userId: s.user.id,
      position: s.position,
      skillScore: s.user.skillScore,
    }));
    const teams = generateTeams(draftable);

    await prisma.$transaction(async (tx) => {
      await tx.game.update({
        where: { id: game.id },
        data: {
          status: GameStatus.LOCKED,
          bookerId: booker.id,
          bibsUserId,
          footballUserId,
        },
      });
      // wipe and re-create teams (defensive)
      await tx.team.deleteMany({ where: { gameId: game.id } });
      for (const t of teams) {
        await tx.team.create({
          data: {
            gameId: game.id,
            label: t.label,
            players: {
              create: t.players.map((p) => ({ userId: p.userId })),
            },
          },
        });
      }
    });

    // Notify booker — `booker` already carries name/email from the include above.
    if (booker.email) {
      await sendEmail({
        to: booker.email,
        subject: "You're booking the pitch this Sunday",
        html: `<p>Hi ${booker.name ?? "there"},</p>
          <p>You've been randomly picked to book the pitch for Sunday.</p>
          <p><a href="${env.appUrl}/games/${game.id}/book">Open the booking page</a> — it has the hireapitch.com link and a form to record the total cost. The app will generate Monzo links for everyone else.</p>`,
      }).catch(() => undefined);
    }
    // Notify others
    await Promise.allSettled(
      confirmed
        .filter((s) => s.user.id !== booker.id && s.user.email)
        .map((s) =>
          sendEmail({
            to: s.user.email!,
            subject: "Game locked — teams are out",
            html: `<p>Sunday's lineup is locked. ${booker.name ?? "Someone"} is booking the pitch. <a href="${env.appUrl}/games/${game.id}">See your team</a>.</p>`,
          }),
        ),
    );

    // Push: booker gets the booking nudge, everyone else "teams are out".
    await sendPushToUsers([booker.id], {
      title: "You're booking Sunday ⚽",
      body: "You've been picked to book the pitch. Tap to sort it.",
      url: `/games/${game.id}/book`,
    });
    await sendPushToUsers(
      confirmed.map((s) => s.user.id).filter((id) => id !== booker.id),
      {
        title: "Teams are out!",
        body: `Lineup's locked. ${booker.name ?? "Someone"} is booking. See your team.`,
        url: `/games/${game.id}`,
      },
    );
    // Nudge whoever's on bibs / football duty.
    if (bibsUserId) {
      await sendPushToUsers([bibsUserId], {
        title: "You've got the bibs 🦺",
        body: "You're taking the bibs home this week — give them a wash and bring them back next Sunday.",
        url: `/games/${game.id}`,
      });
    }
    if (footballUserId) {
      await sendPushToUsers([footballUserId], {
        title: "You've got the football ⚽",
        body: "You're taking the ball home this week and bringing it back next Sunday.",
        url: `/games/${game.id}`,
      });
    }

    results.push({ gameId: game.id, outcome: "LOCKED" });
  }

  return NextResponse.json({ results });
}
