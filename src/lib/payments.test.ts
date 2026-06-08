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

  it("drops a removed member's +1 from the head count too", async () => {
    // u2 (removed) had brought a guest; only booker + u1 remain = 2 heads,
    // £10 → £5 each. The removed member's guest doesn't inflate the count.
    db.game.findUnique.mockResolvedValue(
      game({ guests: [{ hostUserId: "u2" }] }),
    );
    const r = await setBilledMembers("g1", ["u-booker", "u1"]);
    expect(r).toMatchObject({ ok: true, debtorCount: 1 });
    expect(billed()).toEqual({ u1: 500 });
  });

  it("deletes rows for anyone no longer billed", async () => {
    await setBilledMembers("g1", ["u-booker", "u1", "u2"]);
    expect(db.paymentRequest.deleteMany).toHaveBeenCalledWith({
      where: { gameId: "g1", debtorId: { notIn: ["u1", "u2"] } },
    });
  });

  it("clears all rows when only the booker is left", async () => {
    const r = await setBilledMembers("g1", ["u-booker"]);
    expect(r).toMatchObject({ ok: true, debtorCount: 0 });
    expect(db.paymentRequest.deleteMany).toHaveBeenCalledWith({
      where: { gameId: "g1" },
    });
    expect(db.paymentRequest.upsert).not.toHaveBeenCalled();
  });
});
