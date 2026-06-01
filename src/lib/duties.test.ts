import { describe, it, expect } from "vitest";
import { assignExtras, isExemptFromDuties, pickExtra } from "@/lib/duties";

// The hardcoded exemption (the organiser, who never gets a duty).
const EXEMPT = "sellaboudy95@gmail.com";

function squad(n: number, opts: { exemptAt?: number } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    email: opts.exemptAt === i ? EXEMPT : `p${i}@example.com`,
  }));
}

describe("isExemptFromDuties", () => {
  it("matches the exempt email case-insensitively", () => {
    expect(isExemptFromDuties(EXEMPT)).toBe(true);
    expect(isExemptFromDuties(EXEMPT.toUpperCase())).toBe(true);
  });

  it("is false for other emails and for null/undefined", () => {
    expect(isExemptFromDuties("someone@else.com")).toBe(false);
    expect(isExemptFromDuties(null)).toBe(false);
    expect(isExemptFromDuties(undefined)).toBe(false);
  });
});

describe("assignExtras", () => {
  it("picks bibs and football as distinct, non-booker players when the pool is large", () => {
    const players = squad(12);
    for (let run = 0; run < 30; run++) {
      const { bibsUserId, footballUserId } = assignExtras(players, "p0");
      expect(bibsUserId).not.toBeNull();
      expect(footballUserId).not.toBeNull();
      expect(bibsUserId).not.toBe("p0");
      expect(footballUserId).not.toBe("p0");
      expect(bibsUserId).not.toBe(footballUserId);
      expect(players.map((p) => p.id)).toContain(bibsUserId!);
      expect(players.map((p) => p.id)).toContain(footballUserId!);
    }
  });

  it("never assigns a duty to an exempt player", () => {
    const players = squad(12, { exemptAt: 3 });
    for (let run = 0; run < 50; run++) {
      const { bibsUserId, footballUserId } = assignExtras(players, "p0");
      expect(bibsUserId).not.toBe("p3");
      expect(footballUserId).not.toBe("p3");
    }
  });

  it("returns nulls when every player is exempt", () => {
    const players = [
      { id: "a", email: EXEMPT },
      { id: "b", email: EXEMPT },
    ];
    expect(assignExtras(players, null)).toEqual({
      bibsUserId: null,
      footballUserId: null,
    });
  });
});

describe("pickExtra", () => {
  it("avoids the given ids", () => {
    const players = squad(5);
    for (let run = 0; run < 30; run++) {
      const id = pickExtra(players, ["p0", "p1"]);
      expect(["p2", "p3", "p4"]).toContain(id!);
    }
  });

  it("returns null when no eligible players remain", () => {
    expect(pickExtra([{ id: "a", email: EXEMPT }], [])).toBeNull();
  });
});
