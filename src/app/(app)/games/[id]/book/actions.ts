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
  const { perPersonPence } = calcSplit(totalPence, game.signups.length);
  const desc = monzoDescription(game.kickoffAt);

  await prisma.$transaction(async (tx) => {
    await tx.paymentRequest.deleteMany({ where: { gameId: game.id } });
    await tx.game.update({
      where: { id: game.id },
      data: { status: GameStatus.BOOKED, totalCostPence: totalPence },
    });
    for (const s of game.signups) {
      if (s.userId === user.id) continue; // booker pays themselves implicitly
      await tx.paymentRequest.create({
        data: {
          gameId: game.id,
          debtorId: s.userId,
          bookerId: user.id,
          amountPence: perPersonPence,
          paymentLink: generatePaymentLink(
            user.paymentMethod,
            user.paymentHandle!,
            perPersonPence,
            desc,
          ),
        },
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
