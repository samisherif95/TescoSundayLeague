import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  Clock,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentGame } from "@/lib/games-queries";
import { requireOnboardedUser } from "@/lib/session";
import { GameStatus, Position, SignupStatus } from "@/generated/prisma/enums";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  LONDON_TZ,
  isSignupOpen,
  signupDeadline,
} from "@/lib/game";

const STATUS_META: Record<
  GameStatus,
  { label: string; tone: string; helper: string }
> = {
  OPEN: {
    label: "Signups open",
    tone: "border-primary/30 bg-primary/10 text-primary",
    helper: "Sign up below — closes Friday 18:00.",
  },
  LOCKED: {
    label: "Locked · booking",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    helper: "Booker has been picked. Pitch about to be booked.",
  },
  BOOKED: {
    label: "Pitch booked",
    tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    helper: "Pay the booker via the Monzo links below.",
  },
  COMPLETED: {
    label: "Completed",
    tone: "border-muted text-muted-foreground bg-muted/50",
    helper: "Rate your teammates within 48 hours.",
  },
  CANCELLED: {
    label: "Cancelled",
    tone: "border-destructive/30 bg-destructive/10 text-destructive",
    helper: "Not enough players this week.",
  },
};

export default async function HomePage() {
  // Independent queries — run them together rather than waterfalling.
  const [user, game] = await Promise.all([
    requireOnboardedUser(),
    getCurrentGame(),
  ]);

  if (!game) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState isAdmin={user.isAdmin} />
      </main>
    );
  }

  const confirmed = game.signups.filter(
    (s) => s.status === SignupStatus.CONFIRMED,
  );
  const waitlist = game.signups.filter(
    (s) => s.status === SignupStatus.WAITLIST,
  );
  const mySignup = game.signups.find((s) => s.userId === user.id);
  const meta = STATUS_META[game.status];
  const positions = countPositions(confirmed);
  // +1 guests are bodies on the pitch too, so they count toward the roster
  // (and how many more we still need to lock).
  const rosterCount = confirmed.length + game.guests.length;
  const needed = Math.max(0, MIN_PLAYERS - rosterCount);

  // For an OPEN game, signups can be closed by the clock before the cron has
  // flipped the status — reflect that honestly instead of the static copy.
  const signupsOpen = isSignupOpen(game);
  const label =
    game.status === GameStatus.OPEN && !signupsOpen
      ? "Signups closed"
      : meta.label;
  const helper =
    game.status === GameStatus.OPEN
      ? signupsOpen
        ? `Sign up below — closes ${formatDeadline(signupDeadline(game.kickoffAt))}.`
        : "Signups have closed — locking the lineup shortly."
      : meta.helper;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Hey {user.name?.split(" ")[0] ?? "there"}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          This Sunday
        </h1>
      </header>

      <Card className="overflow-hidden border-primary/15 p-0">
        <div className="relative bg-pitch-grid">
          <div className="relative bg-gradient-to-b from-primary/10 to-transparent p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  {game.kickoffAt.toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    timeZone: "Europe/London",
                  })}
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-4" />
                    {game.kickoffAt.toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/London",
                    })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="size-4" />
                    {game.pitchName}
                  </div>
                </dl>
              </div>
              <Badge variant="outline" className={meta.tone}>
                {label}
              </Badge>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              <Stat
                label="Confirmed"
                value={`${rosterCount}`}
                sub={
                  game.guests.length > 0
                    ? `/ ${MAX_PLAYERS} · incl. ${game.guests.length} +1`
                    : `/ ${MAX_PLAYERS}`
                }
              />
              <Stat label="Waitlist" value={`${waitlist.length}`} />
              <Stat
                label={needed > 0 ? "Need" : "Status"}
                value={needed > 0 ? `${needed}` : "Ready"}
                sub={needed > 0 ? "more" : undefined}
                accent={needed === 0}
              />
            </div>

            <Progress
              current={rosterCount}
              min={MIN_PLAYERS}
              max={MAX_PLAYERS}
            />
            <p className="mt-3 text-xs text-muted-foreground">{helper}</p>
          </div>
        </div>

        <CardContent className="space-y-5 border-t bg-card p-6 sm:p-7">
          {mySignup && mySignup.status !== SignupStatus.DROPPED_OUT ? (
            <YourStatus
              status={mySignup.status as "CONFIRMED" | "WAITLIST"}
              waitlistPosition={mySignup.waitlistPosition}
              position={mySignup.position}
            />
          ) : (
            <NotIn />
          )}

          <PositionsBreakdown positions={positions} />

          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href={`/games/${game.id}`}>
              Open game <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-background/70 px-3 py-3 backdrop-blur">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline justify-center gap-1">
        <span
          className={`font-display text-2xl font-bold tabular ${accent ? "text-primary" : ""}`}
        >
          {value}
        </span>
        {sub && (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function Progress({
  current,
  min,
  max,
}: {
  current: number;
  min: number;
  max: number;
}) {
  const pct = Math.min(100, (current / max) * 100);
  const minPct = (min / max) * 100;
  return (
    <div className="mt-5">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
        <div
          aria-hidden
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground/40"
          style={{ left: `${minPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>0</span>
        <span>{min} to lock</span>
        <span>{max} max</span>
      </div>
    </div>
  );
}

function YourStatus({
  status,
  waitlistPosition,
  position,
}: {
  status: "CONFIRMED" | "WAITLIST";
  waitlistPosition: number | null;
  position: Position;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="inline-flex size-10 items-center justify-center rounded-full bg-primary/20 text-primary">
        <Sparkles className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {status === "CONFIRMED"
            ? "You're in for Sunday."
            : `You're #${waitlistPosition} on the waitlist.`}
        </div>
        <div className="text-xs text-muted-foreground">
          Playing as {position}
        </div>
      </div>
    </div>
  );
}

function NotIn() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed p-4">
      <div className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CircleAlert className="size-5" />
      </div>
      <div className="text-sm">
        <div className="font-medium">You haven&apos;t signed up yet.</div>
        <div className="text-muted-foreground">
          Open the game to pick your position.
        </div>
      </div>
    </div>
  );
}

function PositionsBreakdown({
  positions,
}: {
  positions: Record<Position, number>;
}) {
  const entries: Array<[Position, string, string]> = [
    [Position.DEF, "DEF", "bg-sky-500/15 text-sky-700 dark:text-sky-300"],
    [
      Position.MID,
      "MID",
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    ],
    [Position.FWD, "FWD", "bg-rose-500/15 text-rose-700 dark:text-rose-300"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        Positions
      </span>
      {entries.map(([key, label, tone]) => (
        <span
          key={key}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
        >
          {label}
          <span className="tabular">{positions[key] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}

/** e.g. "Fri 30 May, 18:00" in London time. */
function formatDeadline(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: LONDON_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function countPositions(
  signups: { position: Position }[],
): Record<Position, number> {
  const out: Record<Position, number> = { DEF: 0, MID: 0, FWD: 0 };
  for (const s of signups) out[s.position]++;
  return out;
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="rounded-2xl border bg-card p-10 text-center">
      <div className="mx-auto mb-5 inline-flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <CalendarDays className="size-6" />
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">
        No game yet this week
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        A new game is auto-created every Monday at 09:00.
      </p>
      {isAdmin && (
        <Button asChild className="mt-6">
          <Link href="/admin">Create one now</Link>
        </Button>
      )}
    </div>
  );
}
