// Group leaderboard: who's scored the most across a group's completed games.
// The ranking is intentionally a pure function of the goal rows so it can be
// unit-tested without a database (and reused for any goal set, e.g. a single
// game). Own goals and anonymous (un-credited) goals never count toward a
// scorer's tally — same rule as the per-game `tallyScorers` summary.

/** The minimal shape of a goal row this module needs to rank scorers. */
export type ScorerGoal = {
  scorerId: string | null;
  isOwnGoal: boolean;
  scorer: { id: string; name: string | null; image: string | null } | null;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  image: string | null;
  goals: number;
  // 1-based standing using standard competition ranking: players tied on goals
  // share a rank, and the next rank skips accordingly (1, 1, 3, …).
  rank: number;
};

/**
 * Rank a group's scorers by goals, most first. Ties are broken alphabetically
 * for a stable display order, but tied scorers still share a `rank`.
 */
export function buildLeaderboard(goals: ScorerGoal[]): LeaderboardEntry[] {
  const byScorer = new Map<string, { id: string; name: string; image: string | null; goals: number }>();
  for (const g of goals) {
    if (g.isOwnGoal || !g.scorerId) continue;
    const entry = byScorer.get(g.scorerId) ?? {
      id: g.scorerId,
      name: g.scorer?.name ?? "Unknown",
      image: g.scorer?.image ?? null,
      goals: 0,
    };
    entry.goals += 1;
    byScorer.set(g.scorerId, entry);
  }

  const sorted = [...byScorer.values()].sort(
    (a, b) => b.goals - a.goals || a.name.localeCompare(b.name),
  );

  let rank = 0;
  let prevGoals = Number.NaN;
  return sorted.map((entry, i) => {
    if (entry.goals !== prevGoals) {
      rank = i + 1;
      prevGoals = entry.goals;
    }
    return { ...entry, rank };
  });
}
