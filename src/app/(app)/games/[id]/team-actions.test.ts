import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the layers the action depends on (auth, DB, cache revalidation).
const { db, authorizeAdmin } = vi.hoisted(() => ({
  db: {
    team: { findFirst: vi.fn() },
    teamPlayer: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async () => undefined),
  },
  authorizeAdmin: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/booking-access", () => ({ authorizeAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { moveTeamPlayerAction } from "@/app/(app)/games/[id]/team-actions";

const valid = { gameId: "g1", userId: "u1", toTeamId: "teamB" };

beforeEach(() => {
  vi.clearAllMocks();
  authorizeAdmin.mockResolvedValue({ userId: "admin1" });
  db.team.findFirst.mockResolvedValue({ id: "teamB" });
  db.teamPlayer.findFirst.mockResolvedValue({ teamId: "teamA" });
});

describe("moveTeamPlayerAction — admin gate", () => {
  it("refuses a non-admin and writes nothing", async () => {
    authorizeAdmin.mockResolvedValue({ error: "Only an admin can do this" });
    const r = await moveTeamPlayerAction(valid);
    expect(r).toEqual({ error: "Only an admin can do this" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed input before touching auth or the DB", async () => {
    // Empty strings fail the zod .min(1) guard at runtime.
    const r = await moveTeamPlayerAction({ gameId: "", userId: "", toTeamId: "" });
    expect(r).toEqual({ error: "Invalid input" });
    expect(authorizeAdmin).not.toHaveBeenCalled();
  });
});

describe("moveTeamPlayerAction — move semantics (as admin)", () => {
  it("errors when the target team isn't part of this game", async () => {
    db.team.findFirst.mockResolvedValue(null);
    const r = await moveTeamPlayerAction(valid);
    expect(r).toMatchObject({ error: expect.stringMatching(/isn't in this game/i) });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("errors when the player isn't in any of this game's teams", async () => {
    db.teamPlayer.findFirst.mockResolvedValue(null);
    const r = await moveTeamPlayerAction(valid);
    expect(r).toMatchObject({ error: expect.stringMatching(/isn't in this game/i) });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("no-ops (no write) when the player is already in the target team", async () => {
    db.teamPlayer.findFirst.mockResolvedValue({ teamId: "teamB" });
    const r = await moveTeamPlayerAction(valid);
    expect(r).toEqual({ ok: true });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("moves the player in a single transaction on the happy path", async () => {
    const r = await moveTeamPlayerAction(valid);
    expect(r).toEqual({ ok: true });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
