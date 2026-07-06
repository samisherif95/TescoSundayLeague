import { cache } from "react";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";

/**
 * Returns the most relevant game for the home page, scoped to one group:
 *  1. The nearest active (OPEN/LOCKED/BOOKED) game whose kickoff hasn't long
 *     passed — this week's signup sheet, or the game happening today.
 *  2. Else the most recent active game (a game whose kickoff is in the past but
 *     an admin hasn't ended yet — still shown, but never in front of a newer
 *     game from step 1).
 *  3. Else the most recent COMPLETED game.
 *
 * The time filter is what stops a forgotten (never-ended) game from pinning the
 * home page: once a newer game exists it wins step 1, because the stale one has
 * dropped out of the "kickoff hasn't long passed" window. Since the lifecycle is
 * admin-driven (no auto-complete cron), that forgotten-game case is the norm.
 *
 * Wrapped in React.cache for per-request dedup (Prisma is not auto-memoized).
 */
const ACTIVE_STATUSES = [
  GameStatus.OPEN,
  GameStatus.LOCKED,
  GameStatus.BOOKED,
] as const;
// A game still counts as "current" until ~12h after kickoff, so a game played
// earlier today keeps showing while nothing newer exists.
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export const getCurrentGame = cache(async (groupId: string) => {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const upcoming = await prisma.game.findFirst({
    where: {
      groupId,
      status: { in: [...ACTIVE_STATUSES] },
      kickoffAt: { gte: cutoff },
    },
    orderBy: { kickoffAt: "asc" },
    include: gameInclude,
  });
  if (upcoming) return upcoming;
  // No current game — fall back to the most recent active game (a past game an
  // admin hasn't ended), then to the most recent completed game.
  const staleActive = await prisma.game.findFirst({
    where: { groupId, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { kickoffAt: "desc" },
    include: gameInclude,
  });
  if (staleActive) return staleActive;
  return prisma.game.findFirst({
    where: { groupId, status: GameStatus.COMPLETED },
    orderBy: { kickoffAt: "desc" },
    include: gameInclude,
  });
});

const gameInclude = {
  group: {
    select: { id: true, name: true, lockOffsetHours: true, timezone: true },
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
