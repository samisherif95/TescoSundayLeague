import { describe, it, expect } from "vitest";
import { GameStatus, PaymentMethod, Position } from "@/generated/prisma/enums";
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  TEAM_SIZE,
  generateTeams,
  pickBooker,
  calcSplit,
  generatePaymentLink,
  monzoDescription,
  nextSundayNoon,
  signupDeadline,
  isSignupOpen,
  londonParts,
  londonWallTimeToUtc,
  londonInputValue,
  type DraftablePlayer,
  type BookerCandidate,
} from "@/lib/game";

/** Format an instant as London wall-clock "HH:mm" for DST assertions. */
function londonTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function player(userId: string, skillScore: number): DraftablePlayer {
  return { userId, position: Position.MID, skillScore };
}

describe("nextSundayNoon", () => {
  it("returns the coming Sunday at noon London (BST → 11:00 UTC)", () => {
    // Mon 1 Jun 2026, 09:00 UTC — the Monday cron's firing time, in summer.
    const from = new Date("2026-06-01T09:00:00.000Z");
    expect(nextSundayNoon(from).toISOString()).toBe(
      "2026-06-07T11:00:00.000Z",
    );
  });

  it("returns noon London in winter (GMT → 12:00 UTC)", () => {
    // Mon 5 Jan 2026.
    const from = new Date("2026-01-05T09:00:00.000Z");
    expect(nextSundayNoon(from).toISOString()).toBe(
      "2026-01-11T12:00:00.000Z",
    );
  });

  it("is always noon in London wall-clock, regardless of season", () => {
    for (const iso of [
      "2026-06-01T09:00:00.000Z",
      "2026-01-05T09:00:00.000Z",
      "2026-03-30T09:00:00.000Z",
      "2026-10-20T09:00:00.000Z",
    ]) {
      expect(londonTime(nextSundayNoon(new Date(iso)))).toBe("12:00");
    }
  });

  it("rolls to the FOLLOWING Sunday when called on a Sunday", () => {
    const sunday = new Date("2026-06-07T08:00:00.000Z");
    expect(nextSundayNoon(sunday).toISOString()).toBe(
      "2026-06-14T11:00:00.000Z",
    );
  });

  it("uses the London calendar date, not UTC, near midnight", () => {
    // 23:30 UTC on Sun 7 Jun is already Mon 8 Jun in London (BST), so the next
    // Sunday is 14 Jun — not 7 Jun (which would happen if we keyed off UTC).
    const lateSundayUtc = new Date("2026-06-07T23:30:00.000Z");
    expect(nextSundayNoon(lateSundayUtc).toISOString()).toBe(
      "2026-06-14T11:00:00.000Z",
    );
  });

  it("handles the GMT→BST spring-forward week", () => {
    // Clocks spring forward Sun 29 Mar 2026. Noon is well clear of the 01:00
    // transition, so the target Sunday is BST → 11:00 UTC.
    const from = new Date("2026-03-24T09:00:00.000Z"); // Tue 24 Mar
    expect(nextSundayNoon(from).toISOString()).toBe(
      "2026-03-29T11:00:00.000Z",
    );
  });
});

describe("signupDeadline", () => {
  it("is 18:00 London on the Friday before a summer kickoff (17:00 UTC)", () => {
    const kickoff = new Date("2026-06-07T11:00:00.000Z");
    expect(signupDeadline(kickoff).toISOString()).toBe(
      "2026-06-05T17:00:00.000Z",
    );
  });

  it("is 18:00 London on the Friday before a winter kickoff (18:00 UTC)", () => {
    const kickoff = new Date("2026-01-11T12:00:00.000Z");
    expect(signupDeadline(kickoff).toISOString()).toBe(
      "2026-01-09T18:00:00.000Z",
    );
  });

  it("is genuinely 18:00 London year-round", () => {
    for (const iso of ["2026-06-07T11:00:00.000Z", "2026-01-11T12:00:00.000Z"]) {
      expect(londonTime(signupDeadline(new Date(iso)))).toBe("18:00");
    }
  });
});

describe("londonWallTimeToUtc / londonParts round-trip", () => {
  it("round-trips a summer noon", () => {
    const utc = londonWallTimeToUtc(2026, 6, 7, 12, 0);
    expect(utc.toISOString()).toBe("2026-06-07T11:00:00.000Z");
    const p = londonParts(utc);
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([
      2026, 6, 7, 12, 0,
    ]);
  });

  it("round-trips a winter noon", () => {
    const utc = londonWallTimeToUtc(2026, 1, 11, 12, 0);
    expect(utc.toISOString()).toBe("2026-01-11T12:00:00.000Z");
  });
});

describe("londonInputValue", () => {
  it("formats a UTC instant as a London datetime-local string", () => {
    // Round-trips with londonWallTimeToUtc, which parses this exact format.
    expect(londonInputValue(new Date("2026-06-07T11:00:00.000Z"))).toBe(
      "2026-06-07T12:00",
    );
  });
});

describe("pickBooker", () => {
  it("throws when given no candidates", () => {
    expect(() => pickBooker([])).toThrow();
  });

  it("picks the player with the fewest past bookings", () => {
    const candidates: BookerCandidate[] = [
      { userId: "a", bookCount: 3, lastBookedAt: new Date("2026-01-01") },
      { userId: "b", bookCount: 1, lastBookedAt: new Date("2026-05-01") },
      { userId: "c", bookCount: 5, lastBookedAt: null },
    ];
    expect(pickBooker(candidates)).toBe("b");
  });

  it("breaks ties on fewest bookings by who booked longest ago", () => {
    const candidates: BookerCandidate[] = [
      { userId: "a", bookCount: 2, lastBookedAt: new Date("2026-05-01") },
      { userId: "b", bookCount: 2, lastBookedAt: new Date("2026-02-01") },
      { userId: "c", bookCount: 2, lastBookedAt: new Date("2026-04-01") },
    ];
    expect(pickBooker(candidates)).toBe("b"); // oldest last-booked
  });

  it("treats never-booked (null) as the longest ago", () => {
    const candidates: BookerCandidate[] = [
      { userId: "a", bookCount: 0, lastBookedAt: null },
      { userId: "b", bookCount: 0, lastBookedAt: new Date("2020-01-01") },
    ];
    expect(pickBooker(candidates)).toBe("a");
  });

  it("returns a tied player when count and date are equal", () => {
    const at = new Date("2026-03-01");
    const candidates: BookerCandidate[] = [
      { userId: "a", bookCount: 1, lastBookedAt: at },
      { userId: "b", bookCount: 1, lastBookedAt: at },
    ];
    expect(["a", "b"]).toContain(pickBooker(candidates));
  });
});

describe("generateTeams", () => {
  it("throws below the minimum", () => {
    const players = Array.from({ length: MIN_PLAYERS - 1 }, (_, i) =>
      player(`p${i}`, 3),
    );
    expect(() => generateTeams(players)).toThrow();
  });

  it("splits exactly 10 into two teams of five", () => {
    const players = Array.from({ length: 10 }, (_, i) => player(`p${i}`, i + 1));
    const teams = generateTeams(players);
    expect(teams.map((t) => t.label)).toEqual(["A", "B"]);
    expect(teams[0].players).toHaveLength(TEAM_SIZE);
    expect(teams[1].players).toHaveLength(TEAM_SIZE);
  });

  it("puts overflow (11–15) into a third team C", () => {
    const players = Array.from({ length: 13 }, (_, i) => player(`p${i}`, i + 1));
    const teams = generateTeams(players);
    expect(teams.map((t) => t.label)).toEqual(["A", "B", "C"]);
    expect(teams[0].players).toHaveLength(5);
    expect(teams[1].players).toHaveLength(5);
    expect(teams[2].players).toHaveLength(3);
  });

  it("caps the squad at MAX_PLAYERS, dropping the weakest", () => {
    const players = Array.from({ length: 18 }, (_, i) => player(`p${i}`, i + 1));
    const teams = generateTeams(players);
    const total = teams.reduce((n, t) => n + t.players.length, 0);
    expect(total).toBe(MAX_PLAYERS);
  });

  it("never duplicates or loses a player", () => {
    const players = Array.from({ length: 14 }, (_, i) => player(`p${i}`, i + 1));
    const ids = generateTeams(players)
      .flatMap((t) => t.players.map((p) => p.userId))
      .sort();
    expect(new Set(ids).size).toBe(14);
  });

  it("balances A and B closely on skill (strongest 10)", () => {
    const skills = [9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5];
    const players = skills.map((s, i) => player(`p${i}`, s));
    const [a, b] = generateTeams(players);
    const sum = (t: { players: { userId: string }[] }) =>
      t.players.reduce(
        (n, p) => n + skills[Number(p.userId.slice(1))],
        0,
      );
    // Snake-ish draft keeps the two main teams within one skill-step.
    expect(Math.abs(sum(a) - sum(b))).toBeLessThanOrEqual(1);
  });
});

describe("calcSplit", () => {
  it("splits evenly with no remainder", () => {
    expect(calcSplit(2500, 10)).toEqual({
      perPersonPence: 250,
      bookerKeepsPence: 250,
    });
  });

  it("gives the rounding remainder to the booker", () => {
    expect(calcSplit(2503, 10)).toEqual({
      perPersonPence: 250,
      bookerKeepsPence: 253,
    });
  });

  it("rejects fewer than two players", () => {
    expect(() => calcSplit(1000, 1)).toThrow();
  });

  it("rejects a negative total", () => {
    expect(() => calcSplit(-1, 5)).toThrow();
  });
});

describe("generatePaymentLink", () => {
  it("builds a Monzo link, stripping @ and encoding the description", () => {
    expect(
      generatePaymentLink(PaymentMethod.MONZO, "@alexc", 750, "Football 7-Jun"),
    ).toBe("https://monzo.me/alexc/7.50?d=Football%207-Jun");
  });

  it("builds a Revolut link with the GBP-suffixed amount", () => {
    expect(generatePaymentLink(PaymentMethod.REVOLUT, "alexc", 750, "x")).toBe(
      "https://revolut.me/alexc/7.50GBP",
    );
  });
});

describe("monzoDescription", () => {
  it("formats as 'Football <day>-<Mon>'", () => {
    expect(monzoDescription(new Date("2026-06-07T11:00:00.000Z"))).toBe(
      "Football 7-Jun",
    );
  });
});

describe("isSignupOpen", () => {
  const kickoff = new Date("2026-06-07T11:00:00.000Z");

  it("is open while OPEN and before the Friday deadline", () => {
    const now = new Date("2026-06-04T12:00:00.000Z");
    expect(isSignupOpen({ status: GameStatus.OPEN, kickoffAt: kickoff }, now)).toBe(
      true,
    );
  });

  it("is closed after the deadline", () => {
    const now = new Date("2026-06-05T17:30:00.000Z"); // past 18:00 BST deadline
    expect(isSignupOpen({ status: GameStatus.OPEN, kickoffAt: kickoff }, now)).toBe(
      false,
    );
  });

  it("is closed once the game is no longer OPEN", () => {
    const now = new Date("2026-06-04T12:00:00.000Z");
    expect(
      isSignupOpen({ status: GameStatus.LOCKED, kickoffAt: kickoff }, now),
    ).toBe(false);
  });
});
