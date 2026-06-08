import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";

// Mock the layers the action + shared canceller depend on (auth, DB, email,
// push, cache revalidation).
const { db, requireAdmin, sendEmail, sendPushToUsers } = vi.hoisted(() => ({
  db: { game: { findUnique: vi.fn(), update: vi.fn() } },
  requireAdmin: vi.fn(),
  sendEmail: vi.fn(),
  sendPushToUsers: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({ requireGameAdmin: requireAdmin }));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/push", () => ({ sendPushToUsers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cancelGameAction } from "@/app/(app)/admin/actions";

// An open game with two confirmed members (one without an email — they still
// get a push, just not an email).
function openGame(overrides = {}) {
  return {
    id: "g1",
    status: GameStatus.OPEN,
    signups: [
      {
        status: SignupStatus.CONFIRMED,
        user: { id: "u1", email: "a@x.com" },
      },
      {
        status: SignupStatus.CONFIRMED,
        user: { id: "u2", email: null },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin1", isAdmin: true });
  sendEmail.mockResolvedValue(undefined);
  sendPushToUsers.mockResolvedValue(undefined);
  db.game.findUnique.mockResolvedValue(openGame());
  db.game.update.mockResolvedValue({});
});

describe("cancelGameAction — guards", () => {
  it("errors when the game doesn't exist", async () => {
    db.game.findUnique.mockResolvedValue(null);
    const r = await cancelGameAction("g1");
    expect(r).toEqual({ error: "Game not found" });
    expect(db.game.update).not.toHaveBeenCalled();
  });

  it("refuses to cancel an already COMPLETED game", async () => {
    db.game.findUnique.mockResolvedValue(
      openGame({ status: GameStatus.COMPLETED }),
    );
    const r = await cancelGameAction("g1");
    expect(r).toMatchObject({ error: expect.any(String) });
    expect(db.game.update).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses to re-cancel an already CANCELLED game (no duplicate notices)", async () => {
    db.game.findUnique.mockResolvedValue(
      openGame({ status: GameStatus.CANCELLED }),
    );
    const r = await cancelGameAction("g1");
    expect(r).toMatchObject({ error: expect.any(String) });
    expect(db.game.update).not.toHaveBeenCalled();
  });
});

describe("cancelGameAction — happy path", () => {
  it("cancels an OPEN game, emails members with an address, pushes everyone", async () => {
    const r = await cancelGameAction("g1");
    expect(r).toEqual({ ok: true });
    expect(db.game.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { status: GameStatus.CANCELLED },
    });
    // Only the member with an email gets the email...
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@x.com" }),
    );
    // ...but both get the push.
    expect(sendPushToUsers).toHaveBeenCalledWith(
      ["u1", "u2"],
      expect.objectContaining({ url: "/home" }),
    );
  });

  it("also cancels a LOCKED game (people dropped out after lock)", async () => {
    db.game.findUnique.mockResolvedValue(
      openGame({ status: GameStatus.LOCKED }),
    );
    const r = await cancelGameAction("g1");
    expect(r).toEqual({ ok: true });
    expect(db.game.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { status: GameStatus.CANCELLED },
    });
  });
});
