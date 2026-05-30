import { notFound } from "next/navigation";
import Link from "next/link";
import { Star as StarIcon, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerPill } from "@/components/player-pill";
import { getGameWithDetail } from "@/lib/games-queries";
import { requireOnboardedUser } from "@/lib/session";
import {
  GameStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import { MAX_PLAYERS, MIN_PLAYERS, isSignupOpen } from "@/lib/game";
import { SignupControls } from "./_signup-controls";
import { PaymentsPanel } from "./_payments-panel";

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireOnboardedUser();
  const game = await getGameWithDetail(id);
  if (!game) notFound();

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
  const signupsOpen = isSignupOpen(game);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          {game.kickoffAt.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {game.kickoffAt.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {" · "}
          {game.pitchName}
        </p>
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

      {game.status === GameStatus.BOOKED && isBooker && (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm">
              Pitch is booked. Share the payment links with the group.
            </p>
            <Button asChild className="mt-3" variant="outline">
              <Link href={`/games/${game.id}/book`}>View payment requests</Link>
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
              {confirmed.length}/{MAX_PLAYERS}
            </span>
          </h2>
          {confirmed.length < MIN_PLAYERS && (
            <span className="text-xs text-muted-foreground">
              {MIN_PLAYERS - confirmed.length} more needed
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
            />
          ))}
          {confirmed.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No one signed up yet — be the first.
            </p>
          )}
        </div>
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
                  <span className="text-xs text-muted-foreground">
                    #{s.waitlistPosition}
                  </span>
                }
              />
            ))}
          </div>
        </section>
      )}

      {game.teams.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Teams</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {game.teams.map((team) => (
              <Card key={team.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="font-semibold">Team {team.label}</div>
                  {team.players.map((tp) => (
                    <PlayerPill
                      key={tp.userId}
                      name={tp.user.name}
                      image={tp.user.image}
                    />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
          {game.teams.length === 3 && (
            <p className="text-xs text-muted-foreground">
              Team C rotates in against the losing team and can borrow players
              if short.
            </p>
          )}
        </section>
      )}

      {game.paymentRequests.length > 0 &&
        (mySignup?.status === SignupStatus.CONFIRMED || isBooker) && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              <Wallet className="mr-2 inline h-5 w-5" />
              Payments to {game.booker?.name ?? "the booker"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Everyone marks their own payment once they&apos;ve sent it — so we
              can all see who still owes.
            </p>
            <PaymentsPanel
              gameId={game.id}
              currentUserId={user.id}
              isBooker={isBooker}
              bookerName={game.booker?.name ?? null}
              rows={game.paymentRequests.map((p) => ({
                id: p.id,
                debtorId: p.debtorId,
                debtorName: p.debtor.name,
                amountPence: p.amountPence,
                paymentLink: p.paymentLink,
                paid: p.paidStatus === "MARKED_PAID",
              }))}
            />
          </section>
        )}
    </main>
  );
}
