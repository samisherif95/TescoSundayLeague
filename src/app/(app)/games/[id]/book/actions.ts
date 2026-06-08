"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { GameStatus } from "@/generated/prisma/enums";
import { requireOnboardedUser } from "@/lib/session";
import { sendPushToUsers } from "@/lib/push";
import { setBilledMembers, generatePaymentRequests } from "@/lib/payments";

const confirmSchema = z.object({
  gameId: z.string().min(1),
  totalPounds: z.coerce.number().positive().max(500),
});

export async function confirmBooking(formData: FormData) {
  const user = await requireOnboardedUser();
  const parsed = confirmSchema.safeParse({
    gameId: formData.get("gameId"),
    totalPounds: formData.get("totalPounds"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const game = await prisma.game.findUnique({
    where: { id: parsed.data.gameId },
    select: {
      id: true,
      bookerId: true,
      status: true,
      paymentRequests: { select: { debtorId: true } },
    },
  });
  if (!game) return { error: "Game not found" };
  if (game.bookerId !== user.id) return { error: "Only the booker can do this" };
  // Editable while the booking's being sorted, and also after the game's ended
  // (so a forgotten or wrong cost can still be entered/fixed).
  if (
    game.status !== GameStatus.LOCKED &&
    game.status !== GameStatus.BOOKED &&
    game.status !== GameStatus.COMPLETED
  ) {
    return { error: "Game is not ready to be booked" };
  }
  // The split is generated when an admin ends the game, but the booker needs a
  // payment username on file by then — make them set it now rather than later.
  if (!user.paymentHandle) {
    return {
      error: `Add your ${user.paymentMethod === "REVOLUT" ? "Revolut" : "Monzo"} username in your profile first`,
    };
  }

  const totalPence = Math.round(parsed.data.totalPounds * 100);

  if (game.status === GameStatus.COMPLETED) {
    // Game's already ended — record the cost and (re)generate the split now,
    // keeping it COMPLETED. Rebill whoever's currently billed so this doesn't
    // resurrect no-shows an admin already removed; if nothing's billed yet
    // (cost entered after an early end), fall back to the full confirmed squad.
    await prisma.game.update({
      where: { id: game.id },
      data: { totalCostPence: totalPence },
    });
    const existing = game.paymentRequests.map((p) => p.debtorId);
    const result =
      existing.length > 0
        ? await setBilledMembers(game.id, [game.bookerId, ...existing])
        : await generatePaymentRequests(game.id);
    if (!result.ok) return { error: result.error };
  } else {
    // Record the cost only. Payment links aren't generated or shown to the
    // squad until an admin ends the game — that's when the attendee list is
    // final and any no-shows have been removed, so the split is correct.
    await prisma.game.update({
      where: { id: game.id },
      data: { status: GameStatus.BOOKED, totalCostPence: totalPence },
    });
  }

  revalidatePath(`/games/${game.id}`);
  revalidatePath(`/games/${game.id}/book`);
  return { ok: true as const };
}

export async function markPaymentPaid(formData: FormData) {
  const user = await requireOnboardedUser();
  const id = String(formData.get("paymentRequestId") ?? "");
  const payment = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!payment) return { error: "Payment not found" };
  // Only the booker (recipient) or the debtor can mark paid
  if (payment.bookerId !== user.id && payment.debtorId !== user.id) {
    return { error: "Not allowed" };
  }
  await prisma.paymentRequest.update({
    where: { id },
    data: { paidStatus: "MARKED_PAID" },
  });
  // If a debtor marked themselves paid, let the booker know.
  if (payment.debtorId === user.id && payment.bookerId !== user.id) {
    await sendPushToUsers([payment.bookerId], {
      title: "Payment received",
      body: `${user.name ?? "Someone"} marked their payment as paid.`,
      url: `/games/${payment.gameId}`,
    });
  }
  revalidatePath(`/games/${payment.gameId}/book`);
  revalidatePath(`/games/${payment.gameId}`);
  return { ok: true as const };
}
