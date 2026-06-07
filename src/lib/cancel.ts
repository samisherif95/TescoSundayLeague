import { prisma } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { sendEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";

export type CancelResult =
  | { ok: true; gameId: string }
  | { ok: false; error: string };

/**
 * Cancel a single game: flip it to CANCELLED and tell everyone who'd signed up
 * (email + push). Use when the week falls through — not enough players, pitch
 * unavailable, etc. Works from OPEN / LOCKED / BOOKED; a game that's already
 * COMPLETED or CANCELLED returns a clear error instead of re-notifying.
 *
 * Notifications are best-effort: a flaky SMTP/push send never rolls back the
 * cancellation (the status flip is already committed). Unlike the (disabled)
 * Friday cron, this does NOT roll forward to next Sunday — an admin opens the
 * next game by hand.
 */
export async function cancelGame(gameId: string): Promise<CancelResult> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        include: { user: { select: { id: true, email: true } } },
      },
    },
  });

  if (!game) return { ok: false, error: "Game not found" };
  if (
    game.status === GameStatus.CANCELLED ||
    game.status === GameStatus.COMPLETED
  ) {
    return { ok: false, error: "Game is already finished or cancelled." };
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { status: GameStatus.CANCELLED },
  });

  await notifyCancelled(game.signups);

  return { ok: true, gameId: game.id };
}

/** Tell everyone the game's off (email + push). Best-effort; never throws. */
async function notifyCancelled(
  signups: { user: { id: string; email: string | null } }[],
): Promise<void> {
  await Promise.allSettled(
    signups
      .map((s) => s.user.email)
      .filter((e): e is string => Boolean(e))
      .map((email) =>
        sendEmail({
          to: email,
          subject: "Sunday football is cancelled",
          html: `<p>Heads up — this Sunday's game has been cancelled.</p>
            <p>No worries — keep an eye out for next week's game opening soon.</p>`,
        }),
      ),
  );

  await sendPushToUsers(
    signups.map((s) => s.user.id),
    {
      title: "Sunday's game is off",
      body: "This week's game has been cancelled. Next week's will open soon.",
      url: "/home",
    },
  );
}
