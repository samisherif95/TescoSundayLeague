import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";

// Mock the layers the action depends on (auth, DB, push, cache revalidation).
const { db, requireAdmin, sendPushToUsers } = vi.hoisted(() => ({
  db: { game: { findUnique: vi.fn(), update: vi.fn() } },
  requireAdmin: vi.fn(),
  sendPushToUsers: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({ requireAdmin }));
vi.mock("@/lib/push", () => ({ sendPushToUsers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { reassignDutyAction } from "@/app/(app)/admin/actions";

// A locked game: booker/bibs/football already held by three different people,
// plus a spare confirmed member ("u-new") an admin can promote.
function lockedGame(overrides = {}) {
  return {
    status: GameStatus.LOCKED,
    bookerId: "u-booker",
    bibsUserId: "u-bibs",
    footballUserId: "u-foot",
    signups: [
      { userId: "u-booker" },
      { userId: "u-bibs" },
      { userId: "u-foot" },
      { userId: "u-new" },
    ].map((s) => ({ ...s, status: SignupStatus.CONFIRMED })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin1", isAdmin: true });
  sendPushToUsers.mockResolvedValue(undefined);
  db.game.findUnique.mockResolvedValue(lockedGame());
});

describe("reassignDutyAction — guards", () => {
  it("rejects an unknown duty before touching the DB", async () => {
    const r = await reassignDutyAction("g1", "captain" as never, "u-new");
    expect(r).toMatchObject({ error: expect.any(String) });
    expect(db.game.findUnique).not.toHaveBeenCalled();
  });

  it("errors when the game doesn't exist", async () => {
    db.game.findUnique.mockResolvedValue(null);
    const r = await reassignDutyAction("g1", "booker", "u-new");
    expect(r).toEqual({ error: "Game not found" });
    expect(db.game.update).not.toHaveBeenCalled();
  });

  it("refuses to change duties on a game that isn't locked yet", async () => {
    db.game.findUnique.mockResolvedValue(lockedGame({ status: GameStatus.OPEN }));
    const r = await reassignDutyAction("g1", "booker", "u-new");
    expect(r).toMatchObject({ error: expect.stringMatching(/locked/i) });
    expect(db.game.update).not.toHaveBeenCalled();
  });

  it("refuses a player who isn't a confirmed member this week", async () => {
    const r = await reassignDutyAction("g1", "booker", "u-stranger");
    expect(r).toMatchObject({ error: expect.stringMatching(/confirmed member/i) });
    expect(db.game.update).not.toHaveBeenCalled();
  });

  it("keeps the three duties distinct — refuses someone already on another duty", async () => {
    // u-bibs already holds bibs, so they can't also be booker.
    const r = await reassignDutyAction("g1", "booker", "u-bibs");
    expect(r).toMatchObject({ error: expect.stringMatching(/another duty/i) });
    expect(db.game.update).not.toHaveBeenCalled();
  });
});

describe("reassignDutyAction — happy path", () => {
  it("reassigns the booker and notifies the new holder", async () => {
    const r = await reassignDutyAction("g1", "booker", "u-new");
    expect(r).toEqual({ ok: true });
    expect(db.game.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { bookerId: "u-new" },
    });
    expect(sendPushToUsers).toHaveBeenCalledTimes(1);
    expect(sendPushToUsers).toHaveBeenCalledWith(
      ["u-new"],
      expect.objectContaining({ url: "/games/g1/book" }),
    );
  });

  it("maps bibs to its own column and a game-page nudge", async () => {
    const r = await reassignDutyAction("g1", "bibs", "u-new");
    expect(r).toEqual({ ok: true });
    expect(db.game.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { bibsUserId: "u-new" },
    });
    expect(sendPushToUsers).toHaveBeenCalledWith(
      ["u-new"],
      expect.objectContaining({ url: "/games/g1" }),
    );
  });

  it("allows re-confirming the current holder (no other-duty clash)", async () => {
    const r = await reassignDutyAction("g1", "booker", "u-booker");
    expect(r).toEqual({ ok: true });
    expect(db.game.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { bookerId: "u-booker" },
    });
  });
});
