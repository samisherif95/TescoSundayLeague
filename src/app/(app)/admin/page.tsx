import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import {
  GameStatus,
  SignupStatus,
} from "@/generated/prisma/enums";
import { AdminControls } from "./_controls";

export default async function AdminPage() {
  await requireAdmin();

  const games = await prisma.game.findMany({
    where: {
      status: {
        in: [GameStatus.OPEN, GameStatus.LOCKED, GameStatus.BOOKED],
      },
    },
    orderBy: { kickoffAt: "asc" },
    include: {
      _count: {
        select: {
          signups: { where: { status: SignupStatus.CONFIRMED } },
        },
      },
    },
  });

  const totalUsers = await prisma.user.count();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          {totalUsers} total users
        </p>
      </header>

      <AdminControls hasOpen={games.some((g) => g.status === GameStatus.OPEN)} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Upcoming games</h2>
        {games.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No upcoming games. Create one above.
          </p>
        ) : (
          <div className="grid gap-3">
            {games.map((g) => (
              <Card key={g.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <Link href={`/games/${g.id}`} className="hover:underline">
                      {g.kickoffAt.toLocaleString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/London",
                      })}
                    </Link>
                    <Badge variant="outline">{g.status}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {g.pitchName} · {g._count.signups} confirmed
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
