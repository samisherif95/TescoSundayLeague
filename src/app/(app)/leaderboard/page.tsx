import { Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGroupScorerGoals } from "@/lib/games-queries";
import { buildLeaderboard, type LeaderboardEntry } from "@/lib/leaderboard";
import { requireActiveGroup } from "@/lib/session";
import { cn } from "@/lib/utils";

export default async function LeaderboardPage() {
  const { group } = await requireActiveGroup();
  const goals = await getGroupScorerGoals(group.id);
  const board = buildLeaderboard(goals);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          Top goal scorers across {group.name}&apos;s completed games.
        </p>
      </header>

      {board.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center">
          <div className="mx-auto mb-5 inline-flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Trophy className="size-6" />
          </div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            No goals yet
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Once games are played and scorers are recorded, the top scorers show
            up here.
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {board.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  const initial = (entry.name ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <RankBadge rank={entry.rank} />
      <Avatar className="size-9">
        <AvatarImage src={entry.image ?? undefined} alt="" />
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 truncate font-medium">{entry.name}</div>
      <div className="flex items-baseline gap-1 tabular-nums">
        <span className="text-lg font-semibold">{entry.goals}</span>
        <span className="text-xs text-muted-foreground">
          {entry.goals === 1 ? "goal" : "goals"}
        </span>
      </div>
    </div>
  );
}

// Medal tones for the podium (ranks 1–3); everyone else gets a plain number.
const MEDAL: Record<number, string> = {
  1: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  2: "border-slate-400/40 bg-slate-400/15 text-slate-600 dark:text-slate-300",
  3: "border-orange-600/40 bg-orange-600/15 text-orange-700 dark:text-orange-400",
};

function RankBadge({ rank }: { rank: number }) {
  return (
    <div
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
        MEDAL[rank] ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {rank}
    </div>
  );
}
