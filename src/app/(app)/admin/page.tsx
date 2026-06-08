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
import { ScheduleEditor } from "./_schedule-editor";
import { JoinKeyCard } from "./_join-key-card";

export default async function AdminPage() {
  const { group } = await requireAdmin();

  const games = await prisma.game.findMany({
    where: {
      groupId: group.id,
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

  const memberCount = await prisma.groupMember.count({
    where: { groupId: group.id },
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <p className="text-sm text-muted-foreground">
          {memberCount} {memberCount === 1 ? "member" : "members"}
        </p>
      </header>

      <JoinKeyCard joinKey={group.joinKey} />

      <ScheduleEditor
        schedule={{
          kickoffWeekday: group.kickoffWeekday,
          kickoffHour: group.kickoffHour,
          kickoffMinute: group.kickoffMinute,
          lockOffsetHours: group.lockOffsetHours,
          defaultPitchName: group.defaultPitchName,
          defaultPitchBookingUrl: group.defaultPitchBookingUrl,
          playerNote: group.playerNote ?? "",
        }}
      />

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
