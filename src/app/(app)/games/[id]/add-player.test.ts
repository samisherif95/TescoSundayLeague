import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the layers the action leans on: auth, DB, the signup engine, and the
// email/push sent to the added player.
const {
  db,
  requireGameAdmin,
  joinGame,
  sendEmail,
  sendPushToUsers,
} = vi.hoisted(() => ({
  db: {
    groupMember: { findUnique: vi.fn() },
    signup: { findUnique: vi.fn() },
    game: { findUnique: vi.fn() },
  },
  requireGameAdmin: vi.fn(),
  joinGame: vi.fn(),
  sendEmail: vi.fn(),
  sendPushToUsers: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({
  requireGameAdmin,
  requireOnboardedUser: vi.fn(),
  requireGameMember: vi.fn(),
}));
vi.mock("@/lib/signups", () => ({ joinGame, leaveGame: vi.fn() }));
vi.mock("@/lib/leave-notify", () => ({ notifyLeaveOutcome: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/push", () => ({ sendPushToUsers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addPlayerAction } from "@/app/(app)/games/[id]/actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireGameAdmin.mockResolvedValue({ groupId: "grp1" });
  db.groupMember.findUnique.mockResolvedValue({
    user: { name: "Sam", email: "sam@example.com" },
  });
  db.signup.findUnique.mockResolvedValue(null); // not in the game yet
  db.game.findUnique.mockResolvedValue({
    kickoffAt: new Date("2026-06-14T11:00:00Z"),
  });
  joinGame.mockResolvedValue({ kind: "CONFIRMED" });
  sendEmail.mockResolvedValue(undefined);
  sendPushToUsers.mockResolvedValue(undefined);
});

describe("addPlayerAction", () => {
  it("rejects a player who isn't a member of the group", async () => {
    db.groupMember.findUnique.mockResolvedValue(null);
    const r = await addPlayerAction("g1", "u1", "MID");
    expect(r).toMatchObject({
      error: expect.stringMatching(/isn't a member of this group/i),
    });
    expect(joinGame).not.toHaveBeenCalled();
  });

  it("rejects a player who's already in the game", async () => {
    db.signup.findUnique.mockResolvedValue({ status: "CONFIRMED" });
    const r = await addPlayerAction("g1", "u1", "MID");
    expect(r).toMatchObject({
      error: expect.stringMatching(/already in this game/i),
    });
    expect(joinGame).not.toHaveBeenCalled();
  });

  it("re-adds a previously dropped-out player", async () => {
    db.signup.findUnique.mockResolvedValue({ status: "DROPPED_OUT" });
    const r = await addPlayerAction("g1", "u1", "FWD");
    expect(r).toMatchObject({ ok: true });
    expect(joinGame).toHaveBeenCalledWith("g1", "u1", "FWD", {
      bypassDeadline: true,
    });
  });

  it("adds the player past the deadline and notifies them", async () => {
    const r = await addPlayerAction("g1", "u1", "DEF");
    expect(r).toMatchObject({ ok: true, result: { kind: "CONFIRMED" } });
    // Always bypasses the soft signup deadline (admin privilege).
    expect(joinGame).toHaveBeenCalledWith("g1", "u1", "DEF", {
      bypassDeadline: true,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "sam@example.com" }),
    );
    expect(sendPushToUsers).toHaveBeenCalledWith(["u1"], expect.any(Object));
  });

  it("reports a waitlist landing back to the admin", async () => {
    joinGame.mockResolvedValue({ kind: "WAITLIST", position: 3 });
    const r = await addPlayerAction("g1", "u1", "MID");
    expect(r).toMatchObject({ ok: true, result: { kind: "WAITLIST" } });
    expect(sendPushToUsers).toHaveBeenCalledWith(["u1"], expect.any(Object));
  });

  it("skips the email when the player has no address", async () => {
    db.groupMember.findUnique.mockResolvedValue({
      user: { name: "Sam", email: null },
    });
    const r = await addPlayerAction("g1", "u1", "MID");
    expect(r).toMatchObject({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendPushToUsers).toHaveBeenCalledWith(["u1"], expect.any(Object));
  });

  it("surfaces a locked game as an error", async () => {
    joinGame.mockResolvedValue({ kind: "GAME_LOCKED" });
    const r = await addPlayerAction("g1", "u1", "MID");
    expect(r).toMatchObject({
      error: expect.stringMatching(/no longer open/i),
    });
  });
});
