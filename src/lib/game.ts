import { GameStatus, PaymentMethod, Position } from "@/generated/prisma/enums";

export const MIN_PLAYERS = 10;
export const MAX_PLAYERS = 15;
export const TEAM_SIZE = 5;

/** Cryptographically random pick from a non-empty array. */
export function pickRandom<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("pickRandom called with empty array");
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const idx = bytes[0] % items.length;
  return items[idx];
}

export type DraftablePlayer = {
  userId: string;
  position: Position;
  skillScore: number;
};

export type DraftedTeam = {
  label: "A" | "B" | "C";
  players: { userId: string }[];
};

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
    { label: "A", players: teamA.map((p) => ({ userId: p.userId })) },
    { label: "B", players: teamB.map((p) => ({ userId: p.userId })) },
  ];
  if (overflow.length > 0) {
    teams.push({
      label: "C",
      players: overflow.map((p) => ({ userId: p.userId })),
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
 *  - REVOLUT: https://revolut.me/<handle>/<amount>GBP
 * (Revolut .me links take the amount as `<amount><CURRENCY>` appended to the
 * handle; description isn't supported in the URL.)
 */
export function generatePaymentLink(
  method: PaymentMethod,
  handle: string,
  amountPence: number,
  description: string,
): string {
  const amountPounds = (amountPence / 100).toFixed(2);
  const cleanHandle = handle.trim().replace(/^@/, "");
  if (method === PaymentMethod.REVOLUT) {
    return `https://revolut.me/${encodeURIComponent(cleanHandle)}/${amountPounds}GBP`;
  }
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

/**
 * Next Sunday at 12:00 **Europe/London** wall-clock time, returned as a UTC Date.
 * Used to seed kickoffAt when the Monday cron creates the week's game.
 *
 * Computed via London parts + {@link londonWallTimeToUtc} (not `setHours`) so the
 * kickoff is the correct instant regardless of the server's timezone — Vercel
 * runs in UTC, where `setHours(12)` would yield 13:00 London during BST — and
 * across the BST/GMT switch. Pass a base date for testability.
 */
export function nextSundayNoon(now = new Date()): Date {
  const p = londonParts(now);
  // Day-of-week of the current London calendar date (0 = Sunday).
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const daysUntilSun = dow === 0 ? 7 : 7 - dow;
  const target = new Date(
    Date.UTC(p.year, p.month - 1, p.day) + daysUntilSun * 24 * 60 * 60 * 1000,
  );
  return londonWallTimeToUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    12,
    0,
  );
}

export const LONDON_TZ = "Europe/London";

/** The London wall-clock parts of a UTC instant. */
function londonParts(d: Date): {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
} {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
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

/**
 * The UTC instant for a given London wall-clock time (DST-aware).
 * 18:00 is never near a DST transition, so a single correction pass is exact.
 */
function londonWallTimeToUtc(
  year: number,
  month1: number, // 1-12
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month1 - 1, day, hour, minute);
  const p = londonParts(new Date(guess));
  const mapped = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess - (mapped - guess));
}

/**
 * Signup deadline for a game: 18:00 Europe/London on the Friday before kickoff.
 *
 * Derived from the kickoff so it always reflects the real game date, and it's
 * genuinely "6pm London" year-round (handles BST/GMT) — independent of when the
 * friday-lock cron actually fires.
 */
export function signupDeadline(kickoffAt: Date): Date {
  const k = londonParts(kickoffAt);
  // Roll back 2 London calendar days (the kickoff Sunday → the Friday before).
  const friday = new Date(
    Date.UTC(k.year, k.month - 1, k.day) - 2 * 24 * 60 * 60 * 1000,
  );
  return londonWallTimeToUtc(
    friday.getUTCFullYear(),
    friday.getUTCMonth() + 1,
    friday.getUTCDate(),
    18,
    0,
  );
}

/** Signups are open only while the game is OPEN *and* we're before the deadline. */
export function isSignupOpen(
  game: { status: GameStatus; kickoffAt: Date },
  now: Date = new Date(),
): boolean {
  return game.status === GameStatus.OPEN && now < signupDeadline(game.kickoffAt);
}
