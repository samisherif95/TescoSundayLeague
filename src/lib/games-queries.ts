import { cache } from "react";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";

/**
 * Returns the most relevant game for the home page, scoped to one group:
 *  - The nearest upcoming OPEN/LOCKED/BOOKED game, or
 *  - The most recent COMPLETED game if no upcoming.
 *
 * Wrapped in React.cache for per-request dedup (Prisma is not auto-memoized).
 */
export const getCurrentGame = cache(async (groupId: string) => {
  const upcoming = await prisma.game.findFirst({
    where: {
      groupId,
      status: {
        in: [GameStatus.OPEN, GameStatus.LOCKED, GameStatus.BOOKED],
      },
    },
    orderBy: { kickoffAt: "asc" },
    include: gameInclude,
  });
  if (upcoming) return upcoming;
  return prisma.game.findFirst({
    where: { groupId, status: GameStatus.COMPLETED },
    orderBy: { kickoffAt: "desc" },
    include: gameInclude,
  });
});

const gameInclude = {
  group: {
    select: { id: true, name: true, lockOffsetHours: true },
  },
  signups: {
    where: { status: { not: SignupStatus.DROPPED_OUT } },
    orderBy: [
      { status: "asc" },
      { waitlistPosition: "asc" },
      { signedUpAt: "asc" },
    ],
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          preferredPosition: true,
        },
      },
    },
  },
  booker: {
    select: {
      id: true,
      name: true,
      paymentMethod: true,
      paymentHandle: true,
    },
  },
  bibsBringer: { select: { id: true, name: true } },
  footballBringer: { select: { id: true, name: true } },
  guests: {
    orderBy: { createdAt: "asc" },
    include: {
      host: { select: { id: true, name: true } },
    },
  },
  teams: {
    orderBy: { label: "asc" },
    include: {
      players: {
        include: {
          user: {
            select: { id: true, name: true, image: true },
          },
          guest: {
            include: { host: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
  matches: {
    orderBy: { order: "asc" },
    include: {
      homeTeam: { select: { id: true, label: true } },
      awayTeam: { select: { id: true, label: true } },
      winnerTeam: { select: { id: true, label: true } },
      goals: {
        orderBy: { createdAt: "asc" },
        include: {
          scorer: { select: { id: true, name: true, image: true } },
        },
      },
    },
  },
  paymentRequests: {
    include: {
      debtor: { select: { id: true, name: true, image: true } },
    },
  },
} satisfies Prisma.GameInclude;

export type GameWithDetail = NonNullable<
  Awaited<ReturnType<typeof getCurrentGame>>
>;

export const getGameWithDetail = cache((id: string) => {
  return prisma.game.findUnique({
    where: { id },
    include: gameInclude,
  });
});

// Lighter include for the history list: just enough to summarise each game
// (per-match scores + scorers). No signups/payments — those are detail-only.
const historyInclude = {
  matches: {
    orderBy: { order: "asc" },
    include: {
      homeTeam: { select: { id: true, label: true } },
      awayTeam: { select: { id: true, label: true } },
      goals: {
        select: {
          teamId: true,
          phase: true,
          isOwnGoal: true,
          scorerId: true,
          scorer: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.GameInclude;

export type GameHistoryItem = Awaited<
  ReturnType<typeof getGameHistory>
>[number];

/**
 * Completed games for the history list (one group), newest first. Group admins
 * see every completed game in the group; everyone else sees only the ones they
 * were signed up for (dropouts excluded).
 */
export const getGameHistory = cache(
  (groupId: string, userId: string, isGroupAdmin: boolean) => {
  return prisma.game.findMany({
    where: {
      groupId,
      status: GameStatus.COMPLETED,
      ...(isGroupAdmin
        ? {}
        : {
            signups: {
              some: {
                userId,
                status: { not: SignupStatus.DROPPED_OUT },
              },
            },
          }),
    },
    orderBy: { kickoffAt: "desc" },
    include: historyInclude,
  });
});

/**
 * Every credited, non-own goal scored across a group's COMPLETED games — the
 * raw rows the leaderboard ranks (see `buildLeaderboard`). Own goals and
 * anonymous goals are filtered in SQL so we only ship rows that can be tallied.
 */
export const getGroupScorerGoals = cache((groupId: string) => {
  return prisma.goal.findMany({
    where: {
      isOwnGoal: false,
      scorerId: { not: null },
      match: { game: { groupId, status: GameStatus.COMPLETED } },
    },
    select: {
      scorerId: true,
      isOwnGoal: true,
      scorer: { select: { id: true, name: true, image: true } },
    },
  });
});

/**
 * Every member of a group with their current peer rating (`skillScore`) and how
 * many ratings it's built from — the rows the ratings board ranks (see
 * `buildRatingsBoard`). `ratingsReceived` is counted, never listed, so no
 * individual rater is exposed.
 */
export const getGroupRatingMembers = cache((groupId: string) => {
  return prisma.groupMember.findMany({
    where: { groupId },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          preferredPosition: true,
          skillScore: true,
          _count: { select: { ratingsReceived: true } },
        },
      },
    },
  });
});
