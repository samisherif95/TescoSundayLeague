import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameStatus, SignupStatus, Position } from "@/generated/prisma/enums";

// --- Mock the data + side-effect layers lockGame depends on -----------------
// Defined via vi.hoisted so they exist before the (hoisted) vi.mock factories run.
const { db, sendEmail, sendPushToUsers } = vi.hoisted(() => {
  const db = {
    game: { findUnique: vi.fn(), groupBy: vi.fn(), update: vi.fn() },
    team: { deleteMany: vi.fn(), create: vi.fn() },
    // Run the transaction callback against the same mock (acts as `tx`).
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  return {
    db,
    sendEmail: vi.fn(async () => null),
    sendPushToUsers: vi.fn(async () => undefined),
  };
});
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/push", () => ({ sendPushToUsers }));

import { lockGame } from "@/lib/lock";

type SignupSeed = {
  id: string;
  name?: string | null;
  email?: string | null;
  skill?: number;
};

function gameWith(
  signups: SignupSeed[],
  status: GameStatus = GameStatus.OPEN,
  guestCount = 0,
) {
  return {
    id: "game1",
    status,
    signups: signups.map((s) => ({
      status: SignupStatus.CONFIRMED,
      position: Position.MID,
      user: {
        id: s.id,
        name: s.name ?? s.id,
        email: s.email ?? `${s.id}@example.com`,
        skillScore: s.skill ?? 3,
      },
    })),
    guests: Array.from({ length: guestCount }, (_, i) => ({ id: `guest${i}` })),
  };
}

function confirmed(n: number): SignupSeed[] {
  return Array.from({ length: n }, (_, i) => ({ id: `u${i}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.game.groupBy.mockResolvedValue([]); // no past bookings by default
  db.game.update.mockResolvedValue({});
  db.team.deleteMany.mockResolvedValue({});
  db.team.create.mockResolvedValue({});
});

describe("lockGame guards", () => {
  it("errors when the game is missing", async () => {
    db.game.findUnique.mockResolvedValue(null);
    expect(await lockGame("nope")).toEqual({
      ok: false,
      error: "Game not found",
    });
  });

  it("errors when the game is not OPEN", async () => {
    db.game.findUnique.mockResolvedValue(
      gameWith(confirmed(10), GameStatus.LOCKED),
    );
    const r = await lockGame("game1");
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ ok: false });
  });

  it("errors when there are fewer than 10 confirmed players", async () => {
    db.game.findUnique.mockResolvedValue(gameWith(confirmed(9)));
    const r = await lockGame("game1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least 10/i);
  });

  it("does not write or notify when a guard fails", async () => {
    db.game.findUnique.mockResolvedValue(gameWith(confirmed(9)));
    await lockGame("game1");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendPushToUsers).not.toHaveBeenCalled();
  });
});

describe("lockGame happy path", () => {
  it("locks the game, creates two teams, and notifies everyone", async () => {
    db.game.findUnique.mockResolvedValue(gameWith(confirmed(10)));
    const r = await lockGame("game1");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.teamCount).toBe(2);
    expect(confirmed(10).map((s) => s.id)).toContain(r.bookerId);

    // Status flipped to LOCKED with the booker recorded.
    expect(db.game.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "game1" },
        data: expect.objectContaining({
          status: GameStatus.LOCKED,
          bookerId: r.bookerId,
        }),
      }),
    );
    // Two teams (A, B) created for a 10-player squad.
    expect(db.team.create).toHaveBeenCalledTimes(2);
    // Everyone got notified (booker email + the rest), and pushes fired.
    expect(sendEmail).toHaveBeenCalled();
    expect(sendPushToUsers).toHaveBeenCalled();
  });

  it("counts +1 guests toward the minimum and slots them into teams", async () => {
    // 8 members + 2 guests = 10 bodies → locks into two teams.
    db.game.findUnique.mockResolvedValue(
      gameWith(confirmed(8), GameStatus.OPEN, 2),
    );
    const r = await lockGame("game1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.teamCount).toBe(2);
    // Both team-create calls together hold all 10 slots, including guest slots.
    const created = db.team.create.mock.calls.flatMap(
      (c) => c[0].data.players.create as Array<{ userId?: string; guestId?: string }>,
    );
    expect(created).toHaveLength(10);
    expect(created.filter((p) => p.guestId)).toHaveLength(2);
  });

  it("still refuses to lock when members + guests fall short", async () => {
    db.game.findUnique.mockResolvedValue(
      gameWith(confirmed(8), GameStatus.OPEN, 1),
    );
    const r = await lockGame("game1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least 10/i);
  });

  it("creates a third team C for 13 players", async () => {
    db.game.findUnique.mockResolvedValue(gameWith(confirmed(13)));
    const r = await lockGame("game1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.teamCount).toBe(3);
    expect(db.team.create).toHaveBeenCalledTimes(3);
  });

  it("picks the booker fairly — the player with the fewest past bookings", async () => {
    db.game.findUnique.mockResolvedValue(gameWith(confirmed(10)));
    // Everyone except u7 has booked 5 times; u7 is absent from the stats (0).
    db.game.groupBy.mockResolvedValue(
      confirmed(10)
        .filter((s) => s.id !== "u7")
        .map((s) => ({
          bookerId: s.id,
          _count: { _all: 5 },
          _max: { kickoffAt: new Date("2026-01-01") },
        })),
    );
    const r = await lockGame("game1");
    if (r.ok) expect(r.bookerId).toBe("u7");
  });

  it("never makes an exempt player the booker", async () => {
    const seeds: SignupSeed[] = [
      { id: "exempt", email: "sellaboudy95@gmail.com" },
      ...confirmed(11),
    ];
    for (let run = 0; run < 20; run++) {
      vi.clearAllMocks();
      db.game.groupBy.mockResolvedValue([]);
      db.game.update.mockResolvedValue({});
      db.team.deleteMany.mockResolvedValue({});
      db.team.create.mockResolvedValue({});
      db.game.findUnique.mockResolvedValue(gameWith(seeds));
      const r = await lockGame("game1");
      if (r.ok) {
        expect(r.bookerId).not.toBe("exempt");
        expect(r.bibsUserId).not.toBe("exempt");
        expect(r.footballUserId).not.toBe("exempt");
      }
    }
  });
});
