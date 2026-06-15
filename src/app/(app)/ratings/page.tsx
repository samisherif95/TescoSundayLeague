import Link from "next/link";
import { ShieldCheck, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getGroupRatingMembers } from "@/lib/games-queries";
import { buildRatingsBoard, type RatingEntry } from "@/lib/ratings";
import { canViewRatingsAudit } from "@/lib/ratings-audit";
import { requireActiveGroup } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Position } from "@/generated/prisma/enums";

const POSITION_COLOR: Record<Position, string> = {
  DEF: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  MID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  FWD: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export default async function RatingsPage() {
  const { user, group, membership } = await requireActiveGroup();
  // Ratings are private: a regular member only ever sees their own score.
  // Admins keep the full group board so they can manage the squad.
  const isAdmin = membership.role === "ADMIN";
  const members = await getGroupRatingMembers(group.id);
  const board = buildRatingsBoard(
    members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      image: m.user.image,
      position: m.user.preferredPosition,
      skillScore: m.user.skillScore,
      ratingsCount: m.user._count.ratingsReceived,
    })),
  );

  // Non-admins see only their own row, and without a rank (which would leak
  // where they sit relative to everyone else).
  const visible = isAdmin ? board : board.filter((e) => e.id === user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isAdmin ? "Player ratings" : "Your rating"}
          </h1>
          {canViewRatingsAudit(user.email) && (
            <Link
              href="/ratings/audit"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ShieldCheck className="size-3.5" />
              Audit
            </Link>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? `Everyone in ${group.name}, ranked by the average rating their teammates have given them. Play well — your team is watching.`
            : "The average rating your teammates have given you after games. Only you and your group's admins can see it."}
        </p>
      </header>

      {visible.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center">
          <div className="mx-auto mb-5 inline-flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Star className="size-6" />
          </div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            {isAdmin ? "No players yet" : "Not yet rated"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isAdmin
              ? "Once members join and rate each other after games, the ratings show up here."
              : "Once your teammates rate you after a game, your rating shows up here."}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {visible.map((entry) => (
              <Row key={entry.id} entry={entry} showRank={isAdmin} />
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function Row({ entry, showRank }: { entry: RatingEntry; showRank: boolean }) {
  const initial = (entry.name ?? "?").slice(0, 1).toUpperCase();
  const rated = entry.ratingsCount > 0;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {showRank && <RankBadge rank={entry.rank} />}
      <Avatar className="size-9">
        <AvatarImage src={entry.image ?? undefined} alt="" />
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{entry.name}</span>
          {entry.position && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-semibold",
                POSITION_COLOR[entry.position],
              )}
            >
              {entry.position}
            </Badge>
          )}
        </div>
        {rated ? (
          <StarMeter score={entry.score} />
        ) : (
          <span className="text-xs text-muted-foreground">Not yet rated</span>
        )}
      </div>
      {rated && (
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">
            {entry.score.toFixed(1)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {entry.ratingsCount}{" "}
            {entry.ratingsCount === 1 ? "rating" : "ratings"}
          </div>
        </div>
      )}
    </div>
  );
}

/** Five small stars filled up to the rounded score, for an at-a-glance read. */
function StarMeter({ score }: { score: number }) {
  const filled = Math.round(score);
  return (
    <div
      className="mt-0.5 flex items-center gap-0.5"
      aria-label={`${score.toFixed(1)} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "size-3.5",
            n <= filled
              ? "fill-amber-400 stroke-amber-500"
              : "stroke-muted-foreground/40",
          )}
        />
      ))}
    </div>
  );
}

// Medal tones for the podium (ranks 1–3); everyone else gets a plain number,
// and unrated players (rank null) get a neutral dash.
const MEDAL: Record<number, string> = {
  1: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  2: "border-slate-400/40 bg-slate-400/15 text-slate-600 dark:text-slate-300",
  3: "border-orange-600/40 bg-orange-600/15 text-orange-700 dark:text-orange-400",
};

function RankBadge({ rank }: { rank: number | null }) {
  return (
    <div
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
        rank ? MEDAL[rank] : null,
        !rank || !MEDAL[rank]
          ? "border-border bg-muted text-muted-foreground"
          : null,
      )}
    >
      {rank ?? "–"}
    </div>
  );
}
