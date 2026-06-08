import { describe, it, expect } from "vitest";
import { assignExtras, pickExtra } from "@/lib/duties";

// Exemption is now a per-player boolean (from GroupMember.exemptFromDuties),
// not a hardcoded email.
function squad(n: number, opts: { exemptAt?: number } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    exempt: opts.exemptAt === i,
  }));
}

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
      { id: "a", exempt: true },
      { id: "b", exempt: true },
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
    expect(pickExtra([{ id: "a", exempt: true }], [])).toBeNull();
  });
});
