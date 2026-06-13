import { prisma } from "@/lib/db";
import {
  GameStatus,
  Position,
  SignupStatus,
  TeamLabel,
} from "@/generated/prisma/enums";
import {
  GUEST_SKILL_SCORE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  generateTeams,
  pickBooker,
  signupDeadline,
  type BookerCandidate,
} from "@/lib/game";
import { pickExtra } from "@/lib/duties";
import { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Run a transaction at SERIALIZABLE isolation, retrying on Postgres
 * serialization failures (P2034). Both signup paths are read-count-then-write
 * (count CONFIRMED, then insert), so under the default READ COMMITTED two people
 * grabbing the last spot at the same time could *both* be confirmed — exceeding
 * MAX_PLAYERS — and concurrent waitlist joins could collide on the same
 * position. SERIALIZABLE makes the DB detect the conflict and we retry the loser.
 */
async function serializableTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2034" &&
        attempt < 5
      ) {
        continue;
      }
      throw e;
    }
  }
}

/** Wipe and re-create a game's teams from its current CONFIRMED signups + guests. */
async function regenerateTeams(tx: Tx, gameId: string) {
  const confirmed = await tx.signup.findMany({
    where: { gameId, status: SignupStatus.CONFIRMED },
    include: { user: { select: { id: true, skillScore: true } } },
  });
  const guests = await tx.guest.findMany({
    where: { gameId },
    select: { id: true },
  });
  const teams = generateTeams([
    ...confirmed.map((s) => ({
      userId: s.userId,
      position: s.position,
      skillScore: s.user.skillScore,
    })),
    ...guests.map((g) => ({ guestId: g.id, skillScore: GUEST_SKILL_SCORE })),
  ]);
  await tx.team.deleteMany({ where: { gameId } });
  for (const t of teams) {
    await tx.team.create({
      data: {
        gameId,
        label: t.label,
        players: {
          create: t.players.map((p) =>
            p.userId ? { userId: p.userId } : { guestId: p.guestId },
          ),
        },
      },
    });
  }
}

/** The set of userIds in a group who are exempt from duties (per GroupMember). */
async function exemptUserIds(
  tx: Tx,
  groupId: string | null,
): Promise<Set<string>> {
  if (!groupId) return new Set();
  const rows = await tx.groupMember.findMany({
    where: { groupId, exemptFromDuties: true },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

/**
 * Re-pick the booker fairly from a game's current CONFIRMED signups. Rotation is
 * scoped to the game's group — past bookings in other groups don't count.
 */
async function repickBooker(
  tx: Tx,
  gameId: string,
  groupId: string | null,
): Promise<string> {
  const confirmed = await tx.signup.findMany({
    where: { gameId, status: SignupStatus.CONFIRMED },
    select: { userId: true },
  });
  // Exempt players are quietly never picked for a duty.
  const exempt = await exemptUserIds(tx, groupId);
  const eligible = confirmed.filter((s) => !exempt.has(s.userId));
  const pool = eligible.length > 0 ? eligible : confirmed;
  const ids = pool.map((s) => s.userId);
  const pastBookings = await tx.game.findMany({
    where: {
      groupId,
      bookerId: { in: ids },
      status: { in: [GameStatus.BOOKED, GameStatus.COMPLETED] },
    },
    select: { bookerId: true, kickoffAt: true },
  });
  const candidates: BookerCandidate[] = ids.map((userId) => {
    const theirs = pastBookings.filter((g) => g.bookerId === userId);
    const lastBookedAt = theirs.reduce<Date | null>(
      (latest, g) =>
        latest === null || g.kickoffAt > latest ? g.kickoffAt : latest,
      null,
    );
    return { userId, bookCount: theirs.length, lastBookedAt };
  });
  return pickBooker(candidates);
}

export type SignupResult =
  | { kind: "CONFIRMED" }
  | { kind: "WAITLIST"; position: number }
  | { kind: "GAME_LOCKED" }
  | { kind: "GAME_FULL_NO_WAITLIST" };

/** Add a user to a game's signup list. Returns where they landed. */
export async function joinGame(
  gameId: string,
  userId: string,
  position: Position,
): Promise<SignupResult> {
  return serializableTx(async (tx) => {
    const game = await tx.game.findUnique({
      where: { id: gameId },
      include: { group: { select: { lockOffsetHours: true } } },
    });
    if (!game) throw new Error("Game not found");
    // Closed once the game leaves OPEN *or* the group's signup deadline passes —
    // the deadline gates signups even before an admin locks the lineup.
    if (
      game.status !== GameStatus.OPEN ||
      new Date() >= signupDeadline(game.kickoffAt, game.group?.lockOffsetHours)
    ) {
      return { kind: "GAME_LOCKED" as const };
    }

    const existing = await tx.signup.findUnique({
      where: { gameId_userId: { gameId, userId } },
    });
    if (existing && existing.status !== SignupStatus.DROPPED_OUT) {
      // Update position only; idempotent rejoin
      await tx.signup.update({
        where: { id: existing.id },
        data: { position },
      });
      return existing.status === SignupStatus.CONFIRMED
        ? { kind: "CONFIRMED" as const }
        : {
            kind: "WAITLIST" as const,
            position: existing.waitlistPosition ?? 0,
          };
    }

    const confirmedCount = await tx.signup.count({
      where: { gameId, status: SignupStatus.CONFIRMED },
    });
    // +1 guests occupy roster slots too, so they count toward the cap. This
    // keeps the squad at MAX_PLAYERS total and sends a late member to the
    // waitlist rather than ever bumping a guest who's already in.
    const guestCount = await tx.guest.count({ where: { gameId } });

    if (confirmedCount + guestCount < MAX_PLAYERS) {
      if (existing) {
        await tx.signup.update({
          where: { id: existing.id },
          data: {
            status: SignupStatus.CONFIRMED,
            position,
            waitlistPosition: null,
            signedUpAt: new Date(),
          },
        });
      } else {
        await tx.signup.create({
          data: {
            gameId,
            userId,
            position,
            status: SignupStatus.CONFIRMED,
          },
        });
      }
      return { kind: "CONFIRMED" as const };
    }

    const waitlistCount = await tx.signup.count({
      where: { gameId, status: SignupStatus.WAITLIST },
    });
    const nextWaitlist = waitlistCount + 1;
    if (existing) {
      await tx.signup.update({
        where: { id: existing.id },
        data: {
          status: SignupStatus.WAITLIST,
          position,
          waitlistPosition: nextWaitlist,
          signedUpAt: new Date(),
        },
      });
    } else {
      await tx.signup.create({
        data: {
          gameId,
          userId,
          position,
          status: SignupStatus.WAITLIST,
          waitlistPosition: nextWaitlist,
        },
      });
    }
    return { kind: "WAITLIST" as const, position: nextWaitlist };
  });
}

export type LeaveOutcome = {
  /** Waitlister promoted into the freed CONFIRMED spot, if any. */
  promotedUserId: string | null;
  /**
   * The team the promoted waitlister was slotted straight into — i.e. the team
   * the dropped player held on a LOCKED game. Null when there were no teams yet
   * (OPEN game) or no one was promoted.
   */
  promotedTeamLabel: TeamLabel | null;
  /** Teams were wiped + rebuilt (happens for LOCKED games still ≥10). */
  teamsRegenerated: boolean;
  /** New booker chosen because the booker dropped out (LOCKED only). */
  newBookerId: string | null;
  /** New bibs-bringer chosen because the previous one dropped out. */
  newBibsUserId: string | null;
  /** New football-bringer chosen because the previous one dropped out. */
  newFootballUserId: string | null;
  /** Game fell below the minimum and was reopened for signups. */
  revertedToOpen: boolean;
  /** Resulting game status after the drop-out. */
  status: GameStatus;
};

/**
 * Drop a user out of a game. Behaviour depends on the game's status:
 *  - OPEN: promote the first waitlister (as before); nothing else to do.
 *  - LOCKED: promote a waitlister, then re-pick any duty (booker/bibs/football)
 *    whose holder dropped. If a waitlister was promoted they slot straight into
 *    the dropped player's exact team — everyone else's team is left untouched.
 *    If no one was waiting, the remaining squad is rebalanced into fresh teams.
 *    Dropping below the minimum reverts the game to OPEN (clearing booker +
 *    teams).
 *  - BOOKED: the money's already split, so don't touch teams/booker/payments —
 *    just record the drop-out and promote a waitlister (the booker reconciles
 *    any cash with them informally).
 *  - COMPLETED / CANCELLED: the game's already done, so just record the
 *    drop-out — nobody is promoted into a finished game.
 *
 * Works the same whether a player drops themselves or an admin removes them.
 */
export async function leaveGame(
  gameId: string,
  userId: string,
): Promise<LeaveOutcome> {
  return serializableTx(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    const signup = await tx.signup.findUnique({
      where: { gameId_userId: { gameId, userId } },
    });
    if (!game || !signup || signup.status === SignupStatus.DROPPED_OUT) {
      return {
        promotedUserId: null,
        promotedTeamLabel: null,
        teamsRegenerated: false,
        newBookerId: null,
        newBibsUserId: null,
        newFootballUserId: null,
        revertedToOpen: false,
        status: game?.status ?? GameStatus.OPEN,
      };
    }

    const wasConfirmed = signup.status === SignupStatus.CONFIRMED;
    await tx.signup.update({
      where: { id: signup.id },
      data: { status: SignupStatus.DROPPED_OUT, waitlistPosition: null },
    });
    // A dropping member takes their +1s with them — a guest with no host present
    // makes no sense, and they shouldn't keep propping up the head count.
    await tx.guest.deleteMany({ where: { gameId, hostUserId: userId } });

    // Only fill the freed spot from the waitlist while the game is still live —
    // never promote someone into a finished (COMPLETED/CANCELLED) game.
    const canPromote =
      wasConfirmed &&
      (game.status === GameStatus.OPEN ||
        game.status === GameStatus.LOCKED ||
        game.status === GameStatus.BOOKED);

    let promotedUserId: string | null = null;
    if (canPromote) {
      const top = await tx.signup.findFirst({
        where: { gameId, status: SignupStatus.WAITLIST },
        orderBy: { waitlistPosition: "asc" },
      });
      if (top) {
        await tx.signup.update({
          where: { id: top.id },
          data: { status: SignupStatus.CONFIRMED, waitlistPosition: null },
        });
        promotedUserId = top.userId;
      }
    }

    // Re-number the remaining waitlist after the drop — whether we pulled #1 off
    // it (a promotion) or removed a waitlister outright — so positions stay 1..n
    // with no gaps.
    const remaining = await tx.signup.findMany({
      where: { gameId, status: SignupStatus.WAITLIST },
      orderBy: { waitlistPosition: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].waitlistPosition !== i + 1) {
        await tx.signup.update({
          where: { id: remaining[i].id },
          data: { waitlistPosition: i + 1 },
        });
      }
    }

    let teamsRegenerated = false;
    let promotedTeamLabel: TeamLabel | null = null;
    let newBookerId: string | null = null;
    let newBibsUserId: string | null = null;
    let newFootballUserId: string | null = null;
    let revertedToOpen = false;
    let status = game.status;

    // Only a confirmed drop-out on a LOCKED game changes the lineup/duties.
    if (wasConfirmed && game.status === GameStatus.LOCKED) {
      const confirmed = await tx.signup.findMany({
        where: { gameId, status: SignupStatus.CONFIRMED },
        select: { userId: true },
      });
      const guestCount = await tx.guest.count({ where: { gameId } });
      // Guests still count toward the roster, so a game stays locked as long as
      // members + guests clear the minimum.
      if (confirmed.length + guestCount >= MIN_PLAYERS) {
        const stillIn = new Set(confirmed.map((s) => s.userId));
        const exempt = await exemptUserIds(tx, game.groupId);
        const dutyPlayers = confirmed.map((s) => ({
          id: s.userId,
          exempt: exempt.has(s.userId),
        }));

        // Re-pick any duty whose holder has dropped out.
        let bookerId = game.bookerId;
        if (!bookerId || !stillIn.has(bookerId)) {
          bookerId = await repickBooker(tx, gameId, game.groupId);
          newBookerId = bookerId;
        }
        let bibsId = game.bibsUserId;
        if (!bibsId || !stillIn.has(bibsId)) {
          bibsId = pickExtra(dutyPlayers, [bookerId, game.footballUserId]);
          newBibsUserId = bibsId;
        }
        let footballId = game.footballUserId;
        if (!footballId || !stillIn.has(footballId)) {
          footballId = pickExtra(dutyPlayers, [bookerId, bibsId]);
          newFootballUserId = footballId;
        }

        await tx.game.update({
          where: { id: gameId },
          data: {
            bookerId,
            bibsUserId: bibsId,
            footballUserId: footballId,
          },
        });

        if (promotedUserId) {
          // Slot the promoted waitlister straight into the dropped player's
          // existing team spot. The teams were already generated at lock time
          // and the rest of the squad has seen them, so we swap one slot in
          // place rather than re-shuffling everyone.
          const slot = await tx.teamPlayer.findFirst({
            where: { userId, team: { gameId } },
            include: { team: { select: { label: true } } },
          });
          if (slot) {
            await tx.teamPlayer.update({
              where: { id: slot.id },
              data: { userId: promotedUserId },
            });
            promotedTeamLabel = slot.team.label;
          } else {
            // Defensive: the dropped player somehow had no team slot — fall back
            // to a full rebuild so the promoted player is still placed.
            await regenerateTeams(tx, gameId);
            teamsRegenerated = true;
          }
        } else {
          // No one waiting to take the spot — rebalance the remaining squad.
          await regenerateTeams(tx, gameId);
          teamsRegenerated = true;
        }
      } else {
        // Not enough players to lock anymore — reopen signups.
        await tx.team.deleteMany({ where: { gameId } });
        await tx.game.update({
          where: { id: gameId },
          data: {
            status: GameStatus.OPEN,
            bookerId: null,
            bibsUserId: null,
            footballUserId: null,
          },
        });
        revertedToOpen = true;
        status = GameStatus.OPEN;
      }
    }

    return {
      promotedUserId,
      promotedTeamLabel,
      teamsRegenerated,
      newBookerId,
      newBibsUserId,
      newFootballUserId,
      revertedToOpen,
      status,
    };
  });
}
