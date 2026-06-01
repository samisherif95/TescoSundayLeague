"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { GameStatus } from "@/generated/prisma/enums";
import { authorizeBookingMember } from "@/lib/booking-access";
import { londonWallTimeToUtc } from "@/lib/game";

const schema = z.object({
  gameId: z.string().min(1),
  // London wall-clock, as produced by <input type="datetime-local">.
  kickoffLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time"),
  pitchName: z.string().trim().min(1, "Add a pitch name").max(100),
  // Optional — blank leaves the existing booking link untouched.
  pitchBookingUrl: z
    .union([z.string().trim().url("Enter a valid link"), z.literal("")])
    .default(""),
});

/**
 * Edit a game's kickoff time and location (pitch). Open to anyone playing that
 * Sunday — same access as shuffling teams — so the squad can move the game if
 * plans change, without waiting on an admin.
 *
 * The kickoff arrives as a London wall-clock string and is converted to the
 * correct UTC instant (DST-aware), so "12:00" always means noon in London
 * regardless of the server's timezone.
 */
export async function updateGameDetailsAction(
  input: z.infer<typeof schema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { gameId, kickoffLocal, pitchName, pitchBookingUrl } = parsed.data;

  const auth = await authorizeBookingMember(gameId);
  if ("error" in auth) return auth;

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { status: true },
  });
  if (!game) return { error: "Game not found" };
  if (
    game.status === GameStatus.COMPLETED ||
    game.status === GameStatus.CANCELLED
  ) {
    return { error: "This game is finished — its details can't be changed" };
  }

  const [datePart, timePart] = kickoffLocal.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const kickoffAt = londonWallTimeToUtc(year, month, day, hour, minute);

  await prisma.game.update({
    where: { id: gameId },
    data: {
      kickoffAt,
      pitchName,
      // Only overwrite the link when one was supplied.
      ...(pitchBookingUrl ? { pitchBookingUrl } : {}),
    },
  });

  revalidatePath(`/games/${gameId}`);
  revalidatePath(`/games/${gameId}/book`);
  revalidatePath("/");
  return { ok: true };
}
