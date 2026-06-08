import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getGameHistory } from "@/lib/games-queries";
import { requireActiveGroup } from "@/lib/session";
import { deriveScore, tallyScorers } from "@/lib/match";
import { cn } from "@/lib/utils";

export default async function GamesHistoryPage() {
  const { user, group, membership } = await requireActiveGroup();
  const isAdmin = membership.role === "ADMIN";
  const games = await getGameHistory(group.id, user.id, isAdmin);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Past games</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Every completed Sunday." : "Sundays you played in."}
        </p>
      </header>

      {games.length === 0 ? (
        <p className="text-sm text-muted-foreground">No completed games yet.</p>
      ) : (
        <div className="grid gap-3">
          {games.map((game) => {
            const scorers = tallyScorers(game.matches.flatMap((m) => m.goals));
            return (
              <Card key={game.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/games/${game.id}`}
                      className="font-semibold hover:underline"
                    >
                      {game.kickoffAt.toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Europe/London",
                      })}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {game.pitchName}
                    </span>
                  </div>

                  {game.matches.length > 0 ? (
                    <ul className="space-y-1 text-sm">
                      {game.matches.map((m) => {
                        const s = deriveScore(
                          m.goals,
                          m.homeTeamId,
                          m.awayTeamId,
                        );
                        const tied = s.home === s.away;
                        const homeWon = m.winnerTeamId === m.homeTeamId;
                        const awayWon = m.winnerTeamId === m.awayTeamId;
                        return (
                          <li
                            key={m.id}
                            className="flex items-center gap-2 tabular-nums"
                          >
                            <span className={cn(homeWon && "font-semibold")}>
                              Team {m.homeTeam.label}
                            </span>
                            <span className="text-muted-foreground">
                              {s.home}–{s.away}
                            </span>
                            <span className={cn(awayWon && "font-semibold")}>
                              Team {m.awayTeam.label}
                            </span>
                            {tied && m.winnerTeamId && (
                              <span className="text-xs text-muted-foreground">
                                (pens {m.homePenalties}–{m.awayPenalties})
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No matches recorded.
                    </p>
                  )}

                  {scorers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {scorers.slice(0, 5).map((sc) => (
                        <Badge
                          key={sc.id}
                          variant="outline"
                          className="font-normal"
                        >
                          {sc.name}
                          {sc.goals > 1 && (
                            <span className="ml-1 text-muted-foreground">
                              ×{sc.goals}
                            </span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
