import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron";
import { nextSundayNoon } from "@/lib/game";
import { openWeeklyGame } from "@/lib/weekly-game";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await assertCronAuth(req);
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const { gameId, created } = await openWeeklyGame(nextSundayNoon());
  if (!created) return NextResponse.json({ skipped: true, gameId });
  return NextResponse.json({ created: true, gameId });
}
