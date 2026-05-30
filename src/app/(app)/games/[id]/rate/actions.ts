"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  GameStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import { requireOnboardedUser } from "@/lib/session";

const ratingSchema = z.object({
  gameId: z.string().min(1),
  ratings: z.array(
    z.object({
      rateeId: z.string().min(1),
      score: z.number().int().min(1).max(5),
    }),
  ),
});

const RATING_WINDOW_HOURS = 48;

export async function submitRatings(payload: unknown) {
  const user = await requireOnboardedUser();
  const parsed = ratingSchema.safeParse(payload);
  if (!parsed.success) return { error: "Invalid input" };

  const game = await prisma.game.findUnique({
    where: { id: parsed.data.gameId },
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        select: { userId: true },
      },
    },
  });
  if (!game) return { error: "Game not found" };
  if (game.status !== GameStatus.COMPLETED) {
    return { error: "Ratings only open after the match" };
  }
  const windowMs = RATING_WINDOW_HOURS * 60 * 60 * 1000;
  if (Date.now() - game.kickoffAt.getTime() > windowMs) {
    return { error: "Rating window has closed" };
  }
  // Rater must have played
  const playedIds = new Set(game.signups.map((s) => s.userId));
  if (!playedIds.has(user.id)) {
    return { error: "Only players from that game can rate" };
  }
  // Can't rate self; can only rate teammates
  const validRatees = new Set(parsed.data.ratings.map((r) => r.rateeId));
  if (validRatees.has(user.id)) return { error: "Cannot rate yourself" };
  for (const id of validRatees) {
    if (!playedIds.has(id)) return { error: "Invalid teammate" };
  }

  await prisma.$transaction(async (tx) => {
    for (const r of parsed.data.ratings) {
      await tx.rating.upsert({
        where: {
          gameId_raterId_rateeId: {
            gameId: parsed.data.gameId,
            raterId: user.id,
            rateeId: r.rateeId,
          },
        },
        create: {
          gameId: parsed.data.gameId,
          raterId: user.id,
          rateeId: r.rateeId,
          score: r.score,
        },
        update: { score: r.score },
      });
    }
    // Recompute each ratee's skillScore as a running average. One grouped
    // aggregate for all teammates instead of one query per teammate.
    const rateeIds = parsed.data.ratings.map((r) => r.rateeId);
    const aggregates = await tx.rating.groupBy({
      by: ["rateeId"],
      where: { rateeId: { in: rateeIds } },
      _avg: { score: true },
    });
    for (const agg of aggregates) {
      await tx.user.update({
        where: { id: agg.rateeId },
        data: { skillScore: agg._avg.score ?? 3.0 },
      });
    }
  });

  revalidatePath(`/games/${parsed.data.gameId}/rate`);
  revalidatePath(`/games/${parsed.data.gameId}`);
  return { ok: true as const };
}
