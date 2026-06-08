import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth, DB and the payments lib (its maths is tested separately).
const { db, requireAdmin, setBilledMembers, generatePaymentRequests } =
  vi.hoisted(() => ({
    db: { game: { findUnique: vi.fn() } },
    requireAdmin: vi.fn(),
    setBilledMembers: vi.fn(),
    generatePaymentRequests: vi.fn(),
  }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({ requireGameAdmin: requireAdmin }));
vi.mock("@/lib/payments", () => ({ setBilledMembers, generatePaymentRequests }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { removeDebtorAction } from "@/app/(app)/admin/actions";

function game(overrides = {}) {
  return {
    bookerId: "u-booker",
    paymentRequests: [
      { debtorId: "u1" },
      { debtorId: "u2" },
      { debtorId: "u3" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin1", isAdmin: true });
  setBilledMembers.mockResolvedValue({ ok: true });
  db.game.findUnique.mockResolvedValue(game());
});

describe("removeDebtorAction", () => {
  it("errors when the game is missing", async () => {
    db.game.findUnique.mockResolvedValue(null);
    const r = await removeDebtorAction("g1", "u1");
    expect(r).toEqual({ error: "Game not found" });
    expect(setBilledMembers).not.toHaveBeenCalled();
  });

  it("refuses to remove the booker (they're never billed)", async () => {
    const r = await removeDebtorAction("g1", "u-booker");
    expect(r).toMatchObject({ error: expect.stringMatching(/booker/i) });
    expect(setBilledMembers).not.toHaveBeenCalled();
  });

  it("rebills the remaining debtors without the removed one", async () => {
    const r = await removeDebtorAction("g1", "u2");
    expect(r).toEqual({ ok: true });
    // u2 dropped; booker is re-added as a head inside setBilledMembers.
    expect(setBilledMembers).toHaveBeenCalledWith("g1", ["u1", "u3"]);
  });

  it("surfaces a payments error (e.g. cost not entered)", async () => {
    setBilledMembers.mockResolvedValue({ ok: false, error: "no cost" });
    const r = await removeDebtorAction("g1", "u1");
    expect(r).toEqual({ error: "no cost" });
  });
});
