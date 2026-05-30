import { pickRandom } from "@/lib/game";

// Players who are quietly never picked for a game duty (booker / bibs /
// football). They still play and pay their own share — they're just never
// the one assigned to bring or collect anything.
const EXEMPT_EMAILS = new Set<string>(["sellaboudy95@gmail.com"]);

export function isExemptFromDuties(email: string | null | undefined): boolean {
  return !!email && EXEMPT_EMAILS.has(email.toLowerCase());
}

export type DutyPlayer = { id: string; email: string | null };

/**
 * Randomly pick who brings the bibs and the football from the eligible
 * (non-exempt) confirmed players. Tries to keep booker / bibs / football as
 * three different people, falling back gracefully when the pool is small.
 */
export function assignExtras(
  players: DutyPlayer[],
  bookerId: string | null,
): { bibsUserId: string | null; footballUserId: string | null } {
  const eligible = players
    .filter((p) => !isExemptFromDuties(p.email))
    .map((p) => p.id);
  if (eligible.length === 0) {
    return { bibsUserId: null, footballUserId: null };
  }

  const bibsPool = preferExcluding(eligible, [bookerId]);
  const bibsUserId = pickRandom(bibsPool);

  const footballPool = preferExcluding(eligible, [bookerId, bibsUserId]);
  const footballUserId = pickRandom(footballPool);

  return { bibsUserId, footballUserId };
}

/** Pick a single eligible player for one duty, avoiding the given ids. */
export function pickExtra(
  players: DutyPlayer[],
  avoid: (string | null)[],
): string | null {
  const eligible = players
    .filter((p) => !isExemptFromDuties(p.email))
    .map((p) => p.id);
  if (eligible.length === 0) return null;
  return pickRandom(preferExcluding(eligible, avoid));
}

/**
 * Return `ids` with `avoid` removed — but if that empties the list, keep the
 * full list so we always return something to pick from.
 */
function preferExcluding(ids: string[], avoid: (string | null)[]): string[] {
  const blocked = new Set(avoid.filter(Boolean) as string[]);
  const filtered = ids.filter((id) => !blocked.has(id));
  return filtered.length > 0 ? filtered : ids;
}
