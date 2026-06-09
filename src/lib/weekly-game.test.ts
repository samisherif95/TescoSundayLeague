import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameStatus } from "@/generated/prisma/enums";

// Mock the layers openWeeklyGame depends on (DB, email, push). env is real —
// we only read env.appUrl, which has a safe default.
const { db, sendEmail, sendPushToUsers } = vi.hoisted(() => ({
  db: {
    game: { findFirst: vi.fn(), create: vi.fn() },
    group: { findUnique: vi.fn() },
    groupMember: { findMany: vi.fn() },
  },
  sendEmail: vi.fn(),
  sendPushToUsers: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/push", () => ({ sendPushToUsers }));

import { openWeeklyGame } from "@/lib/weekly-game";

const KICKOFF = new Date("2026-06-14T11:00:00.000Z");

const GROUP = {
  id: "grp1",
  name: "Tesco Sunday League",
  timezone: "Europe/London",
  defaultPitchName: "Ladbroke Grove",
  defaultPitchBookingUrl: "https://hireapitch.com/ladbroke-grove",
};

// Three members: one fully set up, one WITH AN EMAIL BUT NO NAME (the player
// the old `email && name` filter silently dropped), and one with no email at
// all (push only — can't email what doesn't exist).
function members() {
  return [
    { user: { id: "u1", email: "alice@x.com", name: "Alice" } },
    { user: { id: "u2", email: "bob@x.com", name: null } },
    { user: { id: "u3", email: null, name: "Cara" } },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  db.game.findFirst.mockResolvedValue(null); // no existing game for the slot
  db.group.findUnique.mockResolvedValue(GROUP);
  db.game.create.mockResolvedValue({ id: "game1" });
  db.groupMember.findMany.mockResolvedValue(members());
  sendEmail.mockResolvedValue(undefined);
  sendPushToUsers.mockResolvedValue(undefined);
});

describe("openWeeklyGame — notifications", () => {
  it("emails every member with an address, including those without a name", async () => {
    const r = await openWeeklyGame(GROUP.id, KICKOFF);
    expect(r).toEqual({ gameId: "game1", created: true });

    // Both members with an email are notified — crucially the nameless one too.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = sendEmail.mock.calls.map((c) => c[0].to).sort();
    expect(recipients).toEqual(["alice@x.com", "bob@x.com"]);
  });

  it("pushes every member (email or not)", async () => {
    await openWeeklyGame(GROUP.id, KICKOFF);
    expect(sendPushToUsers).toHaveBeenCalledWith(
      ["u1", "u2", "u3"],
      expect.objectContaining({ url: "/games/game1" }),
    );
  });

  it("one failed email doesn't stop the others (best-effort fan-out)", async () => {
    sendEmail.mockRejectedValueOnce(new Error("smtp blip")); // first recipient
    const r = await openWeeklyGame(GROUP.id, KICKOFF);
    // The game is still created and every remaining member is still attempted.
    expect(r).toEqual({ gameId: "game1", created: true });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendPushToUsers).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — an existing game for the slot notifies no one", async () => {
    db.game.findFirst.mockResolvedValue({ id: "existing" });
    const r = await openWeeklyGame(GROUP.id, KICKOFF);
    expect(r).toEqual({ gameId: "existing", created: false });
    expect(db.game.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendPushToUsers).not.toHaveBeenCalled();
  });
});
