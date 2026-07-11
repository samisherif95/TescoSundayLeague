import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the layers the action leans on: auth, DB, the guest-removal engine and
// the shared drop-out notifier.
const { db, requireGameMember, removeGuest, notifyLeaveOutcome } = vi.hoisted(
  () => ({
    db: {
      guest: { findUnique: vi.fn() },
    },
    requireGameMember: vi.fn(),
    removeGuest: vi.fn(),
    notifyLeaveOutcome: vi.fn(),
  }),
);
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({
  requireGameMember,
  requireGameAdmin: vi.fn(),
  requireOnboardedUser: vi.fn(),
}));
vi.mock("@/lib/signups", () => ({ removeGuest, addGuest: vi.fn() }));
vi.mock("@/lib/leave-notify", () => ({ notifyLeaveOutcome }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { removeGuestAction } from "@/app/(app)/games/[id]/guest-actions";

function guest(status: string) {
  return {
    id: "guest1",
    hostUserId: "host1",
    game: { id: "g1", status },
  };
}

function removed(overrides = {}) {
  return {
    kind: "REMOVED",
    gameId: "g1",
    outcome: {
      promotedUserId: null,
      promotedTeamLabel: null,
      teamsRegenerated: false,
      newBookerId: null,
      newBibsUserId: null,
      newFootballUserId: null,
      revertedToOpen: false,
      status: "LOCKED",
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.guest.findUnique.mockResolvedValue(guest("OPEN"));
  requireGameMember.mockResolvedValue({
    user: { id: "host1" },
    membership: { role: "MEMBER" },
  });
  removeGuest.mockResolvedValue(removed({ status: "OPEN" }));
  notifyLeaveOutcome.mockResolvedValue(undefined);
});

describe("removeGuestAction", () => {
  it("lets the host remove their own +1 while the game is open", async () => {
    const r = await removeGuestAction("guest1");
    expect(r).toEqual({ ok: true });
    expect(removeGuest).toHaveBeenCalledWith("guest1");
    expect(notifyLeaveOutcome).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ status: "OPEN" }),
    );
  });

  it("blocks a non-host member", async () => {
    requireGameMember.mockResolvedValue({
      user: { id: "someone-else" },
      membership: { role: "MEMBER" },
    });
    const r = await removeGuestAction("guest1");
    expect(r).toMatchObject({
      error: expect.stringMatching(/a \+1 you added/i),
    });
    expect(removeGuest).not.toHaveBeenCalled();
  });

  it("blocks the host once the game is locked", async () => {
    db.guest.findUnique.mockResolvedValue(guest("LOCKED"));
    const r = await removeGuestAction("guest1");
    expect(r).toMatchObject({ error: expect.stringMatching(/too late/i) });
    expect(removeGuest).not.toHaveBeenCalled();
  });

  it.each(["LOCKED", "BOOKED"])(
    "lets an admin override and remove any +1 on a %s game",
    async (status) => {
      db.guest.findUnique.mockResolvedValue(guest(status));
      requireGameMember.mockResolvedValue({
        user: { id: "admin1" },
        membership: { role: "ADMIN" },
      });
      removeGuest.mockResolvedValue(removed({ status }));

      const r = await removeGuestAction("guest1");
      expect(r).toEqual({ ok: true });
      expect(removeGuest).toHaveBeenCalledWith("guest1");
      expect(notifyLeaveOutcome).toHaveBeenCalledWith("g1", expect.any(Object));
    },
  );

  it("surfaces the engine's refusal on a finished game", async () => {
    db.guest.findUnique.mockResolvedValue(guest("COMPLETED"));
    requireGameMember.mockResolvedValue({
      user: { id: "admin1" },
      membership: { role: "ADMIN" },
    });
    removeGuest.mockResolvedValue({ kind: "GAME_FINISHED" });

    const r = await removeGuestAction("guest1");
    expect(r).toMatchObject({ error: expect.stringMatching(/finished/i) });
    expect(notifyLeaveOutcome).not.toHaveBeenCalled();
  });

  it("errors on a guest that doesn't exist", async () => {
    db.guest.findUnique.mockResolvedValue(null);
    const r = await removeGuestAction("nope");
    expect(r).toEqual({ error: "Guest not found" });
    expect(removeGuest).not.toHaveBeenCalled();
  });
});
