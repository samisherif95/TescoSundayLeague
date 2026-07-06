"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  GameStatus,
  PaymentStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import { requireGroupAdmin, requireGameAdmin } from "@/lib/session";
import { nextKickoff } from "@/lib/game";
import { openWeeklyGame } from "@/lib/weekly-game";
import { leaveGame } from "@/lib/signups";
import { lockGame } from "@/lib/lock";
import { completeGame } from "@/lib/complete";
import { cancelGame } from "@/lib/cancel";
import { setBilledMembers, generatePaymentRequests } from "@/lib/payments";
import { sendPushToUsers } from "@/lib/push";

/**
 * Open the next game for the admin's active group. Uses the group's own
 * schedule (kickoff day/time) + default pitch and notifies the group's members,
 * via the shared openWeeklyGame.
 */
export async function createWeeklyGame() {
  const { group } = await requireGroupAdmin();
  const kickoff = nextKickoff(group);
  const { gameId, created } = await openWeeklyGame(group.id, kickoff);
  if (!created) {
    return { error: "A game already exists for the next slot" };
  }
  revalidatePath("/admin");
  revalidatePath("/home");
  return { ok: true as const, gameId };
}

const scheduleSchema = z.object({
  kickoffWeekday: z.coerce.number().int().min(0).max(6),
  kickoffHour: z.coerce.number().int().min(0).max(23),
  kickoffMinute: z.coerce.number().int().min(0).max(59),
  lockOffsetHours: z.coerce.number().int().min(1).max(336),
  defaultPitchName: z.string().min(1).max(80),
  defaultPitchBookingUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL"),
  playerNote: z.string().trim().max(280),
});

/**
 * Admin: set the active group's defaults — which day/time it kicks off (the
 * default kickoff used when an admin creates a game), how far ahead signups
 * close, and the default pitch.
 */
export async function updateGroupSchedule(formData: FormData) {
  const { group } = await requireGroupAdmin();
  const parsed = scheduleSchema.safeParse({
    kickoffWeekday: formData.get("kickoffWeekday"),
    kickoffHour: formData.get("kickoffHour"),
    kickoffMinute: formData.get("kickoffMinute"),
    lockOffsetHours: formData.get("lockOffsetHours"),
    defaultPitchName: formData.get("defaultPitchName"),
    defaultPitchBookingUrl: formData.get("defaultPitchBookingUrl"),
    playerNote: formData.get("playerNote") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid schedule" };
  }
  const { playerNote, ...rest } = parsed.data;
  await prisma.group.update({
    where: { id: group.id },
    // Empty note → null so the home banner hides rather than showing a blank.
    data: { ...rest, playerNote: playerNote || null },
  });
  revalidatePath("/admin");
  revalidatePath("/home");
  return { ok: true as const };
}

/**
 * Admin: lock a game — pick the booker, assign duties, generate teams, and
 * notify everyone. Delegates to the shared {@link lockGame} (fair booker
 * rotation, bibs/football, emails + push).
 */
export async function lockGameAction(
  gameId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireGameAdmin(gameId);
  if (!gameId) return { error: "Missing game id" };
  const result = await lockGame(gameId);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/admin");
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Admin: end a game now — flip it to COMPLETED and email everyone the rating
 * link. Delegates to the shared {@link completeGame}. Use once the game's been
 * played (works from LOCKED or BOOKED).
 */
export async function endGameAction(
  gameId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireGameAdmin(gameId);
  if (!gameId) return { error: "Missing game id" };
  const result = await completeGame(gameId);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/admin");
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Admin: cancel a game now — flip it to CANCELLED and tell everyone who'd
 * signed up. Delegates to the shared {@link cancelGame}. Use when the week
 * falls through (not enough players, pitch gone). Works from OPEN/LOCKED/BOOKED.
 */
export async function cancelGameAction(
  gameId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireGameAdmin(gameId);
  if (!gameId) return { error: "Missing game id" };
  const result = await cancelGame(gameId);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/admin");
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Admin: remove a player from the game entirely (not just the payment split).
 * Unlike {@link removeDebtorAction} — which only touches money — this drops them
 * from the roster AND their team via the shared {@link leaveGame} cascade: it
 * marks them DROPPED_OUT, pulls their name off the lineup, promotes the waitlist
 * into the freed slot, and (on a LOCKED game) re-picks any duty they held and
 * regenerates the teams. Any +1 they brought stays and is billed to them.
 */
export async function removePlayerAction(
  gameId: string,
  userId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireGameAdmin(gameId);
  if (!gameId || !userId) return { error: "Missing game or player id" };

  const outcome = await leaveGame(gameId, userId);
  const gameUrl = `/games/${gameId}`;

  // Best-effort nudges — never block the removal on a flaky push.
  await sendPushToUsers([userId], {
    title: "Taken off this week's game",
    body: "An admin has removed you from the lineup.",
    url: gameUrl,
  }).catch(() => undefined);
  if (outcome.promotedUserIds.length > 0) {
    await sendPushToUsers(outcome.promotedUserIds, {
      title: "You're in!",
      body: "A spot opened up — you're confirmed for the game.",
      url: gameUrl,
    }).catch(() => undefined);
  }
  if (outcome.newBookerId) {
    await sendPushToUsers([outcome.newBookerId], {
      title: "You're now booking",
      body: "The previous booker was removed — you've been picked to book.",
      url: `${gameUrl}/book`,
    }).catch(() => undefined);
  }

  revalidatePath(gameUrl);
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Admin: remove a no-show from the payment split. Drops their payment request
 * and recomputes everyone else's share so the same total is covered by who
 * actually played. Only touches money — the player stays in the roster/teams.
 */
export async function removeDebtorAction(
  gameId: string,
  debtorId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireGameAdmin(gameId);
  if (!gameId || !debtorId) return { error: "Missing game or player id" };

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      bookerId: true,
      paymentRequests: { select: { debtorId: true, paidStatus: true } },
    },
  });
  if (!game) return { error: "Game not found" };
  if (debtorId === game.bookerId) {
    return { error: "The booker isn't billed — there's nothing to remove." };
  }
  // Can't drop someone who's already paid — deleting the row would erase the
  // record of their payment and over-credit the booker.
  const target = game.paymentRequests.find((p) => p.debtorId === debtorId);
  if (target?.paidStatus === PaymentStatus.MARKED_PAID) {
    return {
      error: "They've already paid — un-mark their payment before removing them.",
    };
  }

  // Rebill everyone who still has a request, minus the removed player. The
  // booker is re-added as a head inside setBilledMembers.
  const remaining = game.paymentRequests
    .map((p) => p.debtorId)
    .filter((id) => id !== debtorId);
  const result = await setBilledMembers(gameId, remaining);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Admin: rebuild the payment split from the full confirmed squad — the escape
 * hatch for an accidental removal. Re-adds anyone dropped and recomputes shares.
 */
export async function regenerateSplitAction(
  gameId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireGameAdmin(gameId);
  if (!gameId) return { error: "Missing game id" };
  const result = await generatePaymentRequests(gameId);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/home");
  return { ok: true };
}

// The three game-day chores an admin can hand-pick, mapped to their Game column
// and the nudge we push to whoever just got the job. Used by the manual override
// below, which exists so a late drop-out, a swap, or a plain mistake in the
// auto-rotation can be fixed without re-locking and re-shuffling teams.
const DUTIES = {
  booker: {
    field: "bookerId",
    label: "Booker",
    push: {
      title: "You're booking Sunday ⚽",
      body: "An admin's put you on booking duty this week. Tap to sort the pitch.",
      path: "/book",
    },
  },
  bibs: {
    field: "bibsUserId",
    label: "Bibs",
    push: {
      title: "You've got the bibs 🦺",
      body: "An admin's put you on bibs this week — bring them along on Sunday.",
      path: "",
    },
  },
  football: {
    field: "footballUserId",
    label: "Football",
    push: {
      title: "You've got the football ⚽",
      body: "An admin's put you on the ball this week — bring it along on Sunday.",
      path: "",
    },
  },
} as const;

type Duty = keyof typeof DUTIES;

const reassignSchema = z.object({
  gameId: z.string().min(1),
  duty: z.enum(["booker", "bibs", "football"]),
  userId: z.string().min(1),
});

/**
 * Admin override: hand-pick who holds a single duty (booker / bibs / football)
 * on an already-locked game. The auto-rotation only runs once at lock time and
 * was previously impossible to correct; this lets an admin fix it without
 * re-locking (which would re-shuffle teams). Keeps the three duties on three
 * different people, and pushes the new holder a heads-up.
 */
export async function reassignDutyAction(
  gameId: string,
  duty: Duty,
  userId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireGameAdmin(gameId);
  const parsed = reassignSchema.safeParse({ gameId, duty, userId });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      status: true,
      bookerId: true,
      bibsUserId: true,
      footballUserId: true,
      totalCostPence: true,
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        select: { userId: true },
      },
    },
  });
  if (!game) return { error: "Game not found" };
  // Duties only exist once a game is locked; don't touch a finished one.
  if (game.status !== GameStatus.LOCKED && game.status !== GameStatus.BOOKED) {
    return { error: "Duties can only be changed once the game is locked." };
  }
  // Once the cost is recorded, the current booker has paid the pitch on their
  // own card — reassigning the booker would redirect everyone's reimbursement
  // to someone who never spent anything. Bibs/football stay freely swappable.
  if (
    parsed.data.duty === "booker" &&
    game.bookerId !== userId &&
    game.totalCostPence != null
  ) {
    return {
      error:
        "The booker's already paid for the pitch — you can't hand booking to someone else now.",
    };
  }
  if (!game.signups.some((s) => s.userId === userId)) {
    return { error: "That player isn't a confirmed member this week." };
  }

  // Keep booker / bibs / football as three different people: refuse if the
  // pick already holds one of the *other two* duties.
  const otherHolders: Record<Duty, (string | null)[]> = {
    booker: [game.bibsUserId, game.footballUserId],
    bibs: [game.bookerId, game.footballUserId],
    football: [game.bookerId, game.bibsUserId],
  };
  if (otherHolders[duty].includes(userId)) {
    return {
      error: "That player already has another duty this week — pick someone else.",
    };
  }

  await prisma.game.update({
    where: { id: gameId },
    data: { [DUTIES[duty].field]: userId },
  });

  // Best-effort nudge to the new holder — never block the change on a flaky push.
  const { push } = DUTIES[duty];
  await sendPushToUsers([userId], {
    title: push.title,
    body: push.body,
    url: `/games/${gameId}${push.path}`,
  }).catch(() => undefined);

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/home");
  return { ok: true };
}
