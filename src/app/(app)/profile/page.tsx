import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/session";
import { GameStatus, SignupStatus } from "@/generated/prisma/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileForm } from "./_form";
import { PushSubscribe } from "@/components/push-subscribe";

export default async function ProfilePage() {
  const user = await requireOnboardedUser();
  const recentSignups = await prisma.signup.findMany({
    where: {
      userId: user.id,
      status: { not: SignupStatus.DROPPED_OUT },
      game: { status: GameStatus.COMPLETED },
    },
    include: { game: true },
    orderBy: { game: { kickoffAt: "desc" } },
    take: 8,
  });

  const ratingsCount = await prisma.rating.count({
    where: { rateeId: user.id },
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <section className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarImage src={user.image ?? undefined} alt="" />
          <AvatarFallback>{(user.name ?? "?").slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-semibold">{user.name}</h1>
          <p className="text-sm text-muted-foreground">
            Skill score {user.skillScore.toFixed(1)} · {ratingsCount} ratings
          </p>
          <div className="mt-1 flex gap-2">
            {user.preferredPosition && (
              <Badge variant="outline">{user.preferredPosition}</Badge>
            )}
            {user.isAdmin && <Badge>Admin</Badge>}
          </div>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Edit profile</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm
            initial={{
              name: user.name ?? "",
              paymentMethod: user.paymentMethod,
              paymentHandle: user.paymentHandle ?? "",
              preferredPosition: user.preferredPosition ?? "MID",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <PushSubscribe />
        </CardContent>
      </Card>

      {recentSignups.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Recent games</h2>
          <div className="grid gap-2">
            {recentSignups.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border bg-card p-3"
              >
                <div className="text-sm">
                  <div className="font-medium">
                    {s.game.kickoffAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                  <div className="text-muted-foreground">{s.game.pitchName}</div>
                </div>
                <Badge variant="outline">{s.position}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
