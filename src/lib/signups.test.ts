import { describe, it, expect, vi, beforeEach } from "vitest";

// A single shared mock transaction client, driven through prisma.$transaction
// (serializableTx just forwards to it). Each test wires up the reads it needs.
const { tx, prisma } = vi.hoisted(() => {
  const tx = {
    game: { findUnique: vi.fn(), update: vi.fn() },
    signup: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    guest: { deleteMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    groupMember: { findMany: vi.fn() },
    teamPlayer: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    team: { deleteMany: vi.fn(), create: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock("@/lib/db", () => ({ prisma }));

import { leaveGame } from "@/lib/signups";

const TEN_OTHERS = [
  "u-booker",
  "u-bibs",
  "u-foot",
  "u-wait",
  "u5",
  "u6",
  "u7",
  "u8",
  "u9",
  "u10",
].map((userId) => ({ userId }));

beforeEach(() => {
  vi.clearAllMocks();
  tx.game.findUnique.mockResolvedValue({
    id: "g1",
    status: "LOCKED",
    groupId: "grp1",
    bookerId: "u-booker",
    bibsUserId: "u-bibs",
    footballUserId: "u-foot",
    kickoffAt: new Date("2026-06-14T11:00:00Z"),
  });
  tx.signup.findUnique.mockResolvedValue({
    id: "s-drop",
    userId: "u-drop",
    status: "CONFIRMED",
  });
  tx.guest.deleteMany.mockResolvedValue({ count: 0 });
  tx.guest.count.mockResolvedValue(0);
  tx.groupMember.findMany.mockResolvedValue([]); // nobody exempt
  tx.signup.update.mockResolvedValue({});
  tx.game.update.mockResolvedValue({});
  tx.teamPlayer.update.mockResolvedValue({});
  tx.teamPlayer.delete.mockResolvedValue({});
});

describe("leaveGame — locked game, waitlister available", () => {
  beforeEach(() => {
    // One waitlister waiting to come in.
    tx.signup.findFirst.mockResolvedValue({ id: "sw1", userId: "u-wait" });
    tx.signup.findMany
      .mockResolvedValueOnce([]) // remaining waitlist (none left after promotion)
      .mockResolvedValueOnce(TEN_OTHERS); // confirmed squad, still 10
    // The dropped player's existing team slot.
    tx.teamPlayer.findFirst.mockResolvedValue({
      id: "tp-drop",
      team: { label: "A" },
    });
  });

  it("slots the promoted player into the dropped player's exact team", async () => {
    const out = await leaveGame("g1", "u-drop");

    expect(out.promotedUserId).toBe("u-wait");
    expect(out.promotedTeamLabel).toBe("A");
    // Targeted swap, not a full rebuild.
    expect(tx.teamPlayer.update).toHaveBeenCalledWith({
      where: { id: "tp-drop" },
      data: { userId: "u-wait" },
    });
    expect(out.teamsRegenerated).toBe(false);
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
    expect(tx.team.create).not.toHaveBeenCalled();
  });
});

describe("leaveGame — booked game, waitlister available", () => {
  beforeEach(() => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "BOOKED",
      groupId: "grp1",
      bookerId: "u-booker",
      bibsUserId: "u-bibs",
      footballUserId: "u-foot",
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
    });
    // One waitlister waiting to come in.
    tx.signup.findFirst.mockResolvedValue({ id: "sw1", userId: "u-wait" });
    tx.signup.findMany.mockResolvedValue([]); // remaining waitlist (none left)
    // The dropped player's existing team slot.
    tx.teamPlayer.findFirst.mockResolvedValue({
      id: "tp-drop",
      team: { label: "B" },
    });
  });

  it("slots the promoted player into the dropped player's team without touching duties", async () => {
    const out = await leaveGame("g1", "u-drop");

    expect(out.promotedUserId).toBe("u-wait");
    expect(out.promotedTeamLabel).toBe("B");
    // Targeted swap into the freed slot.
    expect(tx.teamPlayer.update).toHaveBeenCalledWith({
      where: { id: "tp-drop" },
      data: { userId: "u-wait" },
    });
    // The booking/duties are already settled — leave them alone.
    expect(out.newBookerId).toBeNull();
    expect(out.newBibsUserId).toBeNull();
    expect(out.newFootballUserId).toBeNull();
    expect(out.teamsRegenerated).toBe(false);
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
    expect(tx.team.create).not.toHaveBeenCalled();
    expect(out.status).toBe("BOOKED");
  });
});

describe("leaveGame — booked game, no waitlister", () => {
  beforeEach(() => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "BOOKED",
      groupId: "grp1",
      bookerId: "u-booker",
      bibsUserId: "u-bibs",
      footballUserId: "u-foot",
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
    });
    tx.signup.findFirst.mockResolvedValue(null); // nobody waiting
    tx.signup.findMany.mockResolvedValue([]); // remaining waitlist (none)
    // The dropped player's existing team slot.
    tx.teamPlayer.findFirst.mockResolvedValue({
      id: "tp-drop",
      team: { label: "B" },
    });
  });

  it("vacates the dropped player's team slot and leaves the rest alone", async () => {
    const out = await leaveGame("g1", "u-drop");

    expect(out.promotedUserId).toBeNull();
    // The dropped player is pulled out of their team, leaving the slot open.
    expect(tx.teamPlayer.delete).toHaveBeenCalledWith({
      where: { id: "tp-drop" },
    });
    expect(tx.teamPlayer.update).not.toHaveBeenCalled();
    // Booking/duties already settled — untouched, and no full rebuild.
    expect(out.newBookerId).toBeNull();
    expect(out.teamsRegenerated).toBe(false);
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
    expect(tx.team.create).not.toHaveBeenCalled();
    expect(out.status).toBe("BOOKED");
  });
});

describe("leaveGame — locked game falls below the minimum", () => {
  beforeEach(() => {
    tx.signup.findFirst.mockResolvedValue(null); // no waitlist
    tx.signup.findMany
      .mockResolvedValueOnce([]) // remaining waitlist
      .mockResolvedValueOnce(TEN_OTHERS.slice(0, 9)); // only 9 left
  });

  it("reopens the game and clears teams + duties", async () => {
    const out = await leaveGame("g1", "u-drop");

    expect(out.revertedToOpen).toBe(true);
    expect(out.status).toBe("OPEN");
    expect(tx.team.deleteMany).toHaveBeenCalledWith({ where: { gameId: "g1" } });
    expect(tx.game.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "OPEN",
          bookerId: null,
        }),
      }),
    );
  });
});
