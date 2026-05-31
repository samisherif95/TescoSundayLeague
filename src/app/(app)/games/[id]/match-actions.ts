"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { MatchPhase, MatchStatus } from "@/generated/prisma/enums";
import { deriveScore, elapsedMs, reachedGoalTarget } from "@/lib/match";
import { authorizeBookingMember } from "@/lib/booking-access";

type ActionError = { error: string };
type ActionOk = { ok: true };

// Recording is open to anyone playing that Sunday — see authorizeBookingMember.
const authorizeRecorder = authorizeBookingMember;

function revalidateGame(gameId: string) {
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/");
}

const createSchema = z.object({
  gameId: z.string().min(1),
  homeTeamId: z.string().min(1),
  awayTeamId: z.string().min(1),
});

/** Kick off a new match between two of the game's teams. Starts the clock. */
export async function createMatchAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionOk | ActionError> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { gameId, homeTeamId, awayTeamId } = parsed.data;
  if (homeTeamId === awayTeamId) {
    return { error: "Pick two different teams" };
  }

  const auth = await authorizeRecorder(gameId);
  if ("error" in auth) return auth;

  // Only one match in flight at a time — finish the current one first.
  const active = await prisma.match.findFirst({
    where: { gameId, status: { not: MatchStatus.COMPLETED } },
    select: { id: true },
  });
  if (active) return { error: "Finish the current match first" };

  const teams = await prisma.team.findMany({
    where: { gameId, id: { in: [homeTeamId, awayTeamId] } },
    select: { id: true },
  });
  if (teams.length !== 2) return { error: "Those teams aren't in this game" };

  const count = await prisma.match.count({ where: { gameId } });
  const now = new Date();
  await prisma.match.create({
    data: {
      gameId,
      order: count + 1,
      homeTeamId,
      awayTeamId,
      status: MatchStatus.LIVE,
      phase: MatchPhase.REGULAR,
      periodStartedAt: now,
      startedAt: now,
    },
  });
  revalidateGame(gameId);
  return { ok: true };
}

/** Load a match (with the bits we need) and authorize the caller. */
async function loadEditableMatch(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { goals: { select: { teamId: true, phase: true } } },
  });
  if (!match) return { ok: false as const, error: "Match not found" };
  const auth = await authorizeRecorder(match.gameId);
  if ("error" in auth) return { ok: false as const, error: auth.error };
  return { ok: true as const, match };
}

export async function pauseMatchAction(
  matchId: string,
): Promise<ActionOk | ActionError> {
  const loaded = await loadEditableMatch(matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;
  if (match.status !== MatchStatus.LIVE) return { ok: true };
  await prisma.match.update({
    where: { id: matchId },
    data: {
      status: MatchStatus.PAUSED,
      accumulatedMs: elapsedMs(match),
      periodStartedAt: null,
    },
  });
  revalidateGame(match.gameId);
  return { ok: true };
}

export async function resumeMatchAction(
  matchId: string,
): Promise<ActionOk | ActionError> {
  const loaded = await loadEditableMatch(matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;
  if (match.status !== MatchStatus.PAUSED) return { ok: true };
  if (match.phase === MatchPhase.PENALTIES) {
    return { error: "Penalties aren't timed" };
  }
  await prisma.match.update({
    where: { id: matchId },
    data: { status: MatchStatus.LIVE, periodStartedAt: new Date() },
  });
  revalidateGame(match.gameId);
  return { ok: true };
}

const goalSchema = z.object({
  matchId: z.string().min(1),
  teamId: z.string().min(1),
  scorerId: z.string().min(1).nullable().optional(),
  isOwnGoal: z.boolean().optional(),
});

/** Log a goal. Auto-completes the match on the 3rd goal or a golden goal. */
export async function logGoalAction(
  input: z.infer<typeof goalSchema>,
): Promise<ActionOk | ActionError> {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { matchId, teamId, scorerId, isOwnGoal } = parsed.data;

  const loaded = await loadEditableMatch(matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;

  if (match.status === MatchStatus.COMPLETED) {
    return { error: "This match is already finished" };
  }
  if (match.phase === MatchPhase.PENALTIES) {
    return { error: "Enter the penalty result instead" };
  }
  if (teamId !== match.homeTeamId && teamId !== match.awayTeamId) {
    return { error: "That team isn't in this match" };
  }
  if (scorerId) {
    const signup = await prisma.signup.findUnique({
      where: { gameId_userId: { gameId: match.gameId, userId: scorerId } },
      select: { userId: true },
    });
    if (!signup) return { error: "Scorer isn't in this game" };
  }

  const clockMs = elapsedMs(match);
  const nextGoals = [...match.goals, { teamId, phase: match.phase }];
  const score = deriveScore(nextGoals, match.homeTeamId, match.awayTeamId);

  // Does this goal end the match?
  let finish: { winnerTeamId: string } | null = null;
  if (match.phase === MatchPhase.GOLDEN_GOAL) {
    finish = { winnerTeamId: teamId }; // first golden goal wins
  } else if (reachedGoalTarget(score.home, score.away)) {
    finish = {
      winnerTeamId: score.home > score.away ? match.homeTeamId : match.awayTeamId,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.goal.create({
      data: {
        matchId,
        teamId,
        scorerId: scorerId ?? null,
        phase: match.phase,
        isOwnGoal: isOwnGoal ?? false,
        clockMs: Math.round(clockMs),
      },
    });
    if (finish) {
      await tx.match.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.COMPLETED,
          completedAt: new Date(),
          winnerTeamId: finish.winnerTeamId,
          accumulatedMs: Math.round(elapsedMs(match)),
          periodStartedAt: null,
        },
      });
    }
  });
  revalidateGame(match.gameId);
  return { ok: true };
}

/**
 * Remove a goal (fat-finger fix). If it had finished the match, the match
 * reopens (paused) so play can continue.
 */
export async function removeGoalAction(
  goalId: string,
): Promise<ActionOk | ActionError> {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { matchId: true },
  });
  if (!goal) return { ok: true };
  const loaded = await loadEditableMatch(goal.matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;

  await prisma.$transaction(async (tx) => {
    await tx.goal.delete({ where: { id: goalId } });
    // Reopen only if the result hinged on field goals. A penalty-decided match
    // keeps its winner — removing an earlier goal must not wipe the shootout
    // result or strand the penalty counts in a now-"PAUSED" match.
    if (
      match.status === MatchStatus.COMPLETED &&
      match.winnerTeamId &&
      match.phase !== MatchPhase.PENALTIES
    ) {
      // The result hinged on goals — reopen so they can keep playing.
      await tx.match.update({
        where: { id: match.id },
        data: {
          status: MatchStatus.PAUSED,
          completedAt: null,
          winnerTeamId: null,
          periodStartedAt: null,
        },
      });
    }
  });
  revalidateGame(match.gameId);
  return { ok: true };
}

/**
 * Finish the match right now (e.g. 15 minutes are up). The leader wins; if it's
 * level it's recorded as a draw (an "we're tired, call it" escape hatch — the
 * golden-goal / penalties buttons are the proper tie-breakers).
 */
export async function endMatchNowAction(
  matchId: string,
): Promise<ActionOk | ActionError> {
  const loaded = await loadEditableMatch(matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;
  if (match.status === MatchStatus.COMPLETED) return { ok: true };

  const score = deriveScore(match.goals, match.homeTeamId, match.awayTeamId);
  const winnerTeamId =
    score.home > score.away
      ? match.homeTeamId
      : score.away > score.home
        ? match.awayTeamId
        : null;
  await prisma.match.update({
    where: { id: matchId },
    data: {
      status: MatchStatus.COMPLETED,
      completedAt: new Date(),
      winnerTeamId,
      accumulatedMs: Math.round(elapsedMs(match)),
      periodStartedAt: null,
    },
  });
  revalidateGame(match.gameId);
  return { ok: true };
}

/** Tied at full time → start the 5-minute golden-goal period. */
export async function startGoldenGoalAction(
  matchId: string,
): Promise<ActionOk | ActionError> {
  const loaded = await loadEditableMatch(matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;
  if (match.status === MatchStatus.COMPLETED) {
    return { error: "This match is already finished" };
  }
  if (match.phase !== MatchPhase.REGULAR) {
    return { error: "Golden goal only follows regular play" };
  }
  const score = deriveScore(match.goals, match.homeTeamId, match.awayTeamId);
  if (score.home !== score.away) {
    return { error: "Scores aren't level — there's already a winner" };
  }
  await prisma.match.update({
    where: { id: matchId },
    data: {
      phase: MatchPhase.GOLDEN_GOAL,
      status: MatchStatus.LIVE,
      accumulatedMs: 0,
      periodStartedAt: new Date(),
    },
  });
  revalidateGame(match.gameId);
  return { ok: true };
}

/** Golden goal settled nothing → go to penalties. */
export async function startPenaltiesAction(
  matchId: string,
): Promise<ActionOk | ActionError> {
  const loaded = await loadEditableMatch(matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;
  if (match.status === MatchStatus.COMPLETED) {
    return { error: "This match is already finished" };
  }
  if (match.phase !== MatchPhase.GOLDEN_GOAL) {
    return { error: "Penalties only follow a golden-goal period" };
  }
  await prisma.match.update({
    where: { id: matchId },
    data: {
      phase: MatchPhase.PENALTIES,
      status: MatchStatus.PAUSED,
      accumulatedMs: 0,
      periodStartedAt: null,
    },
  });
  revalidateGame(match.gameId);
  return { ok: true };
}

const penaltiesSchema = z.object({
  matchId: z.string().min(1),
  homePenalties: z.number().int().min(0).max(99),
  awayPenalties: z.number().int().min(0).max(99),
});

/** Record the penalty shootout result and finish the match. */
export async function recordPenaltiesAction(
  input: z.infer<typeof penaltiesSchema>,
): Promise<ActionOk | ActionError> {
  const parsed = penaltiesSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { matchId, homePenalties, awayPenalties } = parsed.data;
  if (homePenalties === awayPenalties) {
    return { error: "Penalties can't be a tie — there must be a winner" };
  }
  const loaded = await loadEditableMatch(matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;
  if (match.status === MatchStatus.COMPLETED) {
    return { error: "This match is already finished" };
  }
  if (match.phase !== MatchPhase.PENALTIES) {
    return { error: "Start penalties before recording the result" };
  }

  await prisma.match.update({
    where: { id: matchId },
    data: {
      phase: MatchPhase.PENALTIES,
      status: MatchStatus.COMPLETED,
      completedAt: new Date(),
      homePenalties,
      awayPenalties,
      periodStartedAt: null,
      winnerTeamId:
        homePenalties > awayPenalties ? match.homeTeamId : match.awayTeamId,
    },
  });
  revalidateGame(match.gameId);
  return { ok: true };
}

/** Delete a match entirely (cascades its goals). */
export async function deleteMatchAction(
  matchId: string,
): Promise<ActionOk | ActionError> {
  const loaded = await loadEditableMatch(matchId);
  if (!loaded.ok) return { error: loaded.error };
  const { match } = loaded;
  await prisma.match.delete({ where: { id: matchId } });
  revalidateGame(match.gameId);
  return { ok: true };
}
