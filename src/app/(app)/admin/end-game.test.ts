import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";

// Mock the layers the action + shared completer depend on (auth, DB, email,
// cache revalidation).
const { db, requireAdmin, sendEmail } = vi.hoisted(() => ({
  db: { game: { findUnique: vi.fn(), update: vi.fn() } },
  requireAdmin: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({ requireAdmin }));
vi.mock("@/lib/email", () => ({ sendEmail }));
// completeGame generates the payment split on completion — stubbed here so the
// status + rating-email behaviour is tested in isolation (split maths lives in
// payments.test.ts).
vi.mock("@/lib/payments", () => ({
  generatePaymentRequests: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { endGameAction } from "@/app/(app)/admin/actions";

// A booked game with two confirmed members (one without an email — they should
// be skipped, not crash the send).
function bookedGame(overrides = {}) {
  return {
    id: "g1",
    status: GameStatus.BOOKED,
    signups: [
      { status: SignupStatus.CONFIRMED, user: { email: "a@x.com", name: "Ann" } },
      { status: SignupStatus.CONFIRMED, user: { email: null, name: "No Email" } },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin1", isAdmin: true });
  sendEmail.mockResolvedValue(undefined);
  db.game.findUnique.mockResolvedValue(bookedGame());
  db.game.update.mockResolvedValue({});
});

describe("endGameAction — guards", () => {
  it("errors when the game doesn't exist", async () => {
    db.game.findUnique.mockResolvedValue(null);
    const r = await endGameAction("g1");
    expect(r).toEqual({ error: "Game not found" });
    expect(db.game.update).not.toHaveBeenCalled();
  });

  it("refuses to end a game that's still OPEN", async () => {
    db.game.findUnique.mockResolvedValue(
      bookedGame({ status: GameStatus.OPEN }),
    );
    const r = await endGameAction("g1");
    expect(r).toMatchObject({ error: expect.stringMatching(/locked or booked/i) });
    expect(db.game.update).not.toHaveBeenCalled();
  });

  it("refuses to re-end an already COMPLETED game (no duplicate emails)", async () => {
    db.game.findUnique.mockResolvedValue(
      bookedGame({ status: GameStatus.COMPLETED }),
    );
    const r = await endGameAction("g1");
    expect(r).toMatchObject({ error: expect.any(String) });
    expect(db.game.update).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("endGameAction — happy path", () => {
  it("completes a BOOKED game and emails members with an address", async () => {
    const r = await endGameAction("g1");
    expect(r).toEqual({ ok: true });
    expect(db.game.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { status: GameStatus.COMPLETED },
    });
    // Only the member with an email gets the rating link.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@x.com" }),
    );
  });

  it("also completes a LOCKED game (booker never entered the cost)", async () => {
    db.game.findUnique.mockResolvedValue(
      bookedGame({ status: GameStatus.LOCKED }),
    );
    const r = await endGameAction("g1");
    expect(r).toEqual({ ok: true });
    expect(db.game.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { status: GameStatus.COMPLETED },
    });
  });
});
