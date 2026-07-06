import { prisma } from "@/lib/db";
import {
  GameStatus,
  MatchStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import { sendEmail, escapeHtml } from "@/lib/email";
import { generatePaymentRequests } from "@/lib/payments";
import { deriveScore, elapsedMs } from "@/lib/match";
import { env } from "@/lib/env";

export type CompleteResult =
  | { ok: true; gameId: string }
  | { ok: false; error: string };

/**
 * Complete a single game: flip it to COMPLETED and email everyone the
 * "rate your teammates" link. Driven by the admin "End game now" button on the
 * game page.
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

  // Conditional flip: only transition if the game is STILL locked/booked. Guards
  // against a double-click (or a concurrent cancel) both passing the check above
  // and re-sending the rating blast / re-splitting payments.
  const flipped = await prisma.game.updateMany({
    where: {
      id: game.id,
      status: { in: [GameStatus.BOOKED, GameStatus.LOCKED] },
    },
    data: { status: GameStatus.COMPLETED, completedAt: new Date() },
  });
  if (flipped.count === 0) {
    return {
      ok: false,
      error: "Game can only be ended once it's locked or booked.",
    };
  }

  // Settle any match still in progress — otherwise it stays "live" forever on
  // the completed game's page and every viewer's poll keeps refreshing it. The
  // leader wins; a level match is recorded as a draw (same as "end match now").
  const liveMatches = await prisma.match.findMany({
    where: { gameId: game.id, status: { not: MatchStatus.COMPLETED } },
    include: { goals: { select: { teamId: true, phase: true } } },
  });
  for (const m of liveMatches) {
    const score = deriveScore(m.goals, m.homeTeamId, m.awayTeamId);
    const winnerTeamId =
      score.home > score.away
        ? m.homeTeamId
        : score.away > score.home
          ? m.awayTeamId
          : null;
    await prisma.match.update({
      where: { id: m.id },
      data: {
        status: MatchStatus.COMPLETED,
        completedAt: new Date(),
        winnerTeamId,
        accumulatedMs: Math.round(elapsedMs(m)),
        periodStartedAt: null,
      },
    });
  }

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
          html: `<p>Hi ${escapeHtml(p.name) || "there"},</p>
            <p>Hope the game was good. <a href="${env.appUrl}/games/${gameId}/rate">Rate your teammates</a> (1–5, anonymous, optional) — feeds into next week's team balancing.</p>`,
        }),
      ),
  );
}
