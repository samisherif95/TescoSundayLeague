import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { assertCronAuth } from "@/lib/cron";
import { sendEmail } from "@/lib/email";
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
  // Complete BOOKED games and also any that are still LOCKED past kickoff (the
  // booker never entered the cost). Otherwise a LOCKED game lingers forever:
  // no rating emails, and getCurrentGame keeps showing it as "this week".
  const justFinished = await prisma.game.findMany({
    where: {
      status: { in: [GameStatus.BOOKED, GameStatus.LOCKED] },
      kickoffAt: { lte: now },
    },
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        include: { user: { select: { email: true, name: true } } },
      },
    },
  });

  if (justFinished.length > 0) {
    await prisma.game.updateMany({
      where: { id: { in: justFinished.map((g) => g.id) } },
      data: { status: GameStatus.COMPLETED },
    });
  }

  for (const game of justFinished) {
    await Promise.allSettled(
      game.signups
        .map((s) => ({ email: s.user.email, name: s.user.name }))
        .filter((p): p is { email: string; name: string | null } =>
          Boolean(p.email),
        )
        .map((p) =>
          sendEmail({
            to: p.email,
            subject: "Rate your teammates",
            html: `<p>Hi ${p.name ?? "there"},</p>
              <p>Hope the game was good. <a href="${env.appUrl}/games/${game.id}/rate">Rate your teammates</a> (1–5, anonymous, optional) — feeds into next week's team balancing.</p>`,
          }),
        ),
    );
  }

  return NextResponse.json({ completed: justFinished.length });
}
