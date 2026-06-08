import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { DemoSwitcher } from "./_switcher";

export default async function DemoPage() {
  if (process.env.DEMO_MODE !== "1") notFound();

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@demo.sundayleague.app" } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to landing
      </Link>
      <div className="mb-8 flex items-start gap-3">
        <div className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Sparkles className="size-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Pick a demo user
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in as any of these fake players. The first one is admin so you
            can create, lock, end and cancel games.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-2 sm:p-3">
          <DemoSwitcher
            users={users.map((u) => ({
              id: u.id,
              name: u.name ?? "Unnamed",
              email: u.email!,
              position: u.preferredPosition,
              skillScore: u.skillScore,
              isAdmin: u.isAdmin,
            }))}
          />
        </CardContent>
      </Card>

      <Card className="mt-6 border-dashed bg-card/40">
        <CardContent className="space-y-3 p-5 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Try the full game flow</span>
            <Badge variant="outline">admin</Badge>
          </div>
          <p className="text-muted-foreground">
            Sign in as the admin, then drive the game from its page:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Lock now</span> —
              picks a booker, generates teams.
            </li>
            <li>
              <span className="font-medium text-foreground">End game</span> —
              marks it COMPLETED so you can rate teammates.
            </li>
            <li>
              <span className="font-medium text-foreground">Cancel</span> —
              calls the week off and notifies everyone.
            </li>
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
