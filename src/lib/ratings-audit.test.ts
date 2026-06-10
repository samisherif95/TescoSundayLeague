import { describe, it, expect } from "vitest";
import {
  canViewRatingsAudit,
  groupRatingsByRater,
  RATINGS_AUDIT_EMAIL,
  type AuditUser,
} from "@/lib/ratings-audit";

function user(id: string, name: string | null): AuditUser {
  return { id, name, image: null };
}

describe("canViewRatingsAudit", () => {
  it("allows only the platform owner's email", () => {
    expect(canViewRatingsAudit(RATINGS_AUDIT_EMAIL)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(canViewRatingsAudit("SellAboudy95@Gmail.com")).toBe(true);
  });

  it("rejects everyone else, including missing emails", () => {
    expect(canViewRatingsAudit("someone@else.com")).toBe(false);
    expect(canViewRatingsAudit(null)).toBe(false);
    expect(canViewRatingsAudit(undefined)).toBe(false);
    expect(canViewRatingsAudit("")).toBe(false);
  });
});

describe("groupRatingsByRater", () => {
  it("returns no groups for no ratings", () => {
    expect(groupRatingsByRater([])).toEqual([]);
  });

  it("groups ratings under the rater who gave them", () => {
    const alex = user("a", "Alex");
    const ben = user("b", "Ben");
    const cara = user("c", "Cara");
    const groups = groupRatingsByRater([
      { rater: alex, ratee: ben, score: 4 },
      { rater: alex, ratee: cara, score: 2 },
      { rater: ben, ratee: alex, score: 5 },
    ]);
    expect(
      groups.map((g) => [
        g.rater.name,
        g.given.map((x) => [x.ratee.name, x.score]),
      ]),
    ).toEqual([
      ["Alex", [["Ben", 4], ["Cara", 2]]],
      ["Ben", [["Alex", 5]]],
    ]);
  });

  it("sorts raters and each rater's ratees alphabetically", () => {
    const zoe = user("z", "Zoe");
    const aaron = user("a", "Aaron");
    const mia = user("m", "Mia");
    const groups = groupRatingsByRater([
      { rater: zoe, ratee: mia, score: 3 },
      { rater: zoe, ratee: aaron, score: 5 },
      { rater: aaron, ratee: zoe, score: 1 },
    ]);
    expect(groups.map((g) => g.rater.name)).toEqual(["Aaron", "Zoe"]);
    expect(groups[1].given.map((x) => x.ratee.name)).toEqual(["Aaron", "Mia"]);
  });

  it("sorts unnamed users under the 'Unnamed' fallback", () => {
    const anon = user("x", null);
    const ben = user("b", "Ben");
    const groups = groupRatingsByRater([
      { rater: anon, ratee: ben, score: 3 },
      { rater: ben, ratee: anon, score: 4 },
    ]);
    expect(groups.map((g) => g.rater.name)).toEqual(["Ben", null]);
  });
});
