import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GameStatus } from "@/generated/prisma/enums";
import { assertCronAuth } from "@/lib/cron";
import { completeGame } from "@/lib/complete";

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
    select: { id: true },
  });

  // Delegate each to the shared completer so the cron and the admin "End game
  // now" button can never drift apart (status flip + rating emails).
  for (const game of justFinished) {
    await completeGame(game.id);
  }

  return NextResponse.json({ completed: justFinished.length });
}
