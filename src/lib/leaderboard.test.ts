import { describe, it, expect } from "vitest";
import { buildLeaderboard, type ScorerGoal } from "@/lib/leaderboard";

function goal(
  scorerId: string | null,
  name: string | null = null,
  opts: { isOwnGoal?: boolean; image?: string | null } = {},
): ScorerGoal {
  return {
    scorerId,
    isOwnGoal: opts.isOwnGoal ?? false,
    scorer: scorerId
      ? { id: scorerId, name, image: opts.image ?? null }
      : null,
  };
}

describe("buildLeaderboard", () => {
  it("returns an empty board for no goals", () => {
    expect(buildLeaderboard([])).toEqual([]);
  });

  it("tallies goals per scorer, most first", () => {
    const board = buildLeaderboard([
      goal("a", "Alex"),
      goal("b", "Sam"),
      goal("a", "Alex"),
      goal("a", "Alex"),
      goal("b", "Sam"),
    ]);
    expect(board.map((e) => [e.name, e.goals])).toEqual([
      ["Alex", 3],
      ["Sam", 2],
    ]);
  });

  it("excludes own goals and anonymous goals from the tally", () => {
    const board = buildLeaderboard([
      goal("a", "Alex"),
      goal("a", "Alex", { isOwnGoal: true }),
      goal(null), // bumped score, no named scorer
    ]);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ name: "Alex", goals: 1 });
  });

  it("ranks ties equally and skips the next rank (1, 1, 3)", () => {
    const board = buildLeaderboard([
      goal("a", "Alex"),
      goal("a", "Alex"),
      goal("b", "Ben"),
      goal("b", "Ben"),
      goal("c", "Cara"),
    ]);
    expect(board.map((e) => [e.name, e.goals, e.rank])).toEqual([
      ["Alex", 2, 1],
      ["Ben", 2, 1],
      ["Cara", 1, 3],
    ]);
  });

  it("breaks display ties alphabetically by name", () => {
    const board = buildLeaderboard([goal("z", "Zoe"), goal("a", "Aaron")]);
    expect(board.map((e) => e.name)).toEqual(["Aaron", "Zoe"]);
  });

  it("carries the scorer's id and image through", () => {
    const [entry] = buildLeaderboard([
      goal("a", "Alex", { image: "https://img/a.png" }),
    ]);
    expect(entry).toEqual({
      id: "a",
      name: "Alex",
      image: "https://img/a.png",
      goals: 1,
      rank: 1,
    });
  });

  it("falls back to 'Unknown' when a scorer row has no name", () => {
    const [entry] = buildLeaderboard([goal("a", null)]);
    expect(entry.name).toBe("Unknown");
  });
});
