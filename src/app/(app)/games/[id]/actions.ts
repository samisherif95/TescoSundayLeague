"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  PaymentStatus,
  Position,
  SignupStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireOnboardedUser, requireGameMember } from "@/lib/session";
import { joinGame, leaveGame } from "@/lib/signups";
import { sendEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";
import { env } from "@/lib/env";

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
  const gameUrl = `/games/${gameId}`;
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  const when = game?.kickoffAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });

  // Waitlister promoted into the freed spot.
  if (outcome.promotedUserId) {
    const promoted = await prisma.user.findUnique({
      where: { id: outcome.promotedUserId },
    });
    if (promoted?.email) {
      await sendEmail({
        to: promoted.email,
        subject: "You're in! Promoted from the waitlist",
        html: `<p>Hi ${promoted.name ?? "there"},</p>
          <p>A spot opened up for the ${when} game and you're now confirmed. See you Sunday.</p>`,
      }).catch(() => undefined);
    }
    await sendPushToUsers([outcome.promotedUserId], {
      title: "You're in!",
      body: `A spot opened up for ${when} — you're confirmed.`,
      url: gameUrl,
    });
  }

  // Booker dropped out and a new one was picked.
  if (outcome.newBookerId) {
    const newBooker = await prisma.user.findUnique({
      where: { id: outcome.newBookerId },
    });
    if (newBooker?.email) {
      await sendEmail({
        to: newBooker.email,
        subject: "You're now booking the pitch this Sunday",
        html: `<p>Hi ${newBooker.name ?? "there"},</p>
          <p>The original booker dropped out, so you've been picked to book the pitch for ${when}.</p>
          <p><a href="${env.appUrl}${gameUrl}/book">Open the booking page</a>.</p>`,
      }).catch(() => undefined);
    }
    await sendPushToUsers([outcome.newBookerId], {
      title: "You're now booking Sunday",
      body: "The previous booker dropped out — you've been picked.",
      url: `${gameUrl}/book`,
    });
    // Tell the rest of the squad the booker changed.
    const others = await prisma.signup.findMany({
      where: { gameId, status: SignupStatus.CONFIRMED },
      select: { userId: true },
    });
    await sendPushToUsers(
      others.map((s) => s.userId).filter((id) => id !== outcome.newBookerId),
      {
        title: "Booker changed",
        body: `${newBooker?.name ?? "Someone"} is now booking the pitch.`,
        url: gameUrl,
      },
    );
  }

  // Bibs / football duty reassigned because the previous holder dropped.
  if (outcome.newBibsUserId) {
    await sendPushToUsers([outcome.newBibsUserId], {
      title: "You've got the bibs 🦺",
      body: "Someone dropped out — you're now taking the bibs home this week.",
      url: gameUrl,
    });
  }
  if (outcome.newFootballUserId) {
    await sendPushToUsers([outcome.newFootballUserId], {
      title: "You've got the football ⚽",
      body: "Someone dropped out — you're now taking the ball home this week.",
      url: gameUrl,
    });
  }

  // Dropped below the minimum — game reopened for signups.
  if (outcome.revertedToOpen) {
    const confirmed = await prisma.signup.findMany({
      where: { gameId, status: SignupStatus.CONFIRMED },
      select: { userId: true },
    });
    await sendPushToUsers(
      confirmed.map((s) => s.userId),
      {
        title: "Game reopened",
        body: "We dropped below 10 — signups are open again. Grab a mate!",
        url: gameUrl,
      },
    );
  }

  revalidatePath(gameUrl);
  revalidatePath(`${gameUrl}/book`);
  revalidatePath("/");
  return { ok: true as const };
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
