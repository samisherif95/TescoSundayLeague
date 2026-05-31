import { MatchPhase } from "@/generated/prisma/enums";

/**
 * Match rules for our format:
 *  - First to {@link GOAL_TARGET} goals, or {@link REGULATION_MS} of time,
 *    ends regular play.
 *  - A tie at the end of regular play goes to a {@link GOLDEN_GOAL_MS}
 *    golden-goal period (first goal wins).
 *  - Still tied after golden goal → penalties.
 */
export const GOAL_TARGET = 3;
export const REGULATION_MS = 15 * 60 * 1000;
export const GOLDEN_GOAL_MS = 5 * 60 * 1000;

/** Time limit (ms) for a phase, or null if the phase isn't timed (penalties). */
export function phaseLimitMs(phase: MatchPhase): number | null {
  switch (phase) {
    case MatchPhase.REGULAR:
      return REGULATION_MS;
    case MatchPhase.GOLDEN_GOAL:
      return GOLDEN_GOAL_MS;
    case MatchPhase.PENALTIES:
      return null;
  }
}

/** The minimal stopwatch state every elapsed/remaining calc needs. */
export type ClockState = {
  // Date on the server; epoch-ms number once serialized to the client.
  periodStartedAt: Date | string | number | null;
  accumulatedMs: number;
};

/**
 * Milliseconds elapsed in the current phase. While the clock runs we add the
 * wall-time since it last started; while paused we just return the banked time.
 * Pass `now` for deterministic server-side checks.
 */
export function elapsedMs(clock: ClockState, now: number = Date.now()): number {
  const banked = clock.accumulatedMs;
  if (!clock.periodStartedAt) return banked;
  const started = new Date(clock.periodStartedAt).getTime();
  return banked + Math.max(0, now - started);
}

/**
 * Milliseconds left in the current phase (clamped at 0), or null for an
 * untimed phase (penalties).
 */
export function remainingMs(
  clock: ClockState & { phase: MatchPhase },
  now: number = Date.now(),
): number | null {
  const limit = phaseLimitMs(clock.phase);
  if (limit === null) return null;
  return Math.max(0, limit - elapsedMs(clock, now));
}

/** mm:ss for a millisecond duration. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Regular-play score (REGULAR + GOLDEN_GOAL goals) for the two teams. */
export function deriveScore(
  goals: { teamId: string; phase: MatchPhase }[],
  homeTeamId: string,
  awayTeamId: string,
): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const g of goals) {
    if (g.phase === MatchPhase.PENALTIES) continue;
    if (g.teamId === homeTeamId) home += 1;
    else if (g.teamId === awayTeamId) away += 1;
  }
  return { home, away };
}

/** True once a side has hit the goal target — regular play ends immediately. */
export function reachedGoalTarget(home: number, away: number): boolean {
  return home >= GOAL_TARGET || away >= GOAL_TARGET;
}
