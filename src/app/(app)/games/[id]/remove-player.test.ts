import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the layers the action leans on: auth, DB, the drop-out engine, the
// shared notifier, and the direct email/push to the removed player.
const {
  db,
  requireGameAdmin,
  leaveGame,
  notifyLeaveOutcome,
  sendEmail,
  sendPushToUsers,
} = vi.hoisted(() => ({
  db: {
    signup: { findUnique: vi.fn() },
    game: { findUnique: vi.fn() },
  },
  requireGameAdmin: vi.fn(),
  leaveGame: vi.fn(),
  notifyLeaveOutcome: vi.fn(),
  sendEmail: vi.fn(),
  sendPushToUsers: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({
  requireGameAdmin,
  requireOnboardedUser: vi.fn(),
  requireGameMember: vi.fn(),
}));
vi.mock("@/lib/signups", () => ({ leaveGame, joinGame: vi.fn() }));
vi.mock("@/lib/leave-notify", () => ({ notifyLeaveOutcome }));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/push", () => ({ sendPushToUsers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { removePlayerAction } from "@/app/(app)/games/[id]/actions";

function outcome(overrides = {}) {
  return {
    promotedUserId: null,
    promotedTeamLabel: null,
    teamsRegenerated: false,
    newBookerId: null,
    newBibsUserId: null,
    newFootballUserId: null,
    revertedToOpen: false,
    status: "LOCKED",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireGameAdmin.mockResolvedValue({ user: { id: "admin1" } });
  db.signup.findUnique.mockResolvedValue({
    status: "CONFIRMED",
    user: { name: "Sam", email: "sam@example.com" },
  });
  db.game.findUnique.mockResolvedValue({ kickoffAt: new Date("2026-06-14T11:00:00Z") });
  leaveGame.mockResolvedValue(outcome());
  notifyLeaveOutcome.mockResolvedValue(undefined);
  sendEmail.mockResolvedValue(undefined);
  sendPushToUsers.mockResolvedValue(undefined);
});

describe("removePlayerAction", () => {
  it("rejects a missing player id before doing any work", async () => {
    const r = await removePlayerAction("g1", "");
    expect(r).toEqual({ error: "Missing game or player id" });
    expect(leaveGame).not.toHaveBeenCalled();
  });

  it("errors when the target isn't in the game", async () => {
    db.signup.findUnique.mockResolvedValue(null);
    const r = await removePlayerAction("g1", "u1");
    expect(r).toMatchObject({ error: expect.stringMatching(/isn't in this game/i) });
    expect(leaveGame).not.toHaveBeenCalled();
  });

  it("errors when the target has already dropped out", async () => {
    db.signup.findUnique.mockResolvedValue({
      status: "DROPPED_OUT",
      user: { name: "Sam", email: "sam@example.com" },
    });
    const r = await removePlayerAction("g1", "u1");
    expect(r).toMatchObject({ error: expect.stringMatching(/isn't in this game/i) });
    expect(leaveGame).not.toHaveBeenCalled();
  });

  it("removes the player, runs the shared notifier, and tells the removed player", async () => {
    const r = await removePlayerAction("g1", "u1");
    expect(r).toEqual({ ok: true });
    expect(leaveGame).toHaveBeenCalledWith("g1", "u1");
    expect(notifyLeaveOutcome).toHaveBeenCalledWith("g1", expect.objectContaining({ status: "LOCKED" }));
    // The removed player is emailed + pushed.
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "sam@example.com" }),
    );
    expect(sendPushToUsers).toHaveBeenCalledWith(["u1"], expect.any(Object));
  });

  it("skips the email when the removed player has no address", async () => {
    db.signup.findUnique.mockResolvedValue({
      status: "WAITLIST",
      user: { name: "Sam", email: null },
    });
    const r = await removePlayerAction("g1", "u1");
    expect(r).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendPushToUsers).toHaveBeenCalledWith(["u1"], expect.any(Object));
  });
});
