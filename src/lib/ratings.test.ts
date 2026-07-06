import { describe, it, expect } from "vitest";
import { buildRatingsBoard, type RatingMember } from "@/lib/ratings";

function member(
  id: string,
  name: string | null,
  skillScore: number,
  ratingsCount: number,
): RatingMember {
  return { id, name, image: null, position: null, skillScore, ratingsCount };
}

describe("buildRatingsBoard", () => {
  it("returns an empty board for no members", () => {
    expect(buildRatingsBoard([])).toEqual([]);
  });

  it("ranks rated members by score, highest first", () => {
    const board = buildRatingsBoard([
      member("a", "Alex", 3.5, 4),
      member("b", "Sam", 4.2, 6),
      member("c", "Cara", 2.8, 2),
    ]);
    expect(board.map((e) => [e.name, e.rank])).toEqual([
      ["Sam", 1],
      ["Alex", 2],
      ["Cara", 3],
    ]);
  });

  it("lists unrated members last with a null rank, regardless of default score", () => {
    const board = buildRatingsBoard([
      member("a", "Alex", 4.0, 3),
      member("b", "Ben", 3.0, 0), // default score, but never actually rated
    ]);
    expect(board.map((e) => [e.name, e.rank, e.ratingsCount])).toEqual([
      ["Alex", 1, 3],
      ["Ben", null, 0],
    ]);
  });

  it("ranks score ties equally and skips the next rank (1, 1, 3)", () => {
    const board = buildRatingsBoard([
      member("a", "Alex", 4.0, 2),
      member("b", "Ben", 4.0, 5),
      member("c", "Cara", 3.0, 1),
    ]);
    expect(board.map((e) => [e.name, e.rank])).toEqual([
      ["Alex", 1],
      ["Ben", 1],
      ["Cara", 3],
    ]);
  });

  it("breaks display ties alphabetically by name", () => {
    const board = buildRatingsBoard([
      member("z", "Zoe", 4.0, 2),
      member("a", "Aaron", 4.0, 2),
    ]);
    expect(board.map((e) => e.name)).toEqual(["Aaron", "Zoe"]);
  });

  it("orders unrated members alphabetically", () => {
    const board = buildRatingsBoard([
      member("z", "Zoe", 3.0, 0),
      member("a", "Aaron", 3.0, 0),
    ]);
    expect(board.map((e) => [e.name, e.rank])).toEqual([
      ["Aaron", null],
      ["Zoe", null],
    ]);
  });

  it("falls back to 'Unnamed' for a member with no name", () => {
    const [entry] = buildRatingsBoard([member("a", null, 4.0, 1)]);
    expect(entry.name).toBe("Unnamed");
  });
});
