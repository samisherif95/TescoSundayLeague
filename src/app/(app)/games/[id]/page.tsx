import { notFound } from "next/navigation";
import Link from "next/link";
import { Star as StarIcon, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerPill } from "@/components/player-pill";
import { getGameWithDetail } from "@/lib/games-queries";
import { requireOnboardedUser, requireGroupMember } from "@/lib/session";
import {
  GameStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  isSignupOpen,
  londonInputValue,
} from "@/lib/game";
import { deriveScore } from "@/lib/match";
import {
  SignupControls,
  DropOutCard,
  RemovePlayerButton,
} from "./_signup-controls";
import { PaymentsPanel } from "./_payments-panel";
import { MatchDay } from "./_match-day";
import { TeamsEditor } from "./_teams-editor";
import { GameDetailsLine } from "./_details-editor";
import { AdminLockCard } from "./_admin-lock";
import { AdminEndCard } from "./_admin-end";
import { AdminCancelCard } from "./_admin-cancel";
import { DutiesEditor } from "./_duties-editor";
import {
  AddGuestButton,
  AllowGuestsToggle,
  RemoveGuestButton,
} from "./_guest-controls";

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, game] = await Promise.all([
    requireOnboardedUser(),
    getGameWithDetail(id),
  ]);
  if (!game) notFound();
  // You can only see a game in a group you belong to — guessing an id from
  // another group 404s. `isAdmin` here means admin OF THIS GAME'S GROUP.
  const membership = await requireGroupMember(game.groupId);
  const isAdmin = membership.role === "ADMIN";

  const confirmed = game.signups.filter(
    (s) => s.status === SignupStatus.CONFIRMED,
  );
  const waitlist = game.signups
    .filter((s) => s.status === SignupStatus.WAITLIST)
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

  const mySignup = game.signups.find(
    (s) => s.userId === user.id && s.status !== SignupStatus.DROPPED_OUT,
  );
  const isBooker = game.bookerId === user.id;
  const signupsOpen = isSignupOpen(game, game.group?.lockOffsetHours);

  // +1 guests count as bodies on the pitch, so the roster (and "more needed")
  // is members + guests.
  const guests = game.guests;
  const rosterCount = confirmed.length + guests.length;
  const amConfirmed = mySignup?.status === SignupStatus.CONFIRMED;
  const canAddGuest =
    game.status === GameStatus.OPEN &&
    signupsOpen &&
    game.allowGuests &&
    amConfirmed &&
    rosterCount < MAX_PLAYERS;
  // How many +1s each member brought — used to label their payment row.
  const guestCountByHost = new Map<string, number>();
  for (const g of guests) {
    guestCountByHost.set(
      g.hostUserId,
      (guestCountByHost.get(g.hostUserId) ?? 0) + 1,
    );
  }

  // Anyone playing that Sunday can run the timer and record matches.
  const canRecord =
    isAdmin ||
    isBooker ||
    mySignup?.status === SignupStatus.CONFIRMED;

  // Same crowd can tweak the kickoff time / location, until the game's done.
  const canEditDetails =
    canRecord &&
    game.status !== GameStatus.COMPLETED &&
    game.status !== GameStatus.CANCELLED;

  const showMatchDay =
    game.teams.length >= 2 &&
    (game.status === GameStatus.BOOKED ||
      game.status === GameStatus.COMPLETED);
  // New matches can only be kicked off during the live window (BOOKED). Once
  // the game's ended the match section stays visible as a read-only results
  // history — you can't start fresh matches against a finished game.
  const canStartMatch = game.status === GameStatus.BOOKED;

  // Match recording only names real members as scorers — guests have no
  // account to attribute to (their goals are still counted for the team, just
  // without a named scorer), so they're filtered out of the scorer lists.
  const matchTeams = game.teams.map((t) => ({
    id: t.id,
    label: t.label,
    players: t.players
      .filter((tp) => tp.user !== null)
      .map((tp) => ({
        userId: tp.user!.id,
        name: tp.user!.name,
      })),
  }));

  const teamsData = game.teams.map((t) => ({
    id: t.id,
    label: t.label,
    players: t.players.map((tp) =>
      tp.guest
        ? {
            id: tp.id,
            name: `${tp.guest.host.name ?? "Someone"} +1`,
            image: null,
            isGuest: true,
          }
        : {
            id: tp.id,
            name: tp.user!.name,
            image: tp.user!.image,
          },
    ),
  }));

  const matchesData = game.matches.map((m) => {
    const score = deriveScore(m.goals, m.homeTeamId, m.awayTeamId);
    return {
      id: m.id,
      order: m.order,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeLabel: m.homeTeam.label,
      awayLabel: m.awayTeam.label,
      status: m.status,
      phase: m.phase,
      periodStartedAt: m.periodStartedAt
        ? m.periodStartedAt.getTime()
        : null,
      accumulatedMs: m.accumulatedMs,
      homeScore: score.home,
      awayScore: score.away,
      homePenalties: m.homePenalties,
      awayPenalties: m.awayPenalties,
      winnerTeamId: m.winnerTeamId,
      goals: m.goals.map((g) => ({
        id: g.id,
        teamId: g.teamId,
        scorerId: g.scorerId,
        scorerName: g.scorer?.name ?? null,
        phase: g.phase,
        isOwnGoal: g.isOwnGoal,
        clockMs: g.clockMs,
      })),
    };
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          {game.kickoffAt.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "Europe/London",
          })}
        </h1>
        <GameDetailsLine
          gameId={game.id}
          editable={canEditDetails}
          timeLabel={game.kickoffAt.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/London",
          })}
          pitchName={game.pitchName}
          pitchBookingUrl={game.pitchBookingUrl}
          kickoffLocal={londonInputValue(game.kickoffAt)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="outline">{game.status}</Badge>
          {game.bookerId && (
            <Badge variant="outline">
              Booker: {game.booker?.name ?? "—"}
            </Badge>
          )}
          {game.bibsBringer && (
            <Badge variant="outline">🦺 Bibs: {game.bibsBringer.name}</Badge>
          )}
          {game.footballBringer && (
            <Badge variant="outline">
              ⚽ Football: {game.footballBringer.name}
            </Badge>
          )}
        </div>
      </section>

      {isAdmin &&
        (game.status === GameStatus.LOCKED ||
          game.status === GameStatus.BOOKED) && (
          <DutiesEditor
            gameId={game.id}
            players={confirmed.map((s) => ({
              id: s.user.id,
              name: s.user.name,
            }))}
            bookerId={game.bookerId}
            bibsUserId={game.bibsBringer?.id ?? null}
            footballUserId={game.footballBringer?.id ?? null}
          />
        )}

      {isAdmin &&
        (game.status === GameStatus.LOCKED ||
          game.status === GameStatus.BOOKED) && (
          <AdminEndCard gameId={game.id} />
        )}

      {isAdmin &&
        (game.status === GameStatus.OPEN ||
          game.status === GameStatus.LOCKED ||
          game.status === GameStatus.BOOKED) && (
          <AdminCancelCard gameId={game.id} />
        )}

      {game.status === GameStatus.OPEN && signupsOpen && (
        <SignupControls
          gameId={game.id}
          mySignup={
            mySignup && mySignup.status !== SignupStatus.DROPPED_OUT
              ? {
                  status: mySignup.status as "CONFIRMED" | "WAITLIST",
                  position: mySignup.position,
                  waitlistPosition: mySignup.waitlistPosition,
                }
              : null
          }
          preferredPosition={user.preferredPosition ?? null}
          confirmedCount={confirmed.length}
          maxPlayers={MAX_PLAYERS}
        />
      )}

      {game.status === GameStatus.OPEN && !signupsOpen && (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm">
              Signups have closed for this game — the lineup is being locked in.
              Check back shortly for teams.
            </p>
          </CardContent>
        </Card>
      )}

      {game.status === GameStatus.OPEN && isAdmin && (
        <AdminLockCard
          gameId={game.id}
          confirmedCount={rosterCount}
          minPlayers={MIN_PLAYERS}
        />
      )}

      {game.status === GameStatus.OPEN && isAdmin && (
        <AllowGuestsToggle gameId={game.id} allow={game.allowGuests} />
      )}

      {game.status === GameStatus.BOOKED && isBooker && (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm">
              Pitch is booked and the cost is recorded. Payment links go out to
              the squad once an admin ends the game — so any no-shows can be
              dropped first and the split stays correct.
            </p>
            <Button asChild className="mt-3" variant="outline">
              <Link href={`/games/${game.id}/book`}>Edit the pitch cost</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {game.status === GameStatus.LOCKED && isBooker && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-3 p-5">
            <p className="font-semibold">You&apos;re booking this week.</p>
            <p className="text-sm text-muted-foreground">
              Head to the booking page to grab the pitch link and enter the
              total cost once it&apos;s booked.
            </p>
            <Button asChild>
              <Link href={`/games/${game.id}/book`}>Open booking page</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {game.status === GameStatus.LOCKED && amConfirmed && (
        <DropOutCard gameId={game.id} />
      )}

      {game.status === GameStatus.COMPLETED && mySignup && (
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="font-semibold">Rate your teammates</p>
              <p className="text-sm text-muted-foreground">
                Open for 48 hours after kickoff. Anonymous.
              </p>
            </div>
            <Button asChild>
              <Link href={`/games/${game.id}/rate`}>
                <StarIcon className="mr-2 h-4 w-4" /> Rate
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">
            Confirmed
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {rosterCount}/{MAX_PLAYERS}
            </span>
          </h2>
          {rosterCount < MIN_PLAYERS && (
            <span className="text-xs text-muted-foreground">
              {MIN_PLAYERS - rosterCount} more needed
            </span>
          )}
        </header>
        <div className="grid gap-2 sm:grid-cols-2">
          {confirmed.map((s) => (
            <PlayerPill
              key={s.id}
              name={s.user.name}
              image={s.user.image}
              position={s.position}
              trailing={
                isAdmin && s.user.id !== user.id ? (
                  <RemovePlayerButton
                    gameId={game.id}
                    userId={s.user.id}
                    name={s.user.name}
                  />
                ) : undefined
              }
            />
          ))}
          {guests.map((g) => (
            <PlayerPill
              key={g.id}
              name={`${g.host.name ?? "Someone"} +1`}
              trailing={
                g.hostUserId === user.id || isAdmin ? (
                  <RemoveGuestButton guestId={g.id} />
                ) : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    +1
                  </span>
                )
              }
            />
          ))}
          {rosterCount === 0 && (
            <p className="text-sm text-muted-foreground">
              No one signed up yet — be the first.
            </p>
          )}
        </div>
        {canAddGuest && <AddGuestButton gameId={game.id} />}
      </section>

      {waitlist.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Waitlist</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {waitlist.map((s) => (
              <PlayerPill
                key={s.id}
                name={s.user.name}
                image={s.user.image}
                position={s.position}
                trailing={
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      #{s.waitlistPosition}
                    </span>
                    {isAdmin && (
                      <RemovePlayerButton
                        gameId={game.id}
                        userId={s.user.id}
                        name={s.user.name}
                      />
                    )}
                  </span>
                }
              />
            ))}
          </div>
        </section>
      )}

      {game.teams.length > 0 && (
        <TeamsEditor
          gameId={game.id}
          teams={teamsData}
          editable={isAdmin}
        />
      )}

      {showMatchDay && (
        <MatchDay
          gameId={game.id}
          canRecord={canRecord}
          canStartMatch={canStartMatch}
          teams={matchTeams}
          matches={matchesData}
          // Per-request server time, so each device can correct for clock drift
          // and show the same synced countdown.
          // eslint-disable-next-line react-hooks/purity
          serverNow={Date.now()}
        />
      )}

      {game.status === GameStatus.COMPLETED &&
        game.paymentRequests.length > 0 &&
        (mySignup?.status === SignupStatus.CONFIRMED ||
          isBooker ||
          isAdmin) && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              <Wallet className="mr-2 inline h-5 w-5" />
              Payments to {game.booker?.name ?? "the booker"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Everyone marks their own payment once they&apos;ve sent it — so we
              can all see who still owes.
              {isBooker && (
                <>
                  {" "}
                  Wrong total?{" "}
                  <Link
                    href={`/games/${game.id}/book`}
                    className="underline underline-offset-2"
                  >
                    Edit the pitch cost
                  </Link>
                  .
                </>
              )}
            </p>
            <PaymentsPanel
              gameId={game.id}
              currentUserId={user.id}
              isBooker={isBooker}
              isAdmin={isAdmin}
              bookerName={game.booker?.name ?? null}
              rows={game.paymentRequests.map((p) => ({
                id: p.id,
                debtorId: p.debtorId,
                debtorName: p.debtor.name,
                amountPence: p.amountPence,
                paymentLink: p.paymentLink,
                paid: p.paidStatus === "MARKED_PAID",
                guestCount: guestCountByHost.get(p.debtorId) ?? 0,
              }))}
            />
          </section>
        )}

      {game.status === GameStatus.COMPLETED &&
        game.paymentRequests.length === 0 &&
        isBooker && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="space-y-3 p-5">
              <p className="font-semibold">Enter the pitch cost</p>
              <p className="text-sm text-muted-foreground">
                The game&apos;s ended but the cost isn&apos;t in yet, so no
                payment links have gone out. Add it and the split is generated
                for the squad.
              </p>
              <Button asChild>
                <Link href={`/games/${game.id}/book`}>Enter pitch cost</Link>
              </Button>
            </CardContent>
          </Card>
        )}
    </main>
  );
}
