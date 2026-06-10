import { notFound } from "next/navigation";
import { ShieldCheck, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGroupRatingsAudit } from "@/lib/games-queries";
import {
  canViewRatingsAudit,
  groupRatingsByRater,
  type AuditUser,
  type RaterGroup,
} from "@/lib/ratings-audit";
import { requireActiveGroup } from "@/lib/session";
import { cn } from "@/lib/utils";

// Owner-only audit of raw rating rows, week by week. Everyone else gets a 404
// (not a redirect) so the page's existence isn't even revealed.
export default async function RatingsAuditPage() {
  const { user, group } = await requireActiveGroup();
  if (!canViewRatingsAudit(user.email)) notFound();

  const games = await getGroupRatingsAudit(group.id);
  const weeks = games.map((g) => ({
    id: g.id,
    kickoffAt: g.kickoffAt,
    ratingsCount: g.ratings.length,
    groups: groupRatingsByRater(g.ratings),
  }));

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="size-6 text-muted-foreground" />
          Ratings audit
        </h1>
        <p className="text-sm text-muted-foreground">
          Every rating submitted in {group.name}, week by week — who gave it,
          who got it. Only you can see this page.
        </p>
      </header>

      {weeks.length === 0 ? (
        <p className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">
          No completed games yet, so no ratings to audit.
        </p>
      ) : (
        weeks.map((week) => (
          <Card key={week.id}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between text-base">
                <span>
                  {week.kickoffAt.toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {week.ratingsCount}{" "}
                  {week.ratingsCount === 1 ? "rating" : "ratings"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {week.groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nobody rated anyone this week.
                </p>
              ) : (
                week.groups.map((g) => <RaterSection key={g.rater.id} group={g} />)
              )}
            </CardContent>
          </Card>
        ))
      )}
    </main>
  );
}

function RaterSection({ group }: { group: RaterGroup }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <UserAvatar user={group.rater} />
        <span className="text-sm font-semibold">
          {group.rater.name ?? "Unnamed"}
        </span>
        <span className="text-xs text-muted-foreground">rated</span>
      </div>
      <div className="divide-y rounded-xl border">
        {group.given.map(({ ratee, score }) => (
          <div key={ratee.id} className="flex items-center gap-2 px-3 py-2">
            <UserAvatar user={ratee} />
            <span className="min-w-0 flex-1 truncate text-sm">
              {ratee.name ?? "Unnamed"}
            </span>
            <ScoreStars score={score} />
          </div>
        ))}
      </div>
    </section>
  );
}

function UserAvatar({ user }: { user: AuditUser }) {
  const initial = (user.name ?? "?").slice(0, 1).toUpperCase();
  return (
    <Avatar className="size-6">
      <AvatarImage src={user.image ?? undefined} alt="" />
      <AvatarFallback className="text-[10px]">{initial}</AvatarFallback>
    </Avatar>
  );
}

function ScoreStars({ score }: { score: number }) {
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={`${score} out of 5`}
    >
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={cn(
              "size-3.5",
              n <= score
                ? "fill-amber-400 stroke-amber-500"
                : "stroke-muted-foreground/40",
            )}
          />
        ))}
      </div>
      <span className="w-4 text-right text-sm font-semibold tabular-nums">
        {score}
      </span>
    </div>
  );
}
