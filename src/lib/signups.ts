import { serializableTx, type Tx } from "@/lib/db";
import {
  GameStatus,
  Position,
  SignupStatus,
} from "@/generated/prisma/enums";
import {
  GUEST_SKILL_SCORE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  generateTeams,
  pickBooker,
  type BookerCandidate,
} from "@/lib/game";
import { pickExtra } from "@/lib/duties";

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

/**
 * Fill every free roster slot from the waitlist (in position order), then
 * renumber whatever waitlist remains to a clean 1..n. Run this whenever a slot
 * frees up — a member drops out (possibly taking +1s with them), or a guest is
 * removed — so a freed spot always goes to the next person waiting instead of
 * being left open for the next newcomer to jump the queue. A host dropping with
 * two +1s frees three slots and promotes up to three waitlisters, not one.
 * Returns the promoted userIds (for notifications). Guests count as bodies, so
 * `freeSlots` accounts for them.
 */
export async function promoteWaitlist(
  tx: Tx,
  gameId: string,
): Promise<string[]> {
  const confirmedCount = await tx.signup.count({
    where: { gameId, status: SignupStatus.CONFIRMED },
  });
  const guestCount = await tx.guest.count({ where: { gameId } });
  const freeSlots = MAX_PLAYERS - (confirmedCount + guestCount);

  const promoted: string[] = [];
  if (freeSlots > 0) {
    const next = await tx.signup.findMany({
      where: { gameId, status: SignupStatus.WAITLIST },
      orderBy: { waitlistPosition: "asc" },
      take: freeSlots,
    });
    for (const s of next) {
      await tx.signup.update({
        where: { id: s.id },
        data: { status: SignupStatus.CONFIRMED, waitlistPosition: null },
      });
      promoted.push(s.userId);
    }
  }

  // Renumber the remaining waitlist to 1..n so positions never collide (a
  // mid-list drop-out would otherwise leave a gap the next joiner duplicates).
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
  return promoted;
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
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new Error("Game not found");
    // Signups are open the whole time the game is OPEN. There's no clock-based
    // cutoff: the admin locks the lineup manually (the old Friday-deadline was a
    // leftover from the auto-lock cron, and it wrongly slammed signups shut while
    // seats were still free). Once an admin locks (status leaves OPEN), joining
    // stops.
    if (game.status !== GameStatus.OPEN) {
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
    const waitlistCount = await tx.signup.count({
      where: { gameId, status: SignupStatus.WAITLIST },
    });

    // Confirm only if there's room AND nobody is already waiting. A non-empty
    // waitlist means every freed slot belongs to the next person in line — a
    // newcomer must queue behind them, not slip into the gap (freed slots are
    // filled via promoteWaitlist on the drop-out/guest-removal that created
    // them, so a waitlist coexisting with a free slot is only ever transient).
    if (confirmedCount + guestCount < MAX_PLAYERS && waitlistCount === 0) {
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
  /** Waitlisters promoted into the freed CONFIRMED spot(s), if any. */
  promotedUserIds: string[];
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
 *  - LOCKED: promote a waitlister, then either regenerate teams (and re-pick
 *    the booker if the leaver was the booker) when ≥10 remain, or revert the
 *    game to OPEN (clearing booker + teams) when it drops below 10.
 *  - BOOKED: the money's already split, so don't touch teams/booker/payments —
 *    just record the drop-out and promote a waitlister (the booker reconciles
 *    any cash with them informally).
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
    // No-op if there's nothing to drop, or if the game is already finished /
    // cancelled — leaveGame is a public POST endpoint, and letting someone drop
    // out of a COMPLETED game would rewrite the historical roster, delete their
    // +1s, wrongly promote a waitlister, and let a billed player dodge payment.
    if (
      !game ||
      !signup ||
      signup.status === SignupStatus.DROPPED_OUT ||
      game.status === GameStatus.COMPLETED ||
      game.status === GameStatus.CANCELLED
    ) {
      return {
        promotedUserIds: [],
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
    // Keep their +1s: a guest the member brought is still expected to play, so
    // they stay on the roster and the (now dropped-out) host is still billed for
    // them at settlement — just for the +1, not for themselves. Remove them
    // with the +1 controls if the guest isn't coming either.
    //
    // Pull the leaver out of any team they'd been drafted into, so their name
    // comes off the lineup immediately. For a LOCKED game the regen below
    // rebuilds the teams from scratch anyway; this covers the BOOKED case (no
    // regen) so a removed player never lingers on a team.
    if (wasConfirmed) {
      await tx.teamPlayer.deleteMany({ where: { userId, team: { gameId } } });
    }

    // A confirmed drop-out (plus any +1s they took) frees one or more slots —
    // promote the waitlist to fill them all before we (re)build teams below. A
    // waitlisted drop-out frees no confirmed slot, so promoteWaitlist promotes
    // nobody and just renumbers the remaining waitlist (returns []).
    const promotedUserIds = await promoteWaitlist(tx, gameId);

    let teamsRegenerated = false;
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
        await regenerateTeams(tx, gameId);
        teamsRegenerated = true;
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
      promotedUserIds,
      teamsRegenerated,
      newBookerId,
      newBibsUserId,
      newFootballUserId,
      revertedToOpen,
      status,
    };
  });
}
