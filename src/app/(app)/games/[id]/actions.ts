"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  PaymentStatus,
  Position,
  SignupStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  requireOnboardedUser,
  requireGameMember,
  requireGameAdmin,
} from "@/lib/session";
import { joinGame, leaveGame } from "@/lib/signups";
import { notifyLeaveOutcome } from "@/lib/leave-notify";
import { sendEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";

const joinSchema = z.object({
  gameId: z.string().min(1),
  position: z.enum(["DEF", "MID", "FWD"]),
});

export async function joinGameAction(formData: FormData) {
  const user = await requireOnboardedUser();
  const parsed = joinSchema.safeParse({
    gameId: formData.get("gameId"),
    position: formData.get("position"),
  });
  if (!parsed.success) return { error: "Invalid input" };
  await requireGameMember(parsed.data.gameId); // must belong to the game's group
  const result = await joinGame(
    parsed.data.gameId,
    user.id,
    parsed.data.position as Position,
  );
  revalidatePath(`/games/${parsed.data.gameId}`);
  revalidatePath("/");
  return { ok: true as const, result };
}

export async function leaveGameAction(formData: FormData) {
  const user = await requireOnboardedUser();
  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) return { error: "Missing game id" };
  await requireGameMember(gameId); // must belong to the game's group

  const outcome = await leaveGame(gameId, user.id);
  await notifyLeaveOutcome(gameId, outcome);

  const gameUrl = `/games/${gameId}`;
  revalidatePath(gameUrl);
  revalidatePath(`${gameUrl}/book`);
  revalidatePath("/");
  return { ok: true as const };
}

/**
 * Admin: remove any player from a game at any point — a late drop-out who
 * didn't take themselves out, a no-show, or a mistaken signup. Runs the exact
 * same path as a self drop-out ({@link leaveGame}): a waitlister is pulled in to
 * take the freed spot (and, on a locked game, the dropped player's team slot),
 * duties are re-picked if their holder is the one removed, and everyone affected
 * is notified. The removed player is told too.
 */
export async function removePlayerAction(
  gameId: string,
  userId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireGameAdmin(gameId); // admin of the game's group
  if (!gameId || !userId) return { error: "Missing game or player id" };

  const target = await prisma.signup.findUnique({
    where: { gameId_userId: { gameId, userId } },
    select: {
      status: true,
      user: { select: { name: true, email: true } },
    },
  });
  if (!target || target.status === SignupStatus.DROPPED_OUT) {
    return { error: "That player isn't in this game." };
  }

  const outcome = await leaveGame(gameId, userId);
  await notifyLeaveOutcome(gameId, outcome);

  // Let the removed player know — they didn't take themselves out.
  const gameUrl = `/games/${gameId}`;
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { kickoffAt: true },
  });
  const when = game?.kickoffAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });
  if (target.user.email) {
    await sendEmail({
      to: target.user.email,
      subject: "You've been removed from Sunday's game",
      html: `<p>Hi ${target.user.name ?? "there"},</p>
        <p>An admin has removed you from the ${when} game. If you think this was a mistake, have a word with your group admin.</p>`,
    }).catch(() => undefined);
  }
  await sendPushToUsers([userId], {
    title: "Removed from the game",
    body: `An admin removed you from the ${when} game.`,
    url: gameUrl,
  });

  revalidatePath(gameUrl);
  revalidatePath(`${gameUrl}/book`);
  revalidatePath("/");
  return { ok: true };
}

/** Booker-only: push a payment reminder to everyone who still owes. */
export async function nudgeUnpaidAction(gameId: string) {
  const user = await requireOnboardedUser();
  await requireGameMember(gameId);
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return { error: "Game not found" };
  if (game.bookerId !== user.id) return { error: "Only the booker can do this" };

  const unpaid = await prisma.paymentRequest.findMany({
    where: { gameId, paidStatus: PaymentStatus.UNPAID },
    select: { debtorId: true },
  });
  if (unpaid.length === 0) return { ok: true as const };

  await sendPushToUsers(
    unpaid.map((p) => p.debtorId),
    {
      title: "Payment reminder",
      body: `Don't forget to pay ${user.name ?? "the booker"} back for Sunday's game.`,
      url: `/games/${gameId}`,
    },
  );
  return { ok: true as const };
}
