import { pickRandom } from "@/lib/game";

// A confirmed player as far as game duties care: their id and whether they're
// exempt from ever being picked for booker / bibs / football. Exemption is now
// per-group data (GroupMember.exemptFromDuties) — an organizer who quietly never
// wants a chore — rather than a hardcoded email allowlist. Exempt players still
// play and pay their own share; they're just never assigned to bring/collect.
export type DutyPlayer = { id: string; exempt: boolean };

/**
 * Randomly pick who brings the bibs and the football from the eligible
 * (non-exempt) confirmed players. Tries to keep booker / bibs / football as
 * three different people, falling back gracefully when the pool is small.
 */
export function assignExtras(
  players: DutyPlayer[],
  bookerId: string | null,
): { bibsUserId: string | null; footballUserId: string | null } {
  const eligible = players.filter((p) => !p.exempt).map((p) => p.id);
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
  const eligible = players.filter((p) => !p.exempt).map((p) => p.id);
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
