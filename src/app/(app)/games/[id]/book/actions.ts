"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  GameStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import { requireOnboardedUser } from "@/lib/session";
import { sendPushToUsers } from "@/lib/push";
import {
  calcSplit,
  generatePaymentLink,
  monzoDescription,
} from "@/lib/game";

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
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        include: { user: { select: { id: true, name: true } } },
      },
      guests: { select: { hostUserId: true } },
    },
  });
  if (!game) return { error: "Game not found" };
  if (game.bookerId !== user.id) return { error: "Only the booker can do this" };
  if (game.status !== GameStatus.LOCKED && game.status !== GameStatus.BOOKED) {
    return { error: "Game is not ready to be booked" };
  }
  if (!user.paymentHandle) {
    return {
      error: `Add your ${user.paymentMethod === "REVOLUT" ? "Revolut" : "Monzo"} username in your profile first`,
    };
  }

  const totalPence = Math.round(parsed.data.totalPounds * 100);
  // Split across every head on the pitch — members + guests — then bill each
  // host for their own share plus a share for each +1 they brought.
  const guestCountByHost = new Map<string, number>();
  for (const g of game.guests) {
    guestCountByHost.set(
      g.hostUserId,
      (guestCountByHost.get(g.hostUserId) ?? 0) + 1,
    );
  }
  const headCount = game.signups.length + game.guests.length;
  const { perPersonPence } = calcSplit(totalPence, headCount);
  const desc = monzoDescription(game.kickoffAt);

  // Everyone except the booker owes a share (the booker keeps the remainder and
  // covers any +1s they personally brought).
  const debtors = game.signups.filter((s) => s.userId !== user.id);
  const debtorIds = debtors.map((s) => s.userId);

  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: game.id },
      data: { status: GameStatus.BOOKED, totalCostPence: totalPence },
    });
    // Drop requests for anyone no longer confirmed (e.g. dropped out before
    // re-entry). Upsert the rest so re-entering the total to fix it preserves
    // who's already marked themselves paid — we only refresh amount + link.
    await tx.paymentRequest.deleteMany({
      where: { gameId: game.id, debtorId: { notIn: debtorIds } },
    });
    for (const s of debtors) {
      // 1 share for themselves + 1 per +1 they brought.
      const shares = 1 + (guestCountByHost.get(s.userId) ?? 0);
      const amountPence = perPersonPence * shares;
      const paymentLink = generatePaymentLink(
        user.paymentMethod,
        user.paymentHandle!,
        amountPence,
        desc,
      );
      await tx.paymentRequest.upsert({
        where: { gameId_debtorId: { gameId: game.id, debtorId: s.userId } },
        create: {
          gameId: game.id,
          debtorId: s.userId,
          bookerId: user.id,
          amountPence,
          paymentLink,
        },
        update: { bookerId: user.id, amountPence, paymentLink },
      });
    }
  });

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
