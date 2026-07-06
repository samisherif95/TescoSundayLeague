import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/session";
import {
  GameStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import { RatingForm } from "./_form";

export default async function RatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireOnboardedUser();
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      signups: {
        where: { status: SignupStatus.CONFIRMED },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              preferredPosition: true,
            },
          },
        },
      },
    },
  });
  if (!game) notFound();
  if (game.status !== GameStatus.COMPLETED) {
    redirect(`/games/${game.id}`);
  }
  const playedIds = new Set(game.signups.map((s) => s.userId));
  if (!playedIds.has(user.id)) redirect(`/games/${game.id}`);

  // Same 48h window the submit action enforces (from game end, not kickoff) —
  // show a closed state rather than a form that rejects every submission.
  const RATING_WINDOW_MS = 48 * 60 * 60 * 1000;
  const windowStart = game.completedAt ?? game.kickoffAt;
  // eslint-disable-next-line react-hooks/purity -- server render; "now" is intended
  const ratingClosed = Date.now() - windowStart.getTime() > RATING_WINDOW_MS;
  if (ratingClosed) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <header>
          <h1 className="text-2xl font-semibold">Rating closed</h1>
          <p className="text-sm text-muted-foreground">
            The 48-hour window to rate this game&apos;s teammates has passed.
          </p>
        </header>
      </main>
    );
  }

  // Load only this user's existing ratings (server-side only — never expose
  // anyone else's raterId).
  const existing = await prisma.rating.findMany({
    where: { gameId: game.id, raterId: user.id },
    select: { rateeId: true, score: true },
  });

  const teammates = game.signups
    .map((s) => s.user)
    .filter((u) => u.id !== user.id);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Rate your teammates</h1>
        <p className="text-sm text-muted-foreground">
          1–5 stars. Anonymous. Optional — leave blank to skip.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Players</CardTitle>
        </CardHeader>
        <CardContent>
          <RatingForm
            gameId={game.id}
            teammates={teammates.map((t) => ({
              id: t.id,
              name: t.name,
              image: t.image,
              position: t.preferredPosition,
            }))}
            existing={Object.fromEntries(
              existing.map((r) => [r.rateeId, r.score]),
            )}
          />
        </CardContent>
      </Card>
    </main>
  );
}
