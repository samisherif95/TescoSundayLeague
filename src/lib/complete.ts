import { prisma } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { sendEmail } from "@/lib/email";
import { generatePaymentRequests } from "@/lib/payments";
import { env } from "@/lib/env";

export type CompleteResult =
  | { ok: true; gameId: string }
  | { ok: false; error: string };

/**
 * Complete a single game: flip it to COMPLETED and email everyone the
 * "rate your teammates" link. Mirrors {@link lockGame} as the single source of
 * truth shared by:
 *  - the Sunday-complete cron (src/app/api/cron/sunday-complete/route.ts), and
 *  - the admin "End game now" button on the game page.
 *
 * A game can be ended from BOOKED (booker entered the cost) or LOCKED (teams
 * are out but the booker never recorded the cost). Idempotent on status — a
 * game that's already COMPLETED/CANCELLED returns a clear error instead of
 * re-sending the rating emails.
 *
 * The rating emails are best-effort: a flaky SMTP send never rolls back the
 * completion (the status flip is already committed).
 */
export async function completeGame(gameId: string): Promise<CompleteResult> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        include: { user: { select: { email: true, name: true } } },
      },
    },
  });

  if (!game) return { ok: false, error: "Game not found" };
  if (game.status !== GameStatus.BOOKED && game.status !== GameStatus.LOCKED) {
    return {
      ok: false,
      error: "Game can only be ended once it's locked or booked.",
    };
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { status: GameStatus.COMPLETED },
  });

  // Now that the squad's final (no-shows can still be removed afterwards),
  // generate the payment split and reveal it. Best-effort — a missing cost or
  // booker handle leaves the panel empty rather than blocking completion.
  await generatePaymentRequests(game.id).catch(() => undefined);

  await notifyCompleted(game.id, game.signups);

  return { ok: true, gameId: game.id };
}

/** Email everyone the rating link. Best-effort; never throws. */
async function notifyCompleted(
  gameId: string,
  signups: { user: { email: string | null; name: string | null } }[],
): Promise<void> {
  await Promise.allSettled(
    signups
      .map((s) => ({ email: s.user.email, name: s.user.name }))
      .filter((p): p is { email: string; name: string | null } =>
        Boolean(p.email),
      )
      .map((p) =>
        sendEmail({
          to: p.email,
          subject: "Rate your teammates",
          html: `<p>Hi ${p.name ?? "there"},</p>
            <p>Hope the game was good. <a href="${env.appUrl}/games/${gameId}/rate">Rate your teammates</a> (1–5, anonymous, optional) — feeds into next week's team balancing.</p>`,
        }),
      ),
  );
}
