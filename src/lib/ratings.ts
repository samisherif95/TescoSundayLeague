// Group ratings board: everyone's current peer rating, ranked, to keep players
// motivated. A user's rating is their `skillScore` — the running average of the
// 1–5 stars teammates have given them (see rate/actions.ts). The ranking is a
// pure function of the member rows so it can be unit-tested without a database.
//
// Players nobody has rated yet sit at the default skillScore (3.0), which isn't
// *earned*, so they're listed separately as "unrated" (rank null) rather than
// being slotted into the middle of the table on a placeholder number.

import type { Position } from "@/generated/prisma/enums";

export type RatingMember = {
  id: string;
  name: string | null;
  image: string | null;
  position: Position | null;
  skillScore: number;
  ratingsCount: number;
};

export type RatingEntry = {
  id: string;
  name: string;
  image: string | null;
  position: Position | null;
  score: number;
  ratingsCount: number;
  // 1-based standing (standard competition ranking, ties share a rank), or
  // null for a player nobody has rated yet.
  rank: number | null;
};

/**
 * Rank a group's members by rating, highest first. Rated players come first
 * (ties on score broken alphabetically but still sharing a rank); unrated
 * players follow, alphabetically, with a null rank.
 */
export function buildRatingsBoard(members: RatingMember[]): RatingEntry[] {
  const base = members.map(
    (m): RatingEntry => ({
      id: m.id,
      name: m.name ?? "Unnamed",
      image: m.image,
      position: m.position,
      score: m.skillScore,
      ratingsCount: m.ratingsCount,
      rank: null,
    }),
  );

  const rated = base
    .filter((e) => e.ratingsCount > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  let rank = 0;
  let prevScore = Number.NaN;
  rated.forEach((entry, i) => {
    if (entry.score !== prevScore) {
      rank = i + 1;
      prevScore = entry.score;
    }
    entry.rank = rank;
  });

  const unrated = base
    .filter((e) => e.ratingsCount === 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...rated, ...unrated];
}
