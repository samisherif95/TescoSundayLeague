import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignupStatus, Position } from "@/generated/prisma/enums";

// serializableTx just runs the callback against our mock tx, so joinGame's
// transactional body is exercised directly. promoteWaitlist takes a `tx`, so we
// pass the same mock in by hand.
const { tx, serializableTx } = vi.hoisted(() => {
  const tx = {
    game: { findUnique: vi.fn(), update: vi.fn() },
    signup: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    guest: { count: vi.fn(), deleteMany: vi.fn() },
    groupMember: { findMany: vi.fn() },
    team: { deleteMany: vi.fn(), create: vi.fn() },
    teamPlayer: { deleteMany: vi.fn() },
  };
  return {
    tx,
    serializableTx: vi.fn(
      async (fn: (t: typeof tx) => unknown) => fn(tx),
    ),
  };
});
vi.mock("@/lib/db", () => ({ serializableTx }));

import { promoteWaitlist, joinGame, leaveGame } from "@/lib/signups";

beforeEach(() => {
  vi.clearAllMocks();
});

// Distinguish the CONFIRMED vs WAITLIST signup.count calls by their filter.
function countBy(confirmed: number, waitlist: number) {
  tx.signup.count.mockImplementation(
    ({ where }: { where: { status: SignupStatus } }) =>
      where.status === SignupStatus.CONFIRMED
        ? Promise.resolve(confirmed)
        : Promise.resolve(waitlist),
  );
}

describe("promoteWaitlist", () => {
  it("promotes one waitlister into a single freed slot and renumbers the rest", async () => {
    // 14 confirmed + 0 guests = 1 free slot.
    tx.signup.count.mockResolvedValue(14);
    tx.guest.count.mockResolvedValue(0);
    tx.signup.findMany
      // waitlisters to promote (take: 1)
      .mockResolvedValueOnce([{ id: "w1", userId: "u1", waitlistPosition: 1 }])
      // remaining waitlist to renumber
      .mockResolvedValueOnce([{ id: "w2", userId: "u2", waitlistPosition: 2 }]);

    const promoted = await promoteWaitlist(tx as never, "g1");

    expect(promoted).toEqual(["u1"]);
    // w1 confirmed...
    expect(tx.signup.update).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { status: SignupStatus.CONFIRMED, waitlistPosition: null },
    });
    // ...and the trailing waitlister renumbered from #2 to #1 (no gap).
    expect(tx.signup.update).toHaveBeenCalledWith({
      where: { id: "w2" },
      data: { waitlistPosition: 1 },
    });
  });

  it("fills every slot a host freed by dropping with +1s (multi-promote)", async () => {
    // 12 confirmed + 0 guests = 3 free slots (a host with 2 +1s just left).
    tx.signup.count.mockResolvedValue(12);
    tx.guest.count.mockResolvedValue(0);
    tx.signup.findMany
      .mockResolvedValueOnce([
        { id: "w1", userId: "u1", waitlistPosition: 1 },
        { id: "w2", userId: "u2", waitlistPosition: 2 },
        { id: "w3", userId: "u3", waitlistPosition: 3 },
      ])
      .mockResolvedValueOnce([]); // nobody left waiting

    const promoted = await promoteWaitlist(tx as never, "g1");
    expect(promoted).toEqual(["u1", "u2", "u3"]);
    // findMany for promotion was asked for exactly the free-slot count.
    expect(tx.signup.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 3 }),
    );
  });

  it("promotes nobody when the roster is still full, but still renumbers", async () => {
    // 15 confirmed = 0 free slots.
    tx.signup.count.mockResolvedValue(15);
    tx.guest.count.mockResolvedValue(0);
    // Only the renumber findMany runs (no promotion findMany).
    tx.signup.findMany.mockResolvedValueOnce([
      { id: "w2", userId: "u2", waitlistPosition: 2 },
      { id: "w3", userId: "u3", waitlistPosition: 3 },
    ]);

    const promoted = await promoteWaitlist(tx as never, "g1");
    expect(promoted).toEqual([]);
    // #2 → #1 and #3 → #2 (the gap left by a departed #1 is closed).
    expect(tx.signup.update).toHaveBeenCalledWith({
      where: { id: "w2" },
      data: { waitlistPosition: 1 },
    });
    expect(tx.signup.update).toHaveBeenCalledWith({
      where: { id: "w3" },
      data: { waitlistPosition: 2 },
    });
  });
});

describe("joinGame — queue fairness", () => {
  const futureKickoff = new Date("2030-06-09T11:00:00Z");
  function openGame() {
    return {
      id: "g1",
      status: "OPEN",
      kickoffAt: futureKickoff,
      group: { lockOffsetHours: 48 },
    };
  }

  it("waitlists a newcomer when a waitlist already exists, even with a free slot", async () => {
    tx.game.findUnique.mockResolvedValue(openGame());
    tx.signup.findUnique.mockResolvedValue(null); // brand-new joiner
    tx.guest.count.mockResolvedValue(0);
    // Room on paper (10/15) BUT someone is already waiting — the newcomer must
    // queue behind them, not slip into the transient gap.
    countBy(10, 1);

    const r = await joinGame("g1", "newbie", Position.MID);
    expect(r).toEqual({ kind: "WAITLIST", position: 2 });
    expect(tx.signup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SignupStatus.WAITLIST,
          waitlistPosition: 2,
        }),
      }),
    );
  });

  it("confirms a newcomer when there's room and nobody waiting", async () => {
    tx.game.findUnique.mockResolvedValue(openGame());
    tx.signup.findUnique.mockResolvedValue(null);
    tx.guest.count.mockResolvedValue(0);
    countBy(9, 0);

    const r = await joinGame("g1", "newbie", Position.MID);
    expect(r).toEqual({ kind: "CONFIRMED" });
    expect(tx.signup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SignupStatus.CONFIRMED }),
      }),
    );
  });

  it("waitlists a newcomer when the roster is full", async () => {
    tx.game.findUnique.mockResolvedValue(openGame());
    tx.signup.findUnique.mockResolvedValue(null);
    tx.guest.count.mockResolvedValue(0);
    countBy(15, 0);

    const r = await joinGame("g1", "newbie", Position.MID);
    expect(r).toEqual({ kind: "WAITLIST", position: 1 });
  });

  it("is idempotent for an existing waitlister (updates position, stays waitlisted)", async () => {
    tx.game.findUnique.mockResolvedValue(openGame());
    tx.signup.findUnique.mockResolvedValue({
      id: "s1",
      status: SignupStatus.WAITLIST,
      waitlistPosition: 2,
    });

    const r = await joinGame("g1", "u1", Position.FWD);
    expect(r).toEqual({ kind: "WAITLIST", position: 2 });
    // Only the position is touched — no re-confirm, no new row.
    expect(tx.signup.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { position: Position.FWD },
    });
    expect(tx.signup.create).not.toHaveBeenCalled();
  });
});

describe("leaveGame — drop-out cleanup", () => {
  it("keeps the leaver's +1 but pulls them off their team (BOOKED game)", async () => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "BOOKED",
      groupId: "grp1",
      bookerId: "someone-else",
    });
    tx.signup.findUnique.mockResolvedValue({
      id: "s1",
      status: SignupStatus.CONFIRMED,
    });
    // promoteWaitlist internals: roster still full-ish, nobody waiting.
    tx.signup.count.mockResolvedValue(14);
    tx.guest.count.mockResolvedValue(1);
    tx.signup.findMany.mockResolvedValue([]); // no waitlist

    const outcome = await leaveGame("g1", "u1");

    // Marked dropped out...
    expect(tx.signup.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: SignupStatus.DROPPED_OUT, waitlistPosition: null },
    });
    // ...their team slot removed so their name comes off the lineup...
    expect(tx.teamPlayer.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", team: { gameId: "g1" } },
    });
    // ...but their +1 is NOT deleted — it stays and gets billed to them.
    expect(tx.guest.deleteMany).not.toHaveBeenCalled();
    // BOOKED game: teams aren't regenerated.
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
    expect(outcome.status).toBe("BOOKED");
  });
});
