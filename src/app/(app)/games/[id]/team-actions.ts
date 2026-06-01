"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeAdmin } from "@/lib/booking-access";

const moveSchema = z.object({
  gameId: z.string().min(1),
  userId: z.string().min(1),
  toTeamId: z.string().min(1),
});

/**
 * Move a player into a different team within the same game (drag-and-drop on
 * the game page). Admin-only — keeping the balanced lineup under one person's
 * control avoids tug-of-war shuffling. A player belongs to exactly one team, so
 * this removes them from their current team and adds them to the target.
 */
export async function moveTeamPlayerAction(
  input: z.infer<typeof moveSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { gameId, userId, toTeamId } = parsed.data;

  const auth = await authorizeAdmin();
  if ("error" in auth) return auth;

  const toTeam = await prisma.team.findFirst({
    where: { id: toTeamId, gameId },
    select: { id: true },
  });
  if (!toTeam) return { error: "That team isn't in this game" };

  const current = await prisma.teamPlayer.findFirst({
    where: { userId, team: { gameId } },
    select: { teamId: true },
  });
  if (!current) return { error: "That player isn't in this game's teams" };
  if (current.teamId === toTeamId) return { ok: true };

  await prisma.$transaction([
    prisma.teamPlayer.deleteMany({ where: { userId, team: { gameId } } }),
    prisma.teamPlayer.create({ data: { teamId: toTeamId, userId } }),
  ]);

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/");
  return { ok: true };
}
