import { prisma } from "@/lib/db";
import { PaymentStatus, SignupStatus } from "@/generated/prisma/enums";
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
 * total. Idempotent — re-running with the same set produces the same rows.
 *
 * A row that's already MARKED_PAID is FROZEN: its amount and link are never
 * changed, and it's never deleted. Payment links are revealed at game end and
 * people pay immediately, so re-splitting afterwards (a no-show removed, the
 * cost corrected) must not retroactively reprice money someone already sent —
 * the booker absorbs any resulting difference, exactly as they absorb rounding
 * and guests. Only UNPAID rows are recomputed.
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
      paymentRequests: { select: { debtorId: true, paidStatus: true } },
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

  // "Players" get a head of their own (they were on the pitch). The booker is
  // always a player, and any already-paid debtor stays a player so their frozen
  // head keeps counting even if the caller left them out.
  const paidDebtors = new Set(
    game.paymentRequests
      .filter((p) => p.paidStatus === PaymentStatus.MARKED_PAID)
      .map((p) => p.debtorId),
  );
  const players = new Set(billedMemberIds);
  players.add(game.bookerId);
  for (const id of paidDebtors) players.add(id);

  // Every +1 is billed to whoever brought them — even if that host has since
  // dropped out. A host who leaves but whose guest still plays owes for the
  // guest only (they get no head of their own since they didn't play). So each
  // guest host is a billed party regardless of whether they're a player.
  const guestCountByHost = new Map<string, number>();
  for (const g of game.guests) {
    guestCountByHost.set(
      g.hostUserId,
      (guestCountByHost.get(g.hostUserId) ?? 0) + 1,
    );
  }

  // Everyone with a bill: players, plus any guest host who isn't already one.
  const parties = new Set<string>(players);
  for (const host of guestCountByHost.keys()) parties.add(host);

  // How many shares each party owes: 1 for playing (if they did) + one per +1.
  const sharesOf = (id: string) =>
    (players.has(id) ? 1 : 0) + (guestCountByHost.get(id) ?? 0);

  const debtorIds = [...parties].filter((id) => id !== game.bookerId);

  // No one left to bill (everyone but the booker removed) — clear all rows,
  // except any that are already paid (those are settled and must survive).
  if (debtorIds.length === 0) {
    await prisma.paymentRequest.deleteMany({
      where: { gameId: game.id, paidStatus: { not: PaymentStatus.MARKED_PAID } },
    });
    return { ok: true, gameId: game.id, debtorCount: 0 };
  }

  // Total heads = every party's shares (the booker's own share + any +1s they
  // brought come off the top, lowering everyone else's split).
  const headCount = [...parties].reduce((n, id) => n + sharesOf(id), 0);
  const { perPersonPence } = calcSplit(game.totalCostPence, headCount);
  const desc = monzoDescription(game.kickoffAt);

  await prisma.$transaction(async (tx) => {
    // Drop rows for anyone no longer billed — but never a settled (paid) row.
    await tx.paymentRequest.deleteMany({
      where: {
        gameId: game.id,
        debtorId: { notIn: debtorIds },
        paidStatus: { not: PaymentStatus.MARKED_PAID },
      },
    });
    for (const debtorId of debtorIds) {
      // A paid row is frozen — its amount reflects money already sent, so leave
      // it exactly as-is (the booker absorbs any delta from re-splitting).
      if (paidDebtors.has(debtorId)) continue;
      const amountPence = perPersonPence * sharesOf(debtorId);
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
