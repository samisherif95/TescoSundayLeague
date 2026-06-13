import { prisma } from "@/lib/db";
import { SignupStatus } from "@/generated/prisma/enums";
import { sendEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";
import { env } from "@/lib/env";
import type { LeaveOutcome } from "@/lib/signups";

/**
 * Fan out the notifications that follow a drop-out (whether a player left of
 * their own accord or an admin removed them): the promoted waitlister, a fresh
 * booker, reassigned bibs/football, and a "game reopened" heads-up. Shared by
 * the self-serve drop-out and the admin removal so both paths notify identically.
 *
 * All sends are best-effort — a flaky email/push never blocks the drop-out,
 * which has already been committed by the time we get here.
 */
export async function notifyLeaveOutcome(
  gameId: string,
  outcome: LeaveOutcome,
): Promise<void> {
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
    const teamLabel = outcome.promotedTeamLabel;
    if (promoted?.email) {
      await sendEmail({
        to: promoted.email,
        subject: "You're in! Promoted from the waitlist",
        html: `<p>Hi ${promoted.name ?? "there"},</p>
          <p>A spot opened up for the ${when} game and you're now confirmed.${
            teamLabel
              ? ` You've taken the open spot in <strong>Team ${teamLabel}</strong>.`
              : ""
          } See you Sunday.</p>`,
      }).catch(() => undefined);
    }
    await sendPushToUsers([outcome.promotedUserId], {
      title: "You're in!",
      body: `A spot opened up for ${when} — you're confirmed.${
        teamLabel ? ` You're in Team ${teamLabel}.` : ""
      }`,
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
}
