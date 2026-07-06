import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer; calcSplit / generatePaymentLink / monzoDescription stay
// real so the split maths is exercised end to end.
const { db } = vi.hoisted(() => {
  const db = {
    game: { findUnique: vi.fn() },
    paymentRequest: { deleteMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  return { db };
});
vi.mock("@/lib/db", () => ({ prisma: db }));

import { setBilledMembers } from "@/lib/payments";

// gameId "g1", booker "u-booker" with a Monzo handle, £10 (1000p) pitch.
function game(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    kickoffAt: new Date("2026-06-07T11:00:00Z"),
    totalCostPence: 1000,
    bookerId: "u-booker",
    booker: { paymentMethod: "MONZO", paymentHandle: "booker" },
    guests: [],
    paymentRequests: [],
    ...overrides,
  };
}

/** Map of debtorId → amountPence from the upsert calls. */
function billed() {
  const out: Record<string, number> = {};
  for (const call of db.paymentRequest.upsert.mock.calls) {
    const arg = call[0] as {
      where: { gameId_debtorId: { debtorId: string } };
      create: { amountPence: number };
    };
    out[arg.where.gameId_debtorId.debtorId] = arg.create.amountPence;
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.paymentRequest.deleteMany.mockResolvedValue({});
  db.paymentRequest.upsert.mockResolvedValue({});
  db.game.findUnique.mockResolvedValue(game());
});

describe("setBilledMembers — guards", () => {
  it("errors when the game is missing", async () => {
    db.game.findUnique.mockResolvedValue(null);
    expect(await setBilledMembers("g1", ["a"])).toEqual({
      ok: false,
      error: "Game not found",
    });
  });

  it("errors when the cost hasn't been entered", async () => {
    db.game.findUnique.mockResolvedValue(game({ totalCostPence: null }));
    const r = await setBilledMembers("g1", ["a"]);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/cost/i) });
    expect(db.paymentRequest.upsert).not.toHaveBeenCalled();
  });

  it("errors when the booker has no payment handle", async () => {
    db.game.findUnique.mockResolvedValue(
      game({ booker: { paymentMethod: "MONZO", paymentHandle: null } }),
    );
    const r = await setBilledMembers("g1", ["a"]);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/username/i) });
  });
});

describe("setBilledMembers — split maths", () => {
  it("splits evenly across all heads incl. the booker", async () => {
    // booker + 4 others = 5 heads, £10 → £2 each. Only the 4 others are billed.
    const r = await setBilledMembers("g1", [
      "u-booker",
      "u1",
      "u2",
      "u3",
      "u4",
    ]);
    expect(r).toMatchObject({ ok: true, debtorCount: 4 });
    expect(billed()).toEqual({ u1: 200, u2: 200, u3: 200, u4: 200 });
    // Booker never gets billed.
    expect(billed()["u-booker"]).toBeUndefined();
  });

  it("recomputes a higher share when a no-show is dropped", async () => {
    // booker + 3 others = 4 heads, £10 → £2.50 each.
    const r = await setBilledMembers("g1", ["u-booker", "u1", "u2", "u3"]);
    expect(r).toMatchObject({ ok: true, debtorCount: 3 });
    expect(billed()).toEqual({ u1: 250, u2: 250, u3: 250 });
  });

  it("bills a host for their +1 (an extra share)", async () => {
    // booker + u1 + u1's guest = 3 heads, £9 → £3/head. u1 owes 2 shares = £6.
    db.game.findUnique.mockResolvedValue(
      game({ totalCostPence: 900, guests: [{ hostUserId: "u1" }] }),
    );
    const r = await setBilledMembers("g1", ["u-booker", "u1"]);
    expect(r).toMatchObject({ ok: true, debtorCount: 1 });
    expect(billed()).toEqual({ u1: 600 });
  });

  it("still bills a dropped host for their +1 (host played no part, owes the guest only)", async () => {
    // u2 dropped out (not in the billed list) but their +1 still plays, so the
    // guest stays and is billed to u2 — just the one share, no head for u2. Heads
    // = booker + u1 + u2's guest = 3, £10 → £3.33 floor each.
    db.game.findUnique.mockResolvedValue(
      game({ guests: [{ hostUserId: "u2" }] }),
    );
    const r = await setBilledMembers("g1", ["u-booker", "u1"]);
    expect(r).toMatchObject({ ok: true, debtorCount: 2 });
    expect(billed()).toEqual({ u1: 333, u2: 333 });
  });

  it("deletes rows for anyone no longer billed (never a paid row)", async () => {
    await setBilledMembers("g1", ["u-booker", "u1", "u2"]);
    expect(db.paymentRequest.deleteMany).toHaveBeenCalledWith({
      where: {
        gameId: "g1",
        debtorId: { notIn: ["u1", "u2"] },
        paidStatus: { not: "MARKED_PAID" },
      },
    });
  });

  it("clears all rows when only the booker is left (keeps paid rows)", async () => {
    const r = await setBilledMembers("g1", ["u-booker"]);
    expect(r).toMatchObject({ ok: true, debtorCount: 0 });
    expect(db.paymentRequest.deleteMany).toHaveBeenCalledWith({
      where: { gameId: "g1", paidStatus: { not: "MARKED_PAID" } },
    });
    expect(db.paymentRequest.upsert).not.toHaveBeenCalled();
  });
});

describe("setBilledMembers — frozen paid rows", () => {
  it("never reprices a MARKED_PAID debtor when the split changes", async () => {
    // u1 already paid £2 (their share when there were 5 heads). A no-show (u4)
    // is dropped → 4 heads, £2.50 each. u1 must keep their £2; only unpaid rows
    // get the higher share, and the booker absorbs the difference.
    db.game.findUnique.mockResolvedValue(
      game({
        paymentRequests: [
          { debtorId: "u1", paidStatus: "MARKED_PAID" },
          { debtorId: "u2", paidStatus: "UNPAID" },
          { debtorId: "u3", paidStatus: "UNPAID" },
        ],
      }),
    );
    await setBilledMembers("g1", ["u-booker", "u1", "u2", "u3"]);
    const amounts = billed();
    // u1's frozen row is left untouched (no upsert for them)...
    expect(amounts["u1"]).toBeUndefined();
    // ...while the unpaid debtors are recomputed at the new per-head share.
    expect(amounts).toEqual({ u2: 250, u3: 250 });
  });

  it("keeps a paid debtor billed even if the caller leaves them out", async () => {
    db.game.findUnique.mockResolvedValue(
      game({
        paymentRequests: [{ debtorId: "u1", paidStatus: "MARKED_PAID" }],
      }),
    );
    // Caller only bills u2, but u1 already paid — they must not be deleted.
    const r = await setBilledMembers("g1", ["u-booker", "u2"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.debtorCount).toBe(2); // u1 (paid) + u2
    // u1 isn't re-upserted (frozen); u2 is billed fresh.
    expect(billed()["u1"]).toBeUndefined();
    expect(Object.keys(billed())).toEqual(["u2"]);
  });
});
