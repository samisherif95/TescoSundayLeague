import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getGameWithDetail } from "@/lib/games-queries";
import { requireOnboardedUser } from "@/lib/session";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { BookingForm } from "./_form";

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireOnboardedUser();
  const game = await getGameWithDetail(id);
  if (!game) notFound();
  if (game.bookerId !== user.id) redirect(`/games/${game.id}`);
  if (
    game.status !== GameStatus.LOCKED &&
    game.status !== GameStatus.BOOKED &&
    game.status !== GameStatus.COMPLETED
  ) {
    redirect(`/games/${game.id}`);
  }

  const confirmedCount = game.signups.filter(
    (s) => s.status === SignupStatus.CONFIRMED,
  ).length;

  const kickoffStr = game.kickoffAt.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Book the pitch</h1>
        <p className="text-sm text-muted-foreground">{kickoffStr}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. Book on hireapitch.com</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            Use your own card. Pick the slot matching{" "}
            <span className="font-medium">{kickoffStr}</span>.
          </p>
          <Button asChild variant="outline">
            <a
              href={game.pitchBookingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2"
            >
              Open {game.pitchName} on hireapitch.com{" "}
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Enter total cost</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Enter what you paid for the pitch. It&apos;ll be split evenly across
            the {confirmedCount} confirmed players. Payment links are generated
            and shared with the squad once an admin ends the game — so any
            no-shows can be dropped first and the split stays right.
          </p>
          <BookingForm
            gameId={game.id}
            playerCount={confirmedCount}
            initialPence={game.totalCostPence}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Payment links</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Once an admin ends the game, the split is generated from who actually
            played and the payment links appear on the game page for the whole
            squad — you&apos;ll be able to see who&apos;s paid and nudge anyone
            who hasn&apos;t.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
