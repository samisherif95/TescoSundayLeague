"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { requireAdmin, requireOnboardedUser } from "@/lib/session";
import { MAX_PLAYERS, isSignupOpen } from "@/lib/game";

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
  await requireAdmin();
  if (!gameId) return { error: "Missing game id" };
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
  revalidatePath("/");
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
  const user = await requireOnboardedUser();
  const parsed = gameIdSchema.safeParse({ gameId: formData.get("gameId") });
  if (!parsed.success) return { error: "Invalid input" };
  const { gameId } = parsed.data;

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      _count: {
        select: {
          signups: { where: { status: SignupStatus.CONFIRMED } },
          guests: true,
        },
      },
    },
  });
  if (!game) return { error: "Game not found" };
  if (game.status !== GameStatus.OPEN || !isSignupOpen(game)) {
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

  const rosterCount = game._count.signups + game._count.guests;
  if (rosterCount >= MAX_PLAYERS) {
    return { error: `The squad is full (${MAX_PLAYERS}).` };
  }

  await prisma.guest.create({ data: { gameId, hostUserId: user.id } });
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/");
  return { ok: true };
}

/**
 * Remove a +1. The host who added it can remove their own; an admin can remove
 * anyone's. Only while the game is still OPEN (after lock, teams are set).
 */
export async function removeGuestAction(
  guestId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireOnboardedUser();
  if (!guestId) return { error: "Missing guest id" };

  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    include: { game: { select: { id: true, status: true } } },
  });
  if (!guest) return { error: "Guest not found" };
  if (guest.hostUserId !== user.id && !user.isAdmin) {
    return { error: "You can only remove a +1 you added" };
  }
  if (guest.game.status !== GameStatus.OPEN) {
    return { error: "Too late to remove a +1 — the game is locked" };
  }

  await prisma.guest.delete({ where: { id: guestId } });
  revalidatePath(`/games/${guest.game.id}`);
  revalidatePath("/");
  return { ok: true };
}
