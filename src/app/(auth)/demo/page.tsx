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
            can play with cron triggers and game editing.
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
            <span className="font-semibold">Try the full Friday flow</span>
            <Badge variant="outline">cron</Badge>
          </div>
          <p className="text-muted-foreground">
            Sign in as the admin, then open these in another tab to advance
            game state:
          </p>
          <ul className="space-y-1 font-mono text-xs">
            <li>
              <a
                className="text-primary hover:underline"
                href="/api/cron/friday-lock?dev=1"
                target="_blank"
                rel="noreferrer"
              >
                /api/cron/friday-lock?dev=1
              </a>
              <span className="text-muted-foreground">
                {" "}— locks the game, picks a booker, generates teams
              </span>
            </li>
            <li>
              <a
                className="text-primary hover:underline"
                href="/api/cron/sunday-complete?dev=1"
                target="_blank"
                rel="noreferrer"
              >
                /api/cron/sunday-complete?dev=1
              </a>
              <span className="text-muted-foreground"> — marks the game COMPLETED so you can rate</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
