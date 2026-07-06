"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, serializableTx } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { requireGameAdmin, requireGameMember } from "@/lib/session";
import { MAX_PLAYERS, isSignupOpen } from "@/lib/game";
import { promoteWaitlist } from "@/lib/signups";
import { sendPushToUsers } from "@/lib/push";

const gameIdSchema = z.object({ gameId: z.string().min(1) });

/**
 * Admin toggle: allow (or stop allowing) +1 guests for a game. Turned on the
 * weeks an admin fears missing the minimum. Turning it off doesn't remove
 * guests already added — it just hides the "add a +1" button.
 */
export async function setAllowGuestsAction(
  gameId: string,
  allow: boolean,
): Promise<{ ok: true } | { error: string }> {
  if (!gameId) return { error: "Missing game id" };
  await requireGameAdmin(gameId);
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return { error: "Game not found" };
  if (game.status !== GameStatus.OPEN) {
    return { error: "Guests can only be toggled while signups are open" };
  }
  await prisma.game.update({
    where: { id: gameId },
    data: { allowGuests: allow },
  });
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Add a +1 guest, hosted by the current user. Allowed only while the game is
 * OPEN, signups are still open, the admin has enabled guests, and the caller is
 * a confirmed player. Each call adds one guest — tap again for a second, etc.
 */
export async function addGuestAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const parsed = gameIdSchema.safeParse({ gameId: formData.get("gameId") });
  if (!parsed.success) return { error: "Invalid input" };
  const { gameId } = parsed.data;
  const { user } = await requireGameMember(gameId);

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { group: { select: { lockOffsetHours: true } } },
  });
  if (!game) return { error: "Game not found" };
  if (
    game.status !== GameStatus.OPEN ||
    !isSignupOpen(game)
  ) {
    return { error: "Signups have closed for this game" };
  }
  if (!game.allowGuests) {
    return { error: "+1s aren't enabled for this game" };
  }

  const mySignup = await prisma.signup.findUnique({
    where: { gameId_userId: { gameId, userId: user.id } },
    select: { status: true },
  });
  if (mySignup?.status !== SignupStatus.CONFIRMED) {
    return { error: "Only confirmed players can bring a +1" };
  }

  // The capacity check + insert must be atomic against concurrent signups and
  // other +1 adds, which also count toward MAX_PLAYERS. Serializable (the same
  // isolation the signup path uses) makes two hosts grabbing the last slot
  // conflict; the loser retries, re-reads the counts, and sees it's full.
  const result = await serializableTx(async (tx) => {
    const confirmedCount = await tx.signup.count({
      where: { gameId, status: SignupStatus.CONFIRMED },
    });
    const guestCount = await tx.guest.count({ where: { gameId } });
    if (confirmedCount + guestCount >= MAX_PLAYERS) {
      return { error: `The squad is full (${MAX_PLAYERS}).` };
    }
    await tx.guest.create({ data: { gameId, hostUserId: user.id } });
    return { ok: true as const };
  });
  if ("error" in result) return result;
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Remove a +1. The host who added it can remove their own; an admin can remove
 * anyone's. Only while the game is still OPEN (after lock, teams are set).
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
  if (guest.hostUserId !== user.id && membership.role !== "ADMIN") {
    return { error: "You can only remove a +1 you added" };
  }
  if (guest.game.status !== GameStatus.OPEN) {
    return { error: "Too late to remove a +1 — the game is locked" };
  }

  // Removing a +1 frees a roster slot — promote the next waitlister into it so
  // the spot doesn't sit open for a newcomer to jump the queue. Serializable so
  // the delete + promotion is atomic against a concurrent join.
  const promoted = await serializableTx(async (tx) => {
    await tx.guest.delete({ where: { id: guestId } });
    return promoteWaitlist(tx, guest.game.id);
  });
  if (promoted.length > 0) {
    await sendPushToUsers(promoted, {
      title: "You're in!",
      body: "A spot opened up — you're confirmed for the game.",
      url: `/games/${guest.game.id}`,
    }).catch(() => undefined);
  }
  revalidatePath(`/games/${guest.game.id}`);
  revalidatePath("/home");
  return { ok: true };
}
