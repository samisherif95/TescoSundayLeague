"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { GameStatus } from "@/generated/prisma/enums";
import { requireAdmin } from "@/lib/session";
import { nextSundayNoon } from "@/lib/game";
import { lockGame } from "@/lib/lock";

const editSchema = z.object({
  gameId: z.string().min(1),
  kickoffAt: z.string().min(1),
  pitchName: z.string().min(1).max(80),
  // Constrain to http(s) so a stored `javascript:`/`data:` URL can't be
  // rendered as a booking link href.
  pitchBookingUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL"),
});

export async function createWeeklyGame() {
  await requireAdmin();
  const kickoff = nextSundayNoon();
  const existing = await prisma.game.findFirst({
    where: { kickoffAt: kickoff },
  });
  if (existing) return { error: "Game already exists for that Sunday" };
  const game = await prisma.game.create({
    data: { kickoffAt: kickoff, status: GameStatus.OPEN },
  });
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true as const, gameId: game.id };
}

export async function editGame(formData: FormData) {
  await requireAdmin();
  const parsed = editSchema.safeParse({
    gameId: formData.get("gameId"),
    kickoffAt: formData.get("kickoffAt"),
    pitchName: formData.get("pitchName"),
    pitchBookingUrl: formData.get("pitchBookingUrl"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await prisma.game.update({
    where: { id: parsed.data.gameId },
    data: {
      kickoffAt: new Date(parsed.data.kickoffAt),
      pitchName: parsed.data.pitchName,
      pitchBookingUrl: parsed.data.pitchBookingUrl,
    },
  });
  revalidatePath("/admin");
  revalidatePath(`/games/${parsed.data.gameId}`);
  return { ok: true as const };
}

/**
 * Admin safeguard: lock a game right now — pick the booker, assign duties,
 * generate teams, and notify everyone — without waiting on the Friday cron.
 * Delegates to the shared {@link lockGame} so it behaves identically to the
 * cron (fair booker rotation, bibs/football, emails + push).
 */
export async function lockGameAction(
  gameId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  if (!gameId) return { error: "Missing game id" };
  const result = await lockGame(gameId);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}
