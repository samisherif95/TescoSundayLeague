import { cache } from "react";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";

/**
 * Returns the most relevant game for the home page:
 *  - The nearest upcoming OPEN/LOCKED/BOOKED game, or
 *  - The most recent COMPLETED game if no upcoming.
 *
 * Wrapped in React.cache for per-request dedup (Prisma is not auto-memoized).
 */
export const getCurrentGame = cache(async () => {
  const upcoming = await prisma.game.findFirst({
    where: {
      status: {
        in: [GameStatus.OPEN, GameStatus.LOCKED, GameStatus.BOOKED],
      },
    },
    orderBy: { kickoffAt: "asc" },
    include: gameInclude,
  });
  if (upcoming) return upcoming;
  return prisma.game.findFirst({
    where: { status: GameStatus.COMPLETED },
    orderBy: { kickoffAt: "desc" },
    include: gameInclude,
  });
});

const gameInclude = {
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
  teams: {
    orderBy: { label: "asc" },
    include: {
      players: {
        include: {
          user: {
            select: { id: true, name: true, image: true },
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
 * Completed games for the history list, newest first. Admins see every
 * completed game; everyone else sees only the ones they were signed up for
 * (dropouts excluded).
 */
export const getGameHistory = cache((userId: string, isAdmin: boolean) => {
  return prisma.game.findMany({
    where: {
      status: GameStatus.COMPLETED,
      ...(isAdmin
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
