import { describe, it, expect, vi, beforeEach } from "vitest";

// A single shared mock transaction client, driven through prisma.$transaction
// (serializableTx just forwards to it). Each test wires up the reads it needs.
const { tx, prisma } = vi.hoisted(() => {
  const tx = {
    game: { findUnique: vi.fn(), update: vi.fn() },
    signup: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    guest: {
      deleteMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    groupMember: { findMany: vi.fn() },
    teamPlayer: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    team: { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock("@/lib/db", () => ({ prisma }));

import { addGuest, joinGame, leaveGame, removeGuest } from "@/lib/signups";

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

/** A full team's worth of occupied slots, for the booked-game team-sheet reads. */
const FIVE_SLOTS = Array.from({ length: 5 }, (_, i) => ({ id: `tp${i}` }));

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

// Eleven confirmed signups with a skill score — enough for regenerateTeams to
// rebuild the sides (it needs at least MIN_PLAYERS).
const ELEVEN_CONFIRMED = Array.from({ length: 11 }, (_, i) => ({
  userId: `u${i}`,
  position: "MID",
  user: { id: `u${i}`, skillScore: 3 },
}));

describe("joinGame — locked game with a freed spot", () => {
  beforeEach(() => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "LOCKED",
      groupId: "grp1",
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
      group: { lockOffsetHours: 42 },
    });
    tx.signup.findUnique.mockResolvedValue(null); // brand-new signup
    tx.signup.count.mockResolvedValue(10); // 10 confirmed, below MAX (15)
    tx.guest.count.mockResolvedValue(0);
    tx.signup.create.mockResolvedValue({});
    // regenerateTeams reads the (now 11-strong) confirmed squad + guests.
    tx.signup.findMany.mockResolvedValue(ELEVEN_CONFIRMED);
    tx.guest.findMany.mockResolvedValue([]);
  });

  it("confirms the late joiner and rebuilds the teams", async () => {
    const r = await joinGame("g1", "u-new", "MID");

    expect(r).toEqual({ kind: "CONFIRMED" });
    expect(tx.signup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CONFIRMED" }),
      }),
    );
    // Teams are wiped + regenerated so the new player is slotted in.
    expect(tx.team.deleteMany).toHaveBeenCalledWith({ where: { gameId: "g1" } });
    expect(tx.team.create).toHaveBeenCalled();
  });
});

describe("joinGame — locked game that's already full", () => {
  beforeEach(() => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "LOCKED",
      groupId: "grp1",
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
      group: { lockOffsetHours: 42 },
    });
    tx.signup.findUnique.mockResolvedValue(null);
    // First count = CONFIRMED (15, full); second = WAITLIST (none yet).
    tx.signup.count.mockResolvedValueOnce(15).mockResolvedValueOnce(0);
    tx.guest.count.mockResolvedValue(0);
    tx.signup.create.mockResolvedValue({});
  });

  it("puts the joiner on the waitlist and leaves the teams alone", async () => {
    const r = await joinGame("g1", "u-new", "MID");

    expect(r).toEqual({ kind: "WAITLIST", position: 1 });
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
    expect(tx.team.create).not.toHaveBeenCalled();
  });
});

describe("joinGame — booked game stays closed to self-signup", () => {
  beforeEach(() => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "BOOKED",
      groupId: "grp1",
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
      group: { lockOffsetHours: 42 },
    });
  });

  it("rejects the signup once the game is booked", async () => {
    const r = await joinGame("g1", "u-new", "MID");

    expect(r).toEqual({ kind: "GAME_LOCKED" });
    expect(tx.signup.create).not.toHaveBeenCalled();
  });
});

describe("joinGame — admin override on a booked game", () => {
  beforeEach(() => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "BOOKED",
      groupId: "grp1",
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
      group: { lockOffsetHours: 42 },
    });
    tx.signup.findUnique.mockResolvedValue(null); // brand-new signup
    tx.signup.count.mockResolvedValue(11); // below MAX (15)
    tx.guest.count.mockResolvedValue(0);
    tx.signup.create.mockResolvedValue({});
    // A + B full, C holding one overflow player — room in C.
    tx.team.findMany.mockResolvedValue([
      { id: "t-a", label: "A", players: FIVE_SLOTS },
      { id: "t-b", label: "B", players: FIVE_SLOTS },
      { id: "t-c", label: "C", players: [{ id: "tp-11" }] },
    ]);
  });

  it("confirms the player and appends them without reshuffling the sheet", async () => {
    const r = await joinGame("g1", "u-new", "MID", { adminOverride: true });

    expect(r).toEqual({ kind: "CONFIRMED" });
    // The squad has already seen the team sheet — nothing is wiped or rebuilt.
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
    expect(tx.team.create).not.toHaveBeenCalled();
    // They join the smallest team (C).
    expect(tx.teamPlayer.create).toHaveBeenCalledWith({
      data: { teamId: "t-c", userId: "u-new" },
    });
  });

  it("opens team C when A and B are both full and there's no C yet", async () => {
    tx.team.findMany.mockResolvedValue([
      { id: "t-a", label: "A", players: FIVE_SLOTS },
      { id: "t-b", label: "B", players: FIVE_SLOTS },
    ]);
    tx.team.create.mockResolvedValue({ id: "t-c-new", label: "C" });

    const r = await joinGame("g1", "u-new", "MID", { adminOverride: true });

    expect(r).toEqual({ kind: "CONFIRMED" });
    expect(tx.team.create).toHaveBeenCalledWith({
      data: { gameId: "g1", label: "C" },
    });
    expect(tx.teamPlayer.create).toHaveBeenCalledWith({
      data: { teamId: "t-c-new", userId: "u-new" },
    });
  });

  it("waitlists instead of slotting in when the squad is full", async () => {
    // First count = CONFIRMED (15, full); second = WAITLIST (none yet).
    tx.signup.count.mockReset();
    tx.signup.count.mockResolvedValueOnce(15).mockResolvedValueOnce(0);

    const r = await joinGame("g1", "u-new", "MID", { adminOverride: true });

    expect(r).toEqual({ kind: "WAITLIST", position: 1 });
    expect(tx.teamPlayer.create).not.toHaveBeenCalled();
  });
});

describe("joinGame — finished games refuse even an admin override", () => {
  it.each(["COMPLETED", "CANCELLED"])("rejects a %s game", async (status) => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status,
      groupId: "grp1",
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
      group: { lockOffsetHours: 42 },
    });

    const r = await joinGame("g1", "u-new", "MID", { adminOverride: true });

    expect(r).toEqual({ kind: "GAME_LOCKED" });
    expect(tx.signup.create).not.toHaveBeenCalled();
  });
});

describe("addGuest — locked game with a freed spot", () => {
  beforeEach(() => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "LOCKED",
      groupId: "grp1",
      allowGuests: true,
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
      group: { lockOffsetHours: 42 },
    });
    tx.signup.findUnique.mockResolvedValue({ status: "CONFIRMED" }); // host
    tx.signup.count.mockResolvedValue(10);
    tx.guest.count.mockResolvedValue(0);
    tx.guest.create.mockResolvedValue({});
    tx.signup.findMany.mockResolvedValue(ELEVEN_CONFIRMED);
    tx.guest.findMany.mockResolvedValue([]);
  });

  it("adds the +1 and rebuilds the teams", async () => {
    const r = await addGuest("g1", "host1");

    expect(r).toEqual({ kind: "ADDED" });
    expect(tx.guest.create).toHaveBeenCalledWith({
      data: { gameId: "g1", hostUserId: "host1" },
    });
    expect(tx.team.deleteMany).toHaveBeenCalledWith({ where: { gameId: "g1" } });
    expect(tx.team.create).toHaveBeenCalled();
  });

  it("refuses once the squad is full", async () => {
    tx.guest.count.mockResolvedValue(5); // 10 + 5 = 15 = MAX
    const r = await addGuest("g1", "host1");
    expect(r).toEqual({ kind: "FULL" });
    expect(tx.guest.create).not.toHaveBeenCalled();
  });

  it("refuses a host who isn't a confirmed player", async () => {
    tx.signup.findUnique.mockResolvedValue({ status: "WAITLIST" });
    const r = await addGuest("g1", "host1");
    expect(r).toEqual({ kind: "NOT_CONFIRMED" });
    expect(tx.guest.create).not.toHaveBeenCalled();
  });

  it("refuses when guests aren't enabled", async () => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "LOCKED",
      groupId: "grp1",
      allowGuests: false,
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
      group: { lockOffsetHours: 42 },
    });
    const r = await addGuest("g1", "host1");
    expect(r).toEqual({ kind: "GUESTS_DISABLED" });
    expect(tx.guest.create).not.toHaveBeenCalled();
  });
});

describe("addGuest — booked game stays closed", () => {
  beforeEach(() => {
    tx.game.findUnique.mockResolvedValue({
      id: "g1",
      status: "BOOKED",
      groupId: "grp1",
      allowGuests: true,
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
      group: { lockOffsetHours: 42 },
    });
  });

  it("rejects the +1 once the game is booked", async () => {
    const r = await addGuest("g1", "host1");
    expect(r).toEqual({ kind: "GAME_LOCKED" });
    expect(tx.guest.create).not.toHaveBeenCalled();
  });
});

// A guest on a game in the given status, as returned by tx.guest.findUnique.
function guestOn(status: string) {
  return {
    id: "guest1",
    gameId: "g1",
    hostUserId: "host1",
    game: {
      id: "g1",
      status,
      groupId: "grp1",
      bookerId: "u-booker",
      bibsUserId: "u-bibs",
      footballUserId: "u-foot",
      kickoffAt: new Date("2026-06-14T11:00:00Z"),
    },
  };
}

describe("removeGuest — locked game, waitlister available", () => {
  beforeEach(() => {
    tx.guest.findUnique.mockResolvedValue(guestOn("LOCKED"));
    tx.guest.delete.mockResolvedValue({});
    // The guest's team slot (vacated by cascade when the guest is deleted).
    tx.teamPlayer.findFirst.mockResolvedValue({
      id: "tp-guest",
      team: { id: "team-a", label: "A" },
    });
    tx.signup.findFirst.mockResolvedValue({ id: "sw1", userId: "u-wait" });
    tx.signup.findMany.mockResolvedValueOnce([]); // remaining waitlist
    tx.signup.count.mockResolvedValue(10); // confirmed members
    tx.guest.count.mockResolvedValue(0); // no guests left after the delete
  });

  it("deletes the guest and slots the promoted waitlister into their exact team", async () => {
    const r = await removeGuest("guest1");

    expect(r).toMatchObject({
      kind: "REMOVED",
      gameId: "g1",
      outcome: {
        promotedUserId: "u-wait",
        promotedTeamLabel: "A",
        teamsRegenerated: false,
        revertedToOpen: false,
        status: "LOCKED",
      },
    });
    expect(tx.guest.delete).toHaveBeenCalledWith({ where: { id: "guest1" } });
    // The promoted player takes the exact slot the guest held.
    expect(tx.teamPlayer.create).toHaveBeenCalledWith({
      data: { teamId: "team-a", userId: "u-wait" },
    });
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
    expect(tx.team.create).not.toHaveBeenCalled();
  });
});

describe("removeGuest — locked game, no waitlister", () => {
  beforeEach(() => {
    tx.guest.findUnique.mockResolvedValue(guestOn("LOCKED"));
    tx.guest.delete.mockResolvedValue({});
    tx.teamPlayer.findFirst.mockResolvedValue({
      id: "tp-guest",
      team: { id: "team-a", label: "A" },
    });
    tx.signup.findFirst.mockResolvedValue(null); // nobody waiting
    tx.signup.findMany
      .mockResolvedValueOnce([]) // remaining waitlist
      .mockResolvedValueOnce(ELEVEN_CONFIRMED); // regenerateTeams reads confirmed
    tx.signup.count.mockResolvedValue(11);
    tx.guest.count.mockResolvedValue(0);
    tx.guest.findMany.mockResolvedValue([]); // regenerateTeams reads guests
  });

  it("rebalances the remaining squad into fresh teams", async () => {
    const r = await removeGuest("guest1");

    expect(r).toMatchObject({
      kind: "REMOVED",
      outcome: { promotedUserId: null, teamsRegenerated: true },
    });
    expect(tx.team.deleteMany).toHaveBeenCalledWith({ where: { gameId: "g1" } });
    expect(tx.team.create).toHaveBeenCalled();
  });
});

describe("removeGuest — locked game falls below the minimum", () => {
  beforeEach(() => {
    tx.guest.findUnique.mockResolvedValue(guestOn("LOCKED"));
    tx.guest.delete.mockResolvedValue({});
    tx.teamPlayer.findFirst.mockResolvedValue(null);
    tx.signup.findFirst.mockResolvedValue(null);
    tx.signup.findMany.mockResolvedValueOnce([]); // remaining waitlist
    tx.signup.count.mockResolvedValue(9); // only 9 members + no guests left
    tx.guest.count.mockResolvedValue(0);
  });

  it("reopens the game and clears teams + duties", async () => {
    const r = await removeGuest("guest1");

    expect(r).toMatchObject({
      kind: "REMOVED",
      outcome: { revertedToOpen: true, status: "OPEN" },
    });
    expect(tx.team.deleteMany).toHaveBeenCalledWith({ where: { gameId: "g1" } });
    expect(tx.game.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "OPEN", bookerId: null }),
      }),
    );
  });
});

describe("removeGuest — booked game", () => {
  beforeEach(() => {
    tx.guest.findUnique.mockResolvedValue(guestOn("BOOKED"));
    tx.guest.delete.mockResolvedValue({});
    tx.teamPlayer.findFirst.mockResolvedValue({
      id: "tp-guest",
      team: { id: "team-b", label: "B" },
    });
    tx.signup.findFirst.mockResolvedValue({ id: "sw1", userId: "u-wait" });
    tx.signup.findMany.mockResolvedValueOnce([]); // remaining waitlist
  });

  it("hands the guest's slot to the promoted waitlister without touching duties or money", async () => {
    const r = await removeGuest("guest1");

    expect(r).toMatchObject({
      kind: "REMOVED",
      outcome: {
        promotedUserId: "u-wait",
        promotedTeamLabel: "B",
        newBookerId: null,
        teamsRegenerated: false,
        status: "BOOKED",
      },
    });
    expect(tx.teamPlayer.create).toHaveBeenCalledWith({
      data: { teamId: "team-b", userId: "u-wait" },
    });
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
    expect(tx.game.update).not.toHaveBeenCalled();
  });

  it("leaves the slot vacated when nobody is waiting", async () => {
    tx.signup.findFirst.mockResolvedValue(null);
    const r = await removeGuest("guest1");

    expect(r).toMatchObject({
      kind: "REMOVED",
      outcome: { promotedUserId: null, teamsRegenerated: false },
    });
    // The cascade already removed the guest's TeamPlayer row — nothing to do.
    expect(tx.teamPlayer.create).not.toHaveBeenCalled();
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
  });
});

describe("removeGuest — open game", () => {
  beforeEach(() => {
    tx.guest.findUnique.mockResolvedValue(guestOn("OPEN"));
    tx.guest.delete.mockResolvedValue({});
    tx.teamPlayer.findFirst.mockResolvedValue(null); // no teams before lock
    tx.signup.findFirst.mockResolvedValue({ id: "sw1", userId: "u-wait" });
    tx.signup.findMany.mockResolvedValueOnce([]); // remaining waitlist
  });

  it("deletes the guest and promotes the first waitlister into the freed spot", async () => {
    const r = await removeGuest("guest1");

    expect(r).toMatchObject({
      kind: "REMOVED",
      outcome: { promotedUserId: "u-wait", status: "OPEN" },
    });
    expect(tx.guest.delete).toHaveBeenCalledWith({ where: { id: "guest1" } });
    expect(tx.signup.update).toHaveBeenCalledWith({
      where: { id: "sw1" },
      data: { status: "CONFIRMED", waitlistPosition: null },
    });
    expect(tx.team.deleteMany).not.toHaveBeenCalled();
  });
});

describe("removeGuest — finished games are refused", () => {
  it.each(["COMPLETED", "CANCELLED"])("refuses on a %s game", async (status) => {
    tx.guest.findUnique.mockResolvedValue(guestOn(status));
    const r = await removeGuest("guest1");
    expect(r).toEqual({ kind: "GAME_FINISHED" });
    expect(tx.guest.delete).not.toHaveBeenCalled();
  });

  it("reports a guest that doesn't exist", async () => {
    tx.guest.findUnique.mockResolvedValue(null);
    const r = await removeGuest("nope");
    expect(r).toEqual({ kind: "NOT_FOUND" });
    expect(tx.guest.delete).not.toHaveBeenCalled();
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
