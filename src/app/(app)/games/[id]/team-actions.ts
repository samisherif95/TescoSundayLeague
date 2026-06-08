"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeAdmin } from "@/lib/booking-access";

const moveSchema = z.object({
  gameId: z.string().min(1),
  teamPlayerId: z.string().min(1),
  toTeamId: z.string().min(1),
});

/**
 * Move a player (member or +1 guest) into a different team within the same game
 * (drag-and-drop on the game page). Admin-only — keeping the balanced lineup
 * under one person's control avoids tug-of-war shuffling. Identified by the team
 * slot's id, so it works the same for members and guests.
 */
export async function moveTeamPlayerAction(
  input: z.infer<typeof moveSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { gameId, teamPlayerId, toTeamId } = parsed.data;

  const auth = await authorizeAdmin(gameId);
  if ("error" in auth) return auth;

  const toTeam = await prisma.team.findFirst({
    where: { id: toTeamId, gameId },
    select: { id: true },
  });
  if (!toTeam) return { error: "That team isn't in this game" };

  const slot = await prisma.teamPlayer.findFirst({
    where: { id: teamPlayerId, team: { gameId } },
    select: { id: true, teamId: true },
  });
  if (!slot) return { error: "That player isn't in this game's teams" };
  if (slot.teamId === toTeamId) return { ok: true };

  await prisma.teamPlayer.update({
    where: { id: slot.id },
    data: { teamId: toTeamId },
  });

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/");
  return { ok: true };
}
