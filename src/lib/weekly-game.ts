import { prisma } from "@/lib/db";
import { GameStatus } from "@/generated/prisma/enums";
import { sendEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";
import { env } from "@/lib/env";

/**
 * Open (or fetch) the weekly OPEN game for a given Sunday kickoff and notify the
 * squad. Idempotent on kickoff — if a game already exists for that instant it's
 * returned untouched and no notifications are sent.
 *
 * Shared by the Monday create-weekly-game cron and the Friday cancel path, which
 * rolls the game forward to the following Sunday when we're short of players.
 */
export async function openWeeklyGame(
  kickoff: Date,
): Promise<{ gameId: string; created: boolean }> {
  const existing = await prisma.game.findFirst({
    where: { kickoffAt: kickoff },
  });
  if (existing) return { gameId: existing.id, created: false };

  const game = await prisma.game.create({
    data: { kickoffAt: kickoff, status: GameStatus.OPEN },
  });

  const when = kickoff.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  });

  const users = await prisma.user.findMany({
    where: { email: { not: null }, name: { not: null } },
    select: { email: true, name: true },
  });
  await Promise.allSettled(
    users
      .filter((u): u is { email: string; name: string } => Boolean(u.email))
      .map((u) =>
        sendEmail({
          to: u.email,
          subject: `Sunday football ${when} — sign up`,
          html: `<p>Hey ${u.name ?? "there"},</p>
            <p>New game is open for Sunday. <a href="${env.appUrl}/games/${game.id}">Tap to sign up</a>.</p>
            <p>Signups close Friday 6pm — if we hit 10+ we'll lock and pick a booker.</p>`,
        }),
      ),
  );

  const everyone = await prisma.user.findMany({ select: { id: true } });
  await sendPushToUsers(
    everyone.map((u) => u.id),
    {
      title: "New game open ⚽",
      body: `Sign up for Sunday ${when}.`,
      url: `/games/${game.id}`,
    },
  );

  return { gameId: game.id, created: true };
}
