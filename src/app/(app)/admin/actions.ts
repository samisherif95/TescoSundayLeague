"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  GameStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import { requireAdmin } from "@/lib/session";
import {
  MIN_PLAYERS,
  generateTeams,
  nextSundayNoon,
  pickRandom,
} from "@/lib/game";

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

export async function forceLock(formData: FormData) {
  await requireAdmin();
  const gameId = String(formData.get("gameId") ?? "");
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        include: {
          user: { select: { id: true, skillScore: true } },
        },
      },
    },
  });
  if (!game) return { error: "Not found" };
  if (game.status !== GameStatus.OPEN) return { error: "Already locked" };
  if (game.signups.length < MIN_PLAYERS) {
    return {
      error: `Need at least ${MIN_PLAYERS} confirmed players (have ${game.signups.length}).`,
    };
  }
  const booker = pickRandom(game.signups.map((s) => s.user));
  const teams = generateTeams(
    game.signups.map((s) => ({
      userId: s.user.id,
      position: s.position,
      skillScore: s.user.skillScore,
    })),
  );
  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: game.id },
      data: { status: GameStatus.LOCKED, bookerId: booker.id },
    });
    await tx.team.deleteMany({ where: { gameId: game.id } });
    for (const t of teams) {
      await tx.team.create({
        data: {
          gameId: game.id,
          label: t.label,
          players: { create: t.players.map((p) => ({ userId: p.userId })) },
        },
      });
    }
  });
  revalidatePath(`/games/${game.id}`);
  revalidatePath("/admin");
  return { ok: true as const };
}
