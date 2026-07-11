"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { GameStatus } from "@/generated/prisma/enums";
import { requireGameAdmin, requireGameMember } from "@/lib/session";
import { MAX_PLAYERS } from "@/lib/game";
import { addGuest, removeGuest } from "@/lib/signups";
import { notifyLeaveOutcome } from "@/lib/leave-notify";

const gameIdSchema = z.object({ gameId: z.string().min(1) });

/**
 * Admin toggle: allow (or stop allowing) +1 guests for a game. Turned on the
 * weeks an admin fears missing the minimum. Turning it off doesn't remove
 * guests already added — it just hides the "add a +1" button. Available while
 * the game is OPEN or LOCKED, so an admin can still open up +1s to back-fill
 * drop-outs after the lineup's locked.
 */
export async function setAllowGuestsAction(
  gameId: string,
  allow: boolean,
): Promise<{ ok: true } | { error: string }> {
  if (!gameId) return { error: "Missing game id" };
  await requireGameAdmin(gameId);
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return { error: "Game not found" };
  if (
    game.status !== GameStatus.OPEN &&
    game.status !== GameStatus.LOCKED
  ) {
    return { error: "Guests can only be toggled while the game is live" };
  }
  await prisma.game.update({
    where: { id: gameId },
    data: { allowGuests: allow },
  });
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/");
  return { ok: true };
}

/**
 * Add a +1 guest, hosted by the current user. Allowed while the game is OPEN
 * (before the deadline) and once it's LOCKED — on a locked game the +1 fills a
 * spot freed by a drop-out and is slotted into the rebuilt teams. The admin must
 * have enabled guests and the caller must be a confirmed player. Each call adds
 * one guest — tap again for a second, etc.
 */
export async function addGuestAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const parsed = gameIdSchema.safeParse({ gameId: formData.get("gameId") });
  if (!parsed.success) return { error: "Invalid input" };
  const { gameId } = parsed.data;
  const { user } = await requireGameMember(gameId);

  const result = await addGuest(gameId, user.id);
  switch (result.kind) {
    case "GAME_LOCKED":
      return { error: "Signups have closed for this game" };
    case "GUESTS_DISABLED":
      return { error: "+1s aren't enabled for this game" };
    case "NOT_CONFIRMED":
      return { error: "Only confirmed players can bring a +1" };
    case "FULL":
      return { error: `The squad is full (${MAX_PLAYERS}).` };
  }

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/");
  return { ok: true };
}

/**
 * Remove a +1. The host who added it can remove their own while the game is
 * still OPEN. An admin can remove anyone's +1 at any point up to completion —
 * the override for a locked/booked game runs the full drop-out engine
 * ({@link removeGuest}), so the guest leaves their team slot, a waitlister is
 * promoted into it if one's waiting, and the game reopens if it falls below
 * the minimum.
 */
export async function removeGuestAction(
  guestId: string,
): Promise<{ ok: true } | { error: string }> {
  if (!guestId) return { error: "Missing guest id" };

  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    include: { game: { select: { id: true, status: true } } },
  });
  if (!guest) return { error: "Guest not found" };
  const { user, membership } = await requireGameMember(guest.game.id);
  const isAdmin = membership.role === "ADMIN";
  if (guest.hostUserId !== user.id && !isAdmin) {
    return { error: "You can only remove a +1 you added" };
  }
  if (guest.game.status !== GameStatus.OPEN && !isAdmin) {
    return { error: "Too late to remove a +1 — the game is locked" };
  }

  const result = await removeGuest(guestId);
  if (result.kind === "NOT_FOUND") return { error: "Guest not found" };
  if (result.kind === "GAME_FINISHED") {
    return { error: "This game is finished — the +1 can't be removed" };
  }
  await notifyLeaveOutcome(result.gameId, result.outcome);

  revalidatePath(`/games/${guest.game.id}`);
  revalidatePath(`/games/${guest.game.id}/book`);
  revalidatePath("/");
  return { ok: true };
}
