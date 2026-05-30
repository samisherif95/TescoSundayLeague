import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    game.status !== GameStatus.BOOKED
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
            Cost will be split evenly across {confirmedCount} confirmed players.
            Monzo links are generated for everyone except you.
          </p>
          <BookingForm
            gameId={game.id}
            playerCount={confirmedCount}
            initialPence={game.totalCostPence}
          />
        </CardContent>
      </Card>

      {game.paymentRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Share with the group</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {game.paymentRequests.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3"
              >
                <div className="text-sm">
                  <div className="font-medium">{p.debtor.name}</div>
                  <div className="text-muted-foreground">
                    £{(p.amountPence / 100).toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {p.paidStatus === "MARKED_PAID" ? "Paid" : "Unpaid"}
                  </Badge>
                  <Button asChild size="sm" variant="outline">
                    <a href={p.paymentLink} target="_blank" rel="noreferrer">
                      Open link
                    </a>
                  </Button>
                </div>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Tip: long-press a link to copy, then drop into WhatsApp.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
