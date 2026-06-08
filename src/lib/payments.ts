import { prisma } from "@/lib/db";
import { SignupStatus } from "@/generated/prisma/enums";
import { calcSplit, generatePaymentLink, monzoDescription } from "@/lib/game";

export type PaymentsResult =
  | { ok: true; gameId: string; debtorCount: number }
  | { ok: false; error: string };

/**
 * Recompute the payment requests for a game, billing exactly `billedMemberIds`
 * (the members deemed to have played — the booker is always included as a head
 * even though they're never billed). The pitch cost is split evenly across all
 * heads on the pitch (each billed member + the +1s they brought), and every
 * non-booker member is billed their share. The booker absorbs the rounding
 * remainder and the cost of any +1s.
 *
 * Removing a no-show is just calling this with a smaller member set: their row
 * (and their +1s) drop out and everyone else's share goes up to cover the same
 * total. Idempotent — re-running with the same set produces the same rows, and
 * upserts preserve each debtor's `paidStatus` (only the amount + link refresh).
 *
 * Guests are billed to their host, so a guest whose host is no longer billed is
 * dropped from the split too.
 */
export async function setBilledMembers(
  gameId: string,
  billedMemberIds: string[],
): Promise<PaymentsResult> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      kickoffAt: true,
      totalCostPence: true,
      bookerId: true,
      booker: { select: { paymentMethod: true, paymentHandle: true } },
      guests: { select: { hostUserId: true } },
    },
  });

  if (!game) return { ok: false, error: "Game not found" };
  if (!game.bookerId || !game.booker) {
    return { ok: false, error: "No booker set for this game yet." };
  }
  if (game.totalCostPence == null) {
    return { ok: false, error: "The pitch cost hasn't been entered yet." };
  }
  if (!game.booker.paymentHandle) {
    return {
      ok: false,
      error: "The booker hasn't set their payment username yet.",
    };
  }

  // The booker is always a head on the pitch, even though they're never billed.
  const billed = new Set(billedMemberIds);
  billed.add(game.bookerId);

  // Count +1s per host, but only for hosts still in the billed set — a removed
  // member's +1s come off the bill with them.
  const guestCountByHost = new Map<string, number>();
  for (const g of game.guests) {
    if (!billed.has(g.hostUserId)) continue;
    guestCountByHost.set(
      g.hostUserId,
      (guestCountByHost.get(g.hostUserId) ?? 0) + 1,
    );
  }

  const debtorIds = [...billed].filter((id) => id !== game.bookerId);

  // No one left to bill (everyone but the booker removed) — clear all rows.
  if (debtorIds.length === 0) {
    await prisma.paymentRequest.deleteMany({ where: { gameId: game.id } });
    return { ok: true, gameId: game.id, debtorCount: 0 };
  }

  // Total heads = every billed member + their +1s (booker counted once here so
  // their share comes off the top and lowers everyone's split).
  const headCount = [...billed].reduce(
    (n, id) => n + 1 + (guestCountByHost.get(id) ?? 0),
    0,
  );
  const { perPersonPence } = calcSplit(game.totalCostPence, headCount);
  const desc = monzoDescription(game.kickoffAt);

  await prisma.$transaction(async (tx) => {
    // Drop rows for anyone no longer billed.
    await tx.paymentRequest.deleteMany({
      where: { gameId: game.id, debtorId: { notIn: debtorIds } },
    });
    for (const debtorId of debtorIds) {
      const shares = 1 + (guestCountByHost.get(debtorId) ?? 0);
      const amountPence = perPersonPence * shares;
      const paymentLink = generatePaymentLink(
        game.booker!.paymentMethod,
        game.booker!.paymentHandle!,
        amountPence,
        desc,
      );
      await tx.paymentRequest.upsert({
        where: { gameId_debtorId: { gameId: game.id, debtorId } },
        create: {
          gameId: game.id,
          debtorId,
          bookerId: game.bookerId!,
          amountPence,
          paymentLink,
        },
        // Preserve paidStatus — only refresh the amount + link.
        update: { bookerId: game.bookerId!, amountPence, paymentLink },
      });
    }
  });

  return { ok: true, gameId: game.id, debtorCount: debtorIds.length };
}

/**
 * Generate the payment split from a game's *currently confirmed* squad. Called
 * when an admin ends the game, so the bill reflects who was still confirmed at
 * that point. Returns a soft error (never throws) so a missing cost / booker
 * handle doesn't block the game from completing.
 */
export async function generatePaymentRequests(
  gameId: string,
): Promise<PaymentsResult> {
  const confirmed = await prisma.signup.findMany({
    where: { gameId, status: SignupStatus.CONFIRMED },
    select: { userId: true },
  });
  return setBilledMembers(
    gameId,
    confirmed.map((s) => s.userId),
  );
}
