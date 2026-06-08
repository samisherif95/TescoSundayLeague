import { GameStatus, PaymentMethod, Position } from "@/generated/prisma/enums";

export const MIN_PLAYERS = 10;
export const MAX_PLAYERS = 15;
export const TEAM_SIZE = 5;
/**
 * Skill used to balance a guest into the teams. Guests have no rating history,
 * so they sit at the neutral default (same as a brand-new member's skillScore).
 */
export const GUEST_SKILL_SCORE = 3.0;

/** Cryptographically random pick from a non-empty array. */
export function pickRandom<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("pickRandom called with empty array");
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const idx = bytes[0] % items.length;
  return items[idx];
}

/**
 * Identifies who occupies a team slot: either a member (`userId`) or a guest
 * (`guestId`). Exactly one is set — the same shape `TeamPlayer` rows take.
 */
export type TeamMemberRef =
  | { userId: string; guestId?: undefined }
  | { userId?: undefined; guestId: string };

export type DraftablePlayer = TeamMemberRef & {
  // Position is informational only — balancing is purely on skillScore — so
  // it's optional (guests have none).
  position?: Position;
  skillScore: number;
};

export type DraftedTeam = {
  label: "A" | "B" | "C";
  players: TeamMemberRef[];
};

/** Strip a draftable down to just its member/guest identity. */
function memberRef(p: DraftablePlayer): TeamMemberRef {
  return p.userId ? { userId: p.userId } : { guestId: p.guestId! };
}

/**
 * Balanced team generator for our 2-or-3-teams-of-5 format.
 *
 * - 10 players  → two balanced teams of 5 (A, B).
 * - 11–15       → two balanced teams of 5 (A, B) PLUS a 3rd team C holding
 *                 the overflow (1–5). In play, C rotates on against the
 *                 losing team and borrows players if short — the app just
 *                 nominates who's in C, it doesn't enforce the rotation.
 *
 * Goalkeeper is not a concept: everyone rotates in goal informally, so we
 * balance purely on skillScore.
 *
 * Algorithm (two-phase, for predictability):
 *  1. Cap at MAX_PLAYERS (15). Sort by skillScore desc.
 *  2. Phase A — snake-draft the strongest 10 into A and B: each pick goes to
 *     whichever of A/B currently has the lower total skill (the proven
 *     two-team balance).
 *  3. Phase B — the remaining 1–5 form team C (only if any remain).
 */
export function generateTeams(allPlayers: DraftablePlayer[]): DraftedTeam[] {
  if (allPlayers.length < MIN_PLAYERS) {
    throw new Error(`Need at least ${MIN_PLAYERS} players to generate teams`);
  }
  const players = allPlayers.slice(0, MAX_PLAYERS);
  const sorted = [...players].sort((a, b) => b.skillScore - a.skillScore);

  const main = sorted.slice(0, TEAM_SIZE * 2); // strongest 10 → A + B
  const overflow = sorted.slice(TEAM_SIZE * 2); // 0–5 → C

  const teamA: DraftablePlayer[] = [];
  const teamB: DraftablePlayer[] = [];
  for (const p of main) {
    if (teamA.length >= TEAM_SIZE) {
      teamB.push(p);
      continue;
    }
    if (teamB.length >= TEAM_SIZE) {
      teamA.push(p);
      continue;
    }
    const totalA = teamA.reduce((s, q) => s + q.skillScore, 0);
    const totalB = teamB.reduce((s, q) => s + q.skillScore, 0);
    if (totalA <= totalB) teamA.push(p);
    else teamB.push(p);
  }

  const teams: DraftedTeam[] = [
    { label: "A", players: teamA.map(memberRef) },
    { label: "B", players: teamB.map(memberRef) },
  ];
  if (overflow.length > 0) {
    teams.push({
      label: "C",
      players: overflow.map(memberRef),
    });
  }
  return teams;
}

export type BookerCandidate = {
  userId: string;
  /** How many past games this player has booked. */
  bookCount: number;
  /** Kickoff of their most recent booked game, or null if they never have. */
  lastBookedAt: Date | null;
};

/**
 * Fairly pick who books the pitch this week. Spreads the chore around:
 *  1. Fewest past bookings wins.
 *  2. Tie → whoever booked longest ago (never-booked sorts first).
 *  3. Still tied → cryptographically random among the tied players.
 */
export function pickBooker(candidates: BookerCandidate[]): string {
  if (candidates.length === 0) {
    throw new Error("pickBooker called with no candidates");
  }
  const minCount = Math.min(...candidates.map((c) => c.bookCount));
  let pool = candidates.filter((c) => c.bookCount === minCount);

  if (pool.length > 1) {
    // never-booked (null) is "longest ago" → epoch 0
    const oldest = Math.min(
      ...pool.map((c) => c.lastBookedAt?.getTime() ?? 0),
    );
    pool = pool.filter((c) => (c.lastBookedAt?.getTime() ?? 0) === oldest);
  }

  return pickRandom(pool).userId;
}

/**
 * Split a total cost (in pence) evenly across N players, returning
 * one amountPence per non-booker (since the booker is reimbursed for the rest).
 * The booker absorbs any rounding remainder.
 */
export function calcSplit(
  totalPence: number,
  playerCount: number,
): { perPersonPence: number; bookerKeepsPence: number } {
  if (playerCount < 2) throw new Error("Need at least 2 players to split");
  if (totalPence < 0) throw new Error("Total cannot be negative");
  const perPerson = Math.floor(totalPence / playerCount);
  const remainder = totalPence - perPerson * playerCount;
  return { perPersonPence: perPerson, bookerKeepsPence: perPerson + remainder };
}

/**
 * Build a payment-request URL for the booker's chosen method.
 *  - MONZO:   https://monzo.me/<handle>/<amount>?d=<description>
 *  - REVOLUT: https://revolut.me/<handle>?currency=GBP&amount=<pence>&note=<description>
 * (Revolut .me links take the amount in minor units/pence as an integer query
 * param — e.g. `amount=1800` is £18.00 — alongside the currency and an optional
 * free-text note.)
 */
export function generatePaymentLink(
  method: PaymentMethod,
  handle: string,
  amountPence: number,
  description: string,
): string {
  const cleanHandle = handle.trim().replace(/^@/, "");
  if (method === PaymentMethod.REVOLUT) {
    return `https://revolut.me/${encodeURIComponent(cleanHandle)}?currency=GBP&amount=${amountPence}&note=${encodeURIComponent(description)}`;
  }
  const amountPounds = (amountPence / 100).toFixed(2);
  return `https://monzo.me/${encodeURIComponent(cleanHandle)}/${amountPounds}?d=${encodeURIComponent(description)}`;
}

/** Format a kickoff date for a Monzo description, e.g. "Football 17-May". */
export function monzoDescription(kickoff: Date): string {
  const day = kickoff.getUTCDate();
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `Football ${day}-${months[kickoff.getUTCMonth()]}`;
}

export const LONDON_TZ = "Europe/London";

/**
 * A group's weekly schedule, used to compute the next kickoff. Mirrors the
 * Group schedule columns. (timezone is an IANA zone, e.g. "Europe/London".)
 */
export type GroupSchedule = {
  kickoffWeekday: number; // 0=Sun .. 6=Sat
  kickoffHour: number;
  kickoffMinute: number;
  timezone: string;
};

/**
 * The next kickoff for a group's schedule — the next occurrence of its weekday
 * at its wall-clock time (in the group's timezone), strictly in the future,
 * returned as a UTC Date. Generalises the old `nextSundayNoon`.
 *
 * Computed via zoned parts + {@link zonedWallTimeToUtc} (not `setHours`) so the
 * kickoff is the correct instant regardless of the server's timezone (Vercel
 * runs in UTC) and across DST switches. Pass a base date for testability.
 */
export function nextKickoff(schedule: GroupSchedule, now = new Date()): Date {
  const tz = schedule.timezone;
  const p = zonedParts(now, tz);
  // Day-of-week of the current calendar date in the group's timezone.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  // Always strictly the NEXT occurrence (today's weekday rolls to next week),
  // matching the old nextSundayNoon behaviour the create-game action relies on.
  let daysUntil = (schedule.kickoffWeekday - dow + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  const target = new Date(
    Date.UTC(p.year, p.month - 1, p.day) + daysUntil * 24 * 60 * 60 * 1000,
  );
  return zonedWallTimeToUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    schedule.kickoffHour,
    schedule.kickoffMinute,
    tz,
  );
}

/**
 * Next Sunday at 12:00 Europe/London, as a UTC Date — the legacy default
 * cadence. Thin wrapper over {@link nextKickoff} kept for the seed and tests.
 */
export function nextSundayNoon(now = new Date()): Date {
  return nextKickoff(
    { kickoffWeekday: 0, kickoffHour: 12, kickoffMinute: 0, timezone: LONDON_TZ },
    now,
  );
}

/** The wall-clock parts of a UTC instant in the given timezone. */
export function zonedParts(
  d: Date,
  timeZone: string,
): {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
} {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(d)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  // Some engines emit hour "24" at midnight — normalise to 0.
  if (p.hour === 24) p.hour = 0;
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
  };
}

/** The London wall-clock parts of a UTC instant. */
export function londonParts(d: Date) {
  return zonedParts(d, LONDON_TZ);
}

/**
 * The UTC instant for a given wall-clock time in a timezone (DST-aware).
 * Daytime kickoffs (and evening deadlines) are never near a DST transition —
 * which happens at 01:00/02:00 — so a single correction pass is exact.
 */
export function zonedWallTimeToUtc(
  year: number,
  month1: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month1 - 1, day, hour, minute);
  const p = zonedParts(new Date(guess), timeZone);
  const mapped = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess - (mapped - guess));
}

/** The UTC instant for a given London wall-clock time (DST-aware). */
export function londonWallTimeToUtc(
  year: number,
  month1: number, // 1-12
  day: number,
  hour: number,
  minute: number,
): Date {
  return zonedWallTimeToUtc(year, month1, day, hour, minute, LONDON_TZ);
}

/**
 * Format a UTC instant as the London wall-clock value an `<input type="datetime-local">`
 * expects: `YYYY-MM-DDTHH:mm`. The inverse of feeding that string back through
 * {@link londonWallTimeToUtc}, so the editor round-trips without timezone drift.
 */
export function londonInputValue(d: Date): string {
  const p = londonParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * The legacy default: how many hours before kickoff signups close. 42h before a
 * Sunday-noon kickoff lands on Friday 18:00. Groups override this via their
 * `lockOffsetHours`.
 */
export const DEFAULT_LOCK_OFFSET_HOURS = 42;

/**
 * Signup/lock deadline for a game: `lockOffsetHours` before kickoff. Derived
 * from the kickoff so it always reflects the real game date, independent of when
 * the admin actually locks the lineup. Defaults to the legacy Friday-6pm offset.
 */
export function lockDeadline(
  kickoffAt: Date,
  lockOffsetHours: number = DEFAULT_LOCK_OFFSET_HOURS,
): Date {
  return new Date(kickoffAt.getTime() - lockOffsetHours * 60 * 60 * 1000);
}

/** @deprecated Use {@link lockDeadline}. */
export function signupDeadline(
  kickoffAt: Date,
  lockOffsetHours: number = DEFAULT_LOCK_OFFSET_HOURS,
): Date {
  return lockDeadline(kickoffAt, lockOffsetHours);
}

/** Signups are open only while the game is OPEN *and* we're before the deadline. */
export function isSignupOpen(
  game: { status: GameStatus; kickoffAt: Date },
  lockOffsetHours: number = DEFAULT_LOCK_OFFSET_HOURS,
  now: Date = new Date(),
): boolean {
  return (
    game.status === GameStatus.OPEN &&
    now < lockDeadline(game.kickoffAt, lockOffsetHours)
  );
}
