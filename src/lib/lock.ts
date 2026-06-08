import { prisma } from "@/lib/db";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import {
  GUEST_SKILL_SCORE,
  MIN_PLAYERS,
  generateTeams,
  pickBooker,
  type BookerCandidate,
  type DraftablePlayer,
} from "@/lib/game";
import { sendEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";
import { assignExtras } from "@/lib/duties";
import { env } from "@/lib/env";

export type LockResult =
  | {
      ok: true;
      gameId: string;
      bookerId: string;
      bibsUserId: string | null;
      footballUserId: string | null;
      teamCount: number;
    }
  | { ok: false; error: string };

/**
 * Lock a single OPEN game: fairly pick the booker, assign bibs/football duties,
 * generate balanced teams, and notify everyone (email + push). Idempotent on
 * status — only an OPEN game can be locked, so a double-click no-ops with a
 * clear error instead of re-shuffling teams or double-notifying.
 *
 * Driven by the admin "Lock game now" button on the game page.
 *
 * It does NOT cancel under-subscribed games — lockGame just refuses (returns an
 * error) when there aren't {@link MIN_PLAYERS} confirmed players, leaving the
 * admin to cancel the game instead.
 *
 * Notifications are best-effort: a flaky SMTP/push send never rolls back the
 * lock (teams are already committed in the DB).
 */
export async function lockGame(gameId: string): Promise<LockResult> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        include: {
          user: {
            select: { id: true, name: true, email: true, skillScore: true },
          },
        },
      },
      guests: { select: { id: true } },
    },
  });

  if (!game) return { ok: false, error: "Game not found" };
  if (game.status !== GameStatus.OPEN) {
    return { ok: false, error: "Game is not open — it's already locked or finished" };
  }

  const confirmed = game.signups;
  // Guests (+1s) are bodies on the pitch, so they count toward the minimum and
  // fill out the teams — even though they never do duties or get billed direct.
  const rosterCount = confirmed.length + game.guests.length;
  if (rosterCount < MIN_PLAYERS) {
    return {
      ok: false,
      error: `Need at least ${MIN_PLAYERS} players to lock (have ${rosterCount}).`,
    };
  }

  // Who in this group is exempt from duties (never picked for a chore).
  const exempt = game.groupId
    ? new Set(
        (
          await prisma.groupMember.findMany({
            where: {
              groupId: game.groupId,
              exemptFromDuties: true,
              userId: { in: confirmed.map((s) => s.user.id) },
            },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      )
    : new Set<string>();

  // Fairly pick the booker: spread the chore by past-booking history.
  const eligible = confirmed.filter((s) => !exempt.has(s.user.id));
  const bookerPool = eligible.length > 0 ? eligible : confirmed;
  // Aggregate each candidate's booking count + last-booked date in the DB
  // rather than pulling every past game and scanning in JS. Scoped to this
  // group so bookings elsewhere don't skew the rotation.
  const bookingStats = await prisma.game.groupBy({
    by: ["bookerId"],
    where: {
      groupId: game.groupId,
      bookerId: { in: bookerPool.map((s) => s.user.id) },
      status: { in: [GameStatus.BOOKED, GameStatus.COMPLETED] },
    },
    _count: { _all: true },
    _max: { kickoffAt: true },
  });
  const statByUser = new Map(bookingStats.map((s) => [s.bookerId, s]));
  const candidates: BookerCandidate[] = bookerPool.map((s) => {
    const stat = statByUser.get(s.user.id);
    return {
      userId: s.user.id,
      bookCount: stat?._count._all ?? 0,
      lastBookedAt: stat?._max.kickoffAt ?? null,
    };
  });
  const bookerId = pickBooker(candidates);
  const booker = confirmed.find((s) => s.user.id === bookerId)!.user;

  // Randomly assign who brings the bibs and the football (distinct people).
  const { bibsUserId, footballUserId } = assignExtras(
    confirmed.map((s) => ({ id: s.user.id, exempt: exempt.has(s.user.id) })),
    bookerId,
  );

  // Lock + pick booker + generate teams in a single transaction. Members carry
  // their real skill; guests slot in at the neutral default.
  const draftable: DraftablePlayer[] = [
    ...confirmed.map((s) => ({
      userId: s.user.id,
      position: s.position,
      skillScore: s.user.skillScore,
    })),
    ...game.guests.map((g) => ({
      guestId: g.id,
      skillScore: GUEST_SKILL_SCORE,
    })),
  ];
  const teams = generateTeams(draftable);

  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: game.id },
      data: {
        status: GameStatus.LOCKED,
        bookerId: booker.id,
        bibsUserId,
        footballUserId,
      },
    });
    // wipe and re-create teams (defensive)
    await tx.team.deleteMany({ where: { gameId: game.id } });
    for (const t of teams) {
      await tx.team.create({
        data: {
          gameId: game.id,
          label: t.label,
          players: {
            create: t.players.map((p) =>
              p.userId ? { userId: p.userId } : { guestId: p.guestId },
            ),
          },
        },
      });
    }
  });

  await notifyLocked(game.id, booker, confirmed, bibsUserId, footballUserId);

  return {
    ok: true,
    gameId: game.id,
    bookerId: booker.id,
    bibsUserId,
    footballUserId,
    teamCount: teams.length,
  };
}

type LockedUser = { id: string; name: string | null; email: string | null };

/** Fire the lock notifications (email + push). Best-effort; never throws. */
async function notifyLocked(
  gameId: string,
  booker: LockedUser,
  confirmed: { user: LockedUser }[],
  bibsUserId: string | null,
  footballUserId: string | null,
): Promise<void> {
  // Notify booker.
  if (booker.email) {
    await sendEmail({
      to: booker.email,
      subject: "You're booking the pitch this Sunday",
      html: `<p>Hi ${booker.name ?? "there"},</p>
        <p>You've been randomly picked to book the pitch for Sunday.</p>
        <p><a href="${env.appUrl}/games/${gameId}/book">Open the booking page</a> — it has the hireapitch.com link and a form to record the total cost. The app will generate Monzo links for everyone else.</p>`,
    }).catch(() => undefined);
  }
  // Notify others.
  await Promise.allSettled(
    confirmed
      .filter((s) => s.user.id !== booker.id && s.user.email)
      .map((s) =>
        sendEmail({
          to: s.user.email!,
          subject: "Game locked — teams are out",
          html: `<p>Sunday's lineup is locked. ${booker.name ?? "Someone"} is booking the pitch. <a href="${env.appUrl}/games/${gameId}">See your team</a>.</p>`,
        }),
      ),
  );

  // Push: booker gets the booking nudge, everyone else "teams are out".
  await sendPushToUsers([booker.id], {
    title: "You're booking Sunday ⚽",
    body: "You've been picked to book the pitch. Tap to sort it.",
    url: `/games/${gameId}/book`,
  });
  await sendPushToUsers(
    confirmed.map((s) => s.user.id).filter((id) => id !== booker.id),
    {
      title: "Teams are out!",
      body: `Lineup's locked. ${booker.name ?? "Someone"} is booking. See your team.`,
      url: `/games/${gameId}`,
    },
  );
  // Nudge whoever's on bibs / football duty.
  if (bibsUserId) {
    await sendPushToUsers([bibsUserId], {
      title: "You've got the bibs 🦺",
      body: "You're taking the bibs home this week — give them a wash and bring them back next Sunday.",
      url: `/games/${gameId}`,
    });
  }
  if (footballUserId) {
    await sendPushToUsers([footballUserId], {
      title: "You've got the football ⚽",
      body: "You're taking the ball home this week and bringing it back next Sunday.",
      url: `/games/${gameId}`,
    });
  }
}
