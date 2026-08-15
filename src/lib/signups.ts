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
  TEAM_SIZE,
  generateTeams,
  pickBooker,
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

/**
 * Place a single player into a game's existing teams without disturbing anyone
 * else's — the counterpart to {@link regenerateTeams}, used when an admin adds
 * someone to a BOOKED game. By then the squad has played off the team sheet and
 * the pitch is paid for, so we append rather than reshuffle (mirroring how a
 * BOOKED drop-out vacates one slot in place instead of rebalancing).
 *
 * The player joins the smallest team. Once A and B are both at TEAM_SIZE the
 * overflow belongs in C — created on demand, since a 10-player game has none.
 */
async function slotIntoTeams(tx: Tx, gameId: string, userId: string) {
  const teams = await tx.team.findMany({
    where: { gameId },
    select: { id: true, label: true, players: { select: { id: true } } },
  });
  // No team sheet yet (shouldn't happen on a BOOKED game) — nothing to slot into.
  if (teams.length === 0) return;

  const smallest = teams.reduce((a, b) =>
    b.players.length < a.players.length ? b : a,
  );
  if (smallest.players.length < TEAM_SIZE) {
    await tx.teamPlayer.create({ data: { teamId: smallest.id, userId } });
    return;
  }
  // A and B are full, so this is overflow — team C takes it.
  const teamC = teams.find((t) => t.label === TeamLabel.C);
  const target =
    teamC ?? (await tx.team.create({ data: { gameId, label: TeamLabel.C } }));
  await tx.teamPlayer.create({ data: { teamId: target.id, userId } });
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

export type JoinOptions = {
  /**
   * Let an admin add someone to a BOOKED game as well. Self-signup stops at
   * LOCKED, but an admin has to be able to put down whoever actually turns up
   * right through the week — see {@link joinGame} for what that does to teams.
   */
  adminOverride?: boolean;
};

/**
 * Add a user to a game's signup list. Returns where they landed.
 *
 * Signups are open the whole time a game is OPEN — there's no clock-based
 * cutoff. The admin locks the lineup manually, so a player can add themselves
 * (into a vacancy or the waitlist) any time before the lock. A LOCKED game also
 * still takes late joins to back-fill drop-outs: the joiner fills a freed spot
 * (slotted straight into the rebuilt teams) or lands on the waitlist.
 *
 * With `adminOverride` a BOOKED game takes additions too — the pitch is paid
 * for, but the split isn't worked out until the game is ended, so a late body
 * costs nothing to admit. The teams differ by status: LOCKED rebalances the
 * whole squad, BOOKED appends into the existing sheet ({@link slotIntoTeams})
 * because everyone has already seen it. COMPLETED/CANCELLED stay shut for
 * everyone — those games are history.
 */
export async function joinGame(
  gameId: string,
  userId: string,
  position: Position,
  { adminOverride = false }: JoinOptions = {},
): Promise<SignupResult> {
  return serializableTx(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new Error("Game not found");
    // Open while OPEN (no deadline), LOCKED to back-fill a drop-out, and BOOKED
    // only for an admin. Every other status is closed for good.
    const openStatuses: GameStatus[] = [GameStatus.OPEN, GameStatus.LOCKED];
    if (adminOverride) openStatuses.push(GameStatus.BOOKED);
    if (!openStatuses.includes(game.status)) {
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
      // Once the lineup's locked the teams already exist, so the new player has
      // to be placed into them. (OPEN games have no teams yet — they're
      // generated at lock time.) A LOCKED game is still fluid, so rebuild it to
      // keep the sides balanced; a BOOKED sheet is settled, so append in place.
      if (game.status === GameStatus.LOCKED) {
        await regenerateTeams(tx, gameId);
      } else if (game.status === GameStatus.BOOKED) {
        await slotIntoTeams(tx, gameId, userId);
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

export type AddGuestResult =
  | { kind: "ADDED" }
  | { kind: "GAME_LOCKED" }
  | { kind: "GUESTS_DISABLED" }
  | { kind: "NOT_CONFIRMED" }
  | { kind: "FULL" };

/**
 * Add a +1 guest hosted by `hostUserId`. Mirrors {@link joinGame}: allowed the
 * whole time the game is OPEN (no deadline) *and* on a LOCKED game — where the
 * new +1 fills a spot freed by a drop-out and is slotted straight into the
 * rebuilt teams. The host must be a confirmed player, guests must be enabled for
 * the game, and the squad mustn't already be full. Atomic (serializable) so the
 * cap holds under concurrent fills.
 */
export async function addGuest(
  gameId: string,
  hostUserId: string,
): Promise<AddGuestResult> {
  return serializableTx(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });
    if (!game) throw new Error("Game not found");
    // Open while OPEN (no deadline), or LOCKED to back-fill a drop-out.
    const lateJoin = game.status === GameStatus.LOCKED;
    if (game.status !== GameStatus.OPEN && !lateJoin) {
      return { kind: "GAME_LOCKED" as const };
    }
    if (!game.allowGuests) return { kind: "GUESTS_DISABLED" as const };

    const host = await tx.signup.findUnique({
      where: { gameId_userId: { gameId, userId: hostUserId } },
      select: { status: true },
    });
    if (host?.status !== SignupStatus.CONFIRMED) {
      return { kind: "NOT_CONFIRMED" as const };
    }

    // +1s occupy roster slots, so they count toward the cap alongside members.
    const confirmedCount = await tx.signup.count({
      where: { gameId, status: SignupStatus.CONFIRMED },
    });
    const guestCount = await tx.guest.count({ where: { gameId } });
    if (confirmedCount + guestCount >= MAX_PLAYERS) {
      return { kind: "FULL" as const };
    }

    await tx.guest.create({ data: { gameId, hostUserId } });
    // On a LOCKED game the teams already exist — rebuild them so the +1 is
    // slotted in and the sides stay balanced. (OPEN games have no teams yet.)
    if (lateJoin) {
      await regenerateTeams(tx, gameId);
    }
    return { kind: "ADDED" as const };
  });
}

export type RemoveGuestResult =
  | { kind: "REMOVED"; gameId: string; outcome: LeaveOutcome }
  | { kind: "NOT_FOUND" }
  | { kind: "GAME_FINISHED" };

/**
 * Remove a +1 guest from a game. Mirrors {@link leaveGame} for members —
 * guests hold a roster spot and (after lock) a team slot, so pulling one out
 * has the same knock-on effects as a member dropping:
 *  - OPEN: delete the guest and promote the first waitlister into the freed
 *    roster spot (guests count toward the cap, so a spot really did open up).
 *  - LOCKED: promote a waitlister straight into the guest's exact team slot.
 *    If nobody was waiting, the remaining squad is rebalanced into fresh
 *    teams. Falling below the minimum reverts the game to OPEN (clearing
 *    booker/duties + teams). Guests never hold duties, so there's nothing to
 *    re-pick.
 *  - BOOKED: the money's already split — just delete the guest and either
 *    hand their team slot to a promoted waitlister or leave it vacated. The
 *    booker reconciles any cash informally, same as a member drop-out.
 *  - COMPLETED / CANCELLED: refused — the game is history.
 *
 * Who may call this is the action layer's problem (host while OPEN, admin any
 * time up to completion); the engine just applies the removal atomically.
 */
export async function removeGuest(guestId: string): Promise<RemoveGuestResult> {
  return serializableTx(async (tx) => {
    const guest = await tx.guest.findUnique({
      where: { id: guestId },
      include: { game: true },
    });
    if (!guest) return { kind: "NOT_FOUND" as const };
    const game = guest.game;
    if (
      game.status === GameStatus.COMPLETED ||
      game.status === GameStatus.CANCELLED
    ) {
      return { kind: "GAME_FINISHED" as const };
    }

    // Capture the guest's team slot before the delete — the TeamPlayer row is
    // removed by FK cascade the moment the guest goes.
    const slot = await tx.teamPlayer.findFirst({
      where: { guestId, team: { gameId: game.id } },
      include: { team: { select: { id: true, label: true } } },
    });

    await tx.guest.delete({ where: { id: guestId } });

    // The guest held a roster spot, so removal frees one — pull the first
    // waitlister in, exactly as when a member drops out.
    let promotedUserId: string | null = null;
    const top = await tx.signup.findFirst({
      where: { gameId: game.id, status: SignupStatus.WAITLIST },
      orderBy: { waitlistPosition: "asc" },
    });
    if (top) {
      await tx.signup.update({
        where: { id: top.id },
        data: { status: SignupStatus.CONFIRMED, waitlistPosition: null },
      });
      promotedUserId = top.userId;
    }

    // Re-number the remaining waitlist so positions stay 1..n with no gaps.
    const remaining = await tx.signup.findMany({
      where: { gameId: game.id, status: SignupStatus.WAITLIST },
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
    let revertedToOpen = false;
    let status = game.status;

    if (game.status === GameStatus.LOCKED) {
      const confirmedCount = await tx.signup.count({
        where: { gameId: game.id, status: SignupStatus.CONFIRMED },
      });
      const guestCount = await tx.guest.count({ where: { gameId: game.id } });
      if (confirmedCount + guestCount >= MIN_PLAYERS) {
        if (promotedUserId && slot) {
          // The cascade vacated the guest's slot — hand the exact spot to the
          // promoted waitlister so everyone else's team is left untouched.
          await tx.teamPlayer.create({
            data: { teamId: slot.team.id, userId: promotedUserId },
          });
          promotedTeamLabel = slot.team.label;
        } else {
          // No one waiting (or the guest somehow had no slot) — rebalance.
          await regenerateTeams(tx, game.id);
          teamsRegenerated = true;
        }
      } else {
        // Not enough players to stay locked — reopen signups.
        await tx.team.deleteMany({ where: { gameId: game.id } });
        await tx.game.update({
          where: { id: game.id },
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
    } else if (game.status === GameStatus.BOOKED) {
      // Money's settled — no reshuffle. The guest's slot is already vacated by
      // the cascade; a promoted waitlister takes that exact spot if there was one.
      if (promotedUserId && slot) {
        await tx.teamPlayer.create({
          data: { teamId: slot.team.id, userId: promotedUserId },
        });
        promotedTeamLabel = slot.team.label;
      }
    }

    return {
      kind: "REMOVED" as const,
      gameId: game.id,
      outcome: {
        promotedUserId,
        promotedTeamLabel,
        teamsRegenerated,
        newBookerId: null,
        newBibsUserId: null,
        newFootballUserId: null,
        revertedToOpen,
        status,
      },
    };
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
 *    The dropped player always leaves their team: a promoted waitlister takes
 *    the exact spot, or it's vacated if nobody was waiting. Everyone else stays.
 *  - BOOKED: the money's already split, so don't touch booker/duties/payments —
 *    just record the drop-out and promote a waitlister (the booker reconciles
 *    any cash with them informally). As with LOCKED, the dropped player leaves
 *    their team spot — taken over by a promoted waitlister or vacated — so the
 *    team sheet reflects who's actually playing.
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
    // Keep their +1s: a guest the member brought is still expected to play, so
    // they stay on the roster (and their team slot) and the now-dropped host is
    // still billed for them at settlement — just for the +1, not for themselves.
    // Remove them with the +1 controls if the guest isn't coming either.

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
    } else if (wasConfirmed && game.status === GameStatus.BOOKED) {
      // On a BOOKED game the booking + payments are already settled, so we leave
      // the booker/duties/money untouched. But the teams were generated at lock
      // time, so the dropped player has to leave their team either way: if a
      // waitlister was promoted they take the exact spot; if nobody was waiting
      // the spot is simply vacated. Everyone else's team is left as-is — no
      // reshuffle after the money's been split.
      const slot = await tx.teamPlayer.findFirst({
        where: { userId, team: { gameId } },
        include: { team: { select: { label: true } } },
      });
      if (slot) {
        if (promotedUserId) {
          await tx.teamPlayer.update({
            where: { id: slot.id },
            data: { userId: promotedUserId },
          });
          promotedTeamLabel = slot.team.label;
        } else {
          await tx.teamPlayer.delete({ where: { id: slot.id } });
        }
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
