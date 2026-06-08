"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Pause,
  Play,
  Plus,
  Trophy,
  Undo2,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  GOAL_TARGET,
  GOLDEN_GOAL_MS,
  REGULATION_MS,
  elapsedMs,
  formatClock,
} from "@/lib/match";
import {
  createMatchAction,
  pauseMatchAction,
  resumeMatchAction,
  logGoalAction,
  removeGoalAction,
  endMatchNowAction,
  startGoldenGoalAction,
  startPenaltiesAction,
  recordPenaltiesAction,
  deleteMatchAction,
} from "./match-actions";

type Phase = "REGULAR" | "GOLDEN_GOAL" | "PENALTIES";
type Status = "LIVE" | "PAUSED" | "COMPLETED";

export type MatchTeam = {
  id: string;
  label: "A" | "B" | "C";
  players: { userId: string; name: string | null }[];
};

export type MatchGoal = {
  id: string;
  teamId: string;
  scorerId: string | null;
  scorerName: string | null;
  phase: Phase;
  isOwnGoal: boolean;
  clockMs: number;
};

export type SerializedMatch = {
  id: string;
  order: number;
  homeTeamId: string;
  awayTeamId: string;
  homeLabel: "A" | "B" | "C";
  awayLabel: "A" | "B" | "C";
  status: Status;
  phase: Phase;
  periodStartedAt: number | null;
  accumulatedMs: number;
  homeScore: number;
  awayScore: number;
  homePenalties: number;
  awayPenalties: number;
  winnerTeamId: string | null;
  goals: MatchGoal[];
};

const TEAM_DOT: Record<"A" | "B" | "C", string> = {
  A: "bg-sky-500",
  B: "bg-rose-500",
  C: "bg-amber-500",
};

function phaseLimit(phase: Phase): number | null {
  if (phase === "REGULAR") return REGULATION_MS;
  if (phase === "GOLDEN_GOAL") return GOLDEN_GOAL_MS;
  return null;
}

/** Ticks ~4x/sec while `running`, returning the clock-corrected "now" (ms). */
function useNow(running: boolean, offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now() + offsetMs), 250);
    return () => clearInterval(id);
  }, [running, offsetMs]);
  return now;
}

export function MatchDay({
  gameId,
  canRecord,
  canStartMatch,
  teams,
  matches,
  serverNow,
}: {
  gameId: string;
  canRecord: boolean;
  canStartMatch: boolean;
  teams: MatchTeam[];
  matches: SerializedMatch[];
  serverNow: number;
}) {
  const router = useRouter();
  // Correct for drift between this device's clock and the server's.
  const [clockOffset] = useState(() => serverNow - Date.now());

  const active = matches.find((m) => m.status !== "COMPLETED") ?? null;
  const history = matches.filter((m) => m.status === "COMPLETED");

  // Poll for other people's updates while a match is in progress.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [active, router]);

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Match day</h2>
        <span className="text-sm text-muted-foreground">
          {history.length} played
        </span>
      </header>

      {active ? (
        <ActiveMatch
          match={active}
          teams={teams}
          canRecord={canRecord}
          clockOffset={clockOffset}
        />
      ) : teams.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Teams need to be set before you can record matches.
        </p>
      ) : !canStartMatch ? (
        // Game's over — show the results history below, but no new matches.
        history.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No matches were recorded.
          </p>
        )
      ) : canRecord ? (
        <NewMatch gameId={gameId} teams={teams} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No match in progress.
        </p>
      )}

      {history.length > 0 && (
        <div className="space-y-3">
          {history.map((m) => (
            <CompletedMatch key={m.id} match={m} canRecord={canRecord} />
          ))}
        </div>
      )}
    </section>
  );
}

function TeamName({
  label,
  className,
}: {
  label: "A" | "B" | "C";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("h-2.5 w-2.5 rounded-full", TEAM_DOT[label])} />
      Team {label}
    </span>
  );
}

function NewMatch({ gameId, teams }: { gameId: string; teams: MatchTeam[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  // Every unordered pair of teams (A–B, A–C, B–C).
  const pairs: [MatchTeam, MatchTeam][] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      pairs.push([teams[i], teams[j]]);
    }
  }

  function startMatch(homeTeamId: string, awayTeamId: string) {
    start(async () => {
      const r = await createMatchAction({ gameId, homeTeamId, awayTeamId });
      if ("error" in r) toast.error(r.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="text-sm font-medium">Start a match</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {pairs.map(([a, b]) => (
            <Button
              key={`${a.id}-${b.id}`}
              variant="outline"
              disabled={pending}
              className="h-auto py-3"
              onClick={() => startMatch(a.id, b.id)}
            >
              <TeamName label={a.label} />
              <span className="mx-1 text-muted-foreground">vs</span>
              <TeamName label={b.label} />
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          First to {GOAL_TARGET} goals or {REGULATION_MS / 60000} minutes. Level
          at the end → {GOLDEN_GOAL_MS / 60000}-minute golden goal, then
          penalties.
        </p>
      </CardContent>
    </Card>
  );
}

function ActiveMatch({
  match,
  teams,
  canRecord,
  clockOffset,
}: {
  match: SerializedMatch;
  teams: MatchTeam[];
  canRecord: boolean;
  clockOffset: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Which team we're entering a goal for (and the own-goal toggle).
  const [goalFor, setGoalFor] = useState<string | null>(null);
  const [ownGoal, setOwnGoal] = useState(false);

  const running = match.status === "LIVE";
  const now = useNow(running, clockOffset);

  const limit = phaseLimit(match.phase);
  const elapsed = elapsedMs(
    {
      periodStartedAt: match.periodStartedAt ? match.periodStartedAt : null,
      accumulatedMs: match.accumulatedMs,
    },
    now,
  );
  const remaining = limit === null ? null : Math.max(0, limit - elapsed);
  const timeUp = remaining !== null && remaining === 0;
  const tied = match.homeScore === match.awayScore;

  const homeTeam = teams.find((t) => t.id === match.homeTeamId);
  const awayTeam = teams.find((t) => t.id === match.awayTeamId);

  function run(fn: () => Promise<{ error: string } | { ok: true }>) {
    start(async () => {
      const r = await fn();
      if ("error" in r) toast.error(r.error);
      else {
        setGoalFor(null);
        setOwnGoal(false);
        router.refresh();
      }
    });
  }

  const phaseBadge =
    match.phase === "GOLDEN_GOAL"
      ? "Golden goal"
      : match.phase === "PENALTIES"
        ? "Penalties"
        : "Match " + match.order;

  return (
    <Card className="border-emerald-500/40">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <Badge
            variant={match.phase === "REGULAR" ? "secondary" : "default"}
            className={cn(
              match.phase === "GOLDEN_GOAL" && "bg-amber-500 text-white",
              match.phase === "PENALTIES" && "bg-sky-600 text-white",
            )}
          >
            {phaseBadge}
          </Badge>
          {match.phase !== "PENALTIES" && (
            <span
              className={cn(
                "font-mono text-2xl font-bold tabular-nums",
                timeUp && "text-destructive",
              )}
            >
              {remaining !== null ? formatClock(remaining) : ""}
            </span>
          )}
        </div>

        {/* Scoreline */}
        <div className="flex items-center justify-center gap-4 py-1">
          <div className="flex-1 text-right text-sm font-medium">
            <TeamName label={match.homeLabel} className="justify-end" />
          </div>
          <div className="font-mono text-3xl font-bold tabular-nums">
            {match.homeScore}
            <span className="mx-1 text-muted-foreground">–</span>
            {match.awayScore}
          </div>
          <div className="flex-1 text-sm font-medium">
            <TeamName label={match.awayLabel} />
          </div>
        </div>

        {match.phase === "PENALTIES" ? (
          canRecord ? (
            <PenaltyEntry
              match={match}
              pending={pending}
              onSave={(home, away) =>
                run(() =>
                  recordPenaltiesAction({
                    matchId: match.id,
                    homePenalties: home,
                    awayPenalties: away,
                  }),
                )
              }
            />
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Settling it on penalties…
            </p>
          )
        ) : canRecord ? (
          <>
            {/* Goal entry */}
            {goalFor ? (
              <ScorerPicker
                beneficiaryTeam={
                  goalFor === match.homeTeamId ? homeTeam : awayTeam
                }
                opponentTeam={
                  goalFor === match.homeTeamId ? awayTeam : homeTeam
                }
                ownGoal={ownGoal}
                pending={pending}
                onToggleOwnGoal={() => setOwnGoal((v) => !v)}
                onCancel={() => {
                  setGoalFor(null);
                  setOwnGoal(false);
                }}
                onPick={(scorerId) =>
                  run(() =>
                    logGoalAction({
                      matchId: match.id,
                      teamId: goalFor,
                      scorerId,
                      isOwnGoal: ownGoal,
                    }),
                  )
                }
              />
            ) : (
              !timeUp && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => setGoalFor(match.homeTeamId)}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Goal {match.homeLabel}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => setGoalFor(match.awayTeamId)}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Goal {match.awayLabel}
                  </Button>
                </div>
              )
            )}

            {/* Clock + phase controls */}
            {!goalFor && (
              <div className="flex flex-wrap gap-2">
                {!timeUp &&
                  (running ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => pauseMatchAction(match.id))}
                    >
                      <Pause className="mr-1 h-4 w-4" /> Pause
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => resumeMatchAction(match.id))}
                    >
                      <Play className="mr-1 h-4 w-4" /> Resume
                    </Button>
                  ))}

                {/* Time's up in REGULAR */}
                {timeUp && match.phase === "REGULAR" && tied && (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => startGoldenGoalAction(match.id))}
                  >
                    Start golden goal
                  </Button>
                )}
                {timeUp && match.phase === "REGULAR" && !tied && (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => endMatchNowAction(match.id))}
                  >
                    <Trophy className="mr-1 h-4 w-4" /> End — Team{" "}
                    {match.homeScore > match.awayScore
                      ? match.homeLabel
                      : match.awayLabel}{" "}
                    win
                  </Button>
                )}

                {/* Time's up in GOLDEN_GOAL → penalties */}
                {timeUp && match.phase === "GOLDEN_GOAL" && (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => startPenaltiesAction(match.id))}
                  >
                    Go to penalties
                  </Button>
                )}

                {/* Manual finish — leader wins, level = draw */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => endMatchNowAction(match.id))}
                >
                  End match
                </Button>
              </div>
            )}

            <GoalList match={match} canRecord={canRecord} onRemove={(id) =>
              run(() => removeGoalAction(id))
            } />
          </>
        ) : (
          <GoalList match={match} canRecord={false} onRemove={() => {}} />
        )}

        {canRecord && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this match and its goals?")) {
                run(() => deleteMatchAction(match.id));
              }
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Delete match
          </button>
        )}

        {pending && (
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </CardContent>
    </Card>
  );
}

function ScorerPicker({
  beneficiaryTeam,
  opponentTeam,
  ownGoal,
  pending,
  onPick,
  onToggleOwnGoal,
  onCancel,
}: {
  beneficiaryTeam?: MatchTeam;
  opponentTeam?: MatchTeam;
  ownGoal: boolean;
  pending: boolean;
  onPick: (scorerId: string | null) => void;
  onToggleOwnGoal: () => void;
  onCancel: () => void;
}) {
  // For an own goal, the scorer is on the opponent's team but the goal counts
  // for the beneficiary.
  const scorerTeam = ownGoal ? opponentTeam : beneficiaryTeam;
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Who scored for Team {beneficiaryTeam?.label}?
        </p>
        <button
          type="button"
          onClick={onToggleOwnGoal}
          className={cn(
            "text-xs",
            ownGoal ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {ownGoal ? "↩ own goal" : "own goal?"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(scorerTeam?.players ?? []).map((p) => (
          <Button
            key={p.userId}
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onPick(p.userId)}
          >
            {p.name ?? "Unnamed"}
          </Button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => onPick(null)}
        >
          No scorer
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function GoalList({
  match,
  canRecord,
  onRemove,
}: {
  match: SerializedMatch;
  canRecord: boolean;
  onRemove: (goalId: string) => void;
}) {
  if (match.goals.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm">
      {match.goals.map((g) => {
        const label =
          g.teamId === match.homeTeamId ? match.homeLabel : match.awayLabel;
        return (
          <li
            key={g.id}
            className="flex items-center justify-between gap-2 text-muted-foreground"
          >
            <span>
              <span className="font-mono tabular-nums">
                {formatClock(g.clockMs)}
              </span>{" "}
              · Team {label}
              {g.scorerName ? ` — ${g.scorerName}` : " — goal"}
              {g.isOwnGoal && " (OG)"}
              {g.phase === "GOLDEN_GOAL" && " · GG"}
            </span>
            {canRecord && match.status !== "COMPLETED" && (
              <button
                type="button"
                onClick={() => onRemove(g.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove goal"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PenaltyEntry({
  match,
  pending,
  onSave,
}: {
  match: SerializedMatch;
  pending: boolean;
  onSave: (home: number, away: number) => void;
}) {
  const [home, setHome] = useState(match.homePenalties);
  const [away, setAway] = useState(match.awayPenalties);
  return (
    <div className="space-y-3">
      <p className="text-center text-sm font-medium">Penalty shootout</p>
      <div className="flex items-center justify-center gap-6">
        <Stepper
          label={`Team ${match.homeLabel}`}
          value={home}
          onChange={setHome}
        />
        <Stepper
          label={`Team ${match.awayLabel}`}
          value={away}
          onChange={setAway}
        />
      </div>
      <Button
        className="w-full"
        disabled={pending || home === away}
        onClick={() => onSave(home, away)}
      >
        {home === away ? "Must have a winner" : "Save result"}
      </Button>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-6 text-center font-mono text-xl font-bold tabular-nums">
          {value}
        </span>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          onClick={() => onChange(value + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CompletedMatch({
  match,
  canRecord,
}: {
  match: SerializedMatch;
  canRecord: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const winnerLabel =
    match.winnerTeamId === match.homeTeamId
      ? match.homeLabel
      : match.winnerTeamId === match.awayTeamId
        ? match.awayLabel
        : null;

  const decided =
    match.phase === "PENALTIES"
      ? `pens ${match.homePenalties}–${match.awayPenalties}`
      : match.phase === "GOLDEN_GOAL"
        ? "golden goal"
        : null;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Match {match.order}
          </span>
          {winnerLabel ? (
            <Badge variant="outline" className="gap-1">
              <Trophy className="h-3 w-3" /> Team {winnerLabel}
              {decided ? ` · ${decided}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline">Draw</Badge>
          )}
        </div>
        <div className="flex items-center justify-center gap-4">
          <div className="flex-1 text-right text-sm font-medium">
            <TeamName label={match.homeLabel} className="justify-end" />
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums">
            {match.homeScore}
            <span className="mx-1 text-muted-foreground">–</span>
            {match.awayScore}
          </div>
          <div className="flex-1 text-sm font-medium">
            <TeamName label={match.awayLabel} />
          </div>
        </div>

        <GoalList match={match} canRecord={false} onRemove={() => {}} />

        {canRecord && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this match and its goals?")) {
                start(async () => {
                  const r = await deleteMatchAction(match.id);
                  if ("error" in r) toast.error(r.error);
                  else router.refresh();
                });
              }
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Delete
          </button>
        )}
      </CardContent>
    </Card>
  );
}
