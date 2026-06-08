import { prisma } from "@/lib/db";
import { GameStatus } from "@/generated/prisma/enums";
import { sendEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";
import { env } from "@/lib/env";

/**
 * Open (or fetch) a group's weekly OPEN game for a given kickoff and notify that
 * group's members (and ONLY that group's members — not every user on the site).
 * Idempotent on (group, kickoff) — if a game already exists for that group at
 * that instant it's returned untouched and no notifications are sent.
 *
 * Driven by the admin "Create game" control. New games inherit the group's
 * default pitch.
 */
export async function openWeeklyGame(
  groupId: string,
  kickoff: Date,
): Promise<{ gameId: string; created: boolean }> {
  const existing = await prisma.game.findFirst({
    where: { groupId, kickoffAt: kickoff },
  });
  if (existing) return { gameId: existing.id, created: false };

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) throw new Error("Group not found");

  const game = await prisma.game.create({
    data: {
      groupId,
      kickoffAt: kickoff,
      status: GameStatus.OPEN,
      pitchName: group.defaultPitchName,
      pitchBookingUrl: group.defaultPitchBookingUrl,
    },
  });

  const when = kickoff.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: group.timezone,
  });

  // Recipients are this group's members only.
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { user: { select: { id: true, email: true, name: true } } },
  });
  const users = members.map((m) => m.user);

  await Promise.allSettled(
    users
      .filter((u): u is { id: string; email: string; name: string } =>
        Boolean(u.email && u.name),
      )
      .map((u) =>
        sendEmail({
          to: u.email,
          subject: `${group.name} — Sunday football ${when}, sign up`,
          html: `<p>Hey ${u.name ?? "there"},</p>
            <p>New game is open for ${group.name}. <a href="${env.appUrl}/games/${game.id}">Tap to sign up</a>.</p>
            <p>Sign up before the deadline — if we hit 10+ we'll lock and pick a booker.</p>`,
        }),
      ),
  );

  await sendPushToUsers(
    users.map((u) => u.id),
    {
      title: "New game open ⚽",
      body: `Sign up for ${group.name} — ${when}.`,
      url: `/games/${game.id}`,
    },
  );

  return { gameId: game.id, created: true };
}
