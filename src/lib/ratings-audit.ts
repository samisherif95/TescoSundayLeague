// Ratings audit: the platform owner's private week-by-week view of WHO rated
// whom and what they gave them — the one deliberate exception to the "raterId
// is never exposed" rule (see Rating in prisma/schema.prisma). Access is
// hardcoded to a single account rather than group ADMINs, because any member
// can become an admin of their own group and this data is sensitive for the
// whole platform.
//
// The grouping is a pure function of the rating rows so it can be unit-tested
// without a database.

export const RATINGS_AUDIT_EMAIL = "sellaboudy95@gmail.com";

/** True only for the platform owner's account. */
export function canViewRatingsAudit(email: string | null | undefined): boolean {
  return email?.toLowerCase() === RATINGS_AUDIT_EMAIL;
}

export type AuditUser = {
  id: string;
  name: string | null;
  image: string | null;
};

export type AuditRating = {
  rater: AuditUser;
  ratee: AuditUser;
  score: number;
};

export type RaterGroup = {
  rater: AuditUser;
  // Everyone this rater scored in the game, alphabetical by ratee name.
  given: { ratee: AuditUser; score: number }[];
};

/**
 * Group one game's ratings by who gave them. Raters are alphabetical by name,
 * and each rater's list is alphabetical by ratee name, so the page reads as a
 * stable roll call rather than insertion order.
 */
export function groupRatingsByRater(ratings: AuditRating[]): RaterGroup[] {
  const byRater = new Map<string, RaterGroup>();
  for (const r of ratings) {
    let group = byRater.get(r.rater.id);
    if (!group) {
      group = { rater: r.rater, given: [] };
      byRater.set(r.rater.id, group);
    }
    group.given.push({ ratee: r.ratee, score: r.score });
  }

  const name = (u: AuditUser) => u.name ?? "Unnamed";
  const groups = [...byRater.values()];
  for (const g of groups) {
    g.given.sort((a, b) => name(a.ratee).localeCompare(name(b.ratee)));
  }
  groups.sort((a, b) => name(a.rater).localeCompare(name(b.rater)));
  return groups;
}
