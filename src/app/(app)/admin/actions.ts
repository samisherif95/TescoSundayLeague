"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { requireGroupAdmin, requireGameAdmin } from "@/lib/session";
import { nextKickoff } from "@/lib/game";
import { openWeeklyGame } from "@/lib/weekly-game";
import { lockGame } from "@/lib/lock";
import { completeGame } from "@/lib/complete";
import { cancelGame } from "@/lib/cancel";
import { setBilledMembers, generatePaymentRequests } from "@/lib/payments";
import { sendPushToUsers } from "@/lib/push";

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

export async function editGame(formData: FormData) {
  const parsed = editSchema.safeParse({
    gameId: formData.get("gameId"),
    kickoffAt: formData.get("kickoffAt"),
    pitchName: formData.get("pitchName"),
    pitchBookingUrl: formData.get("pitchBookingUrl"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await requireGameAdmin(parsed.data.gameId);
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
  revalidatePath("/");
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
  revalidatePath("/");
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
  revalidatePath("/");
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
      paymentRequests: { select: { debtorId: true } },
    },
  });
  if (!game) return { error: "Game not found" };
  if (debtorId === game.bookerId) {
    return { error: "The booker isn't billed — there's nothing to remove." };
  }

  // Rebill everyone who still has a request, minus the removed player. The
  // booker is re-added as a head inside setBilledMembers.
  const remaining = game.paymentRequests
    .map((p) => p.debtorId)
    .filter((id) => id !== debtorId);
  const result = await setBilledMembers(gameId, remaining);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/");
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
  revalidatePath("/");
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
  revalidatePath("/");
  return { ok: true };
}
