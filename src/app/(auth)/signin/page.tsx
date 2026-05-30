import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForms } from "./_forms";

export default async function SignInPage() {
  const session = await auth();
  // Only treat the visitor as signed in if their session user still exists —
  // otherwise a stale cookie (e.g. after a DB reset or deleted account) would
  // ping-pong between /signin and /home forever.
  if (session?.user?.id) {
    const exists = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true },
    });
    if (exists) redirect("/home");
  }

  const googleEnabled = Boolean(env.googleId && env.googleSecret);
  const isDemo = process.env.DEMO_MODE === "1";

  return (
    <main className="relative flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-spotlight"
      />
      <div className="relative w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="font-display text-2xl">
              Sign up or log in
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Sort this week&apos;s game with the rest of the lads.
            </p>
          </CardHeader>
          <CardContent>
            <SignInForms googleEnabled={googleEnabled} />

            {isDemo && (
              <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-center text-sm">
                <p className="font-medium">Just exploring?</p>
                <p className="mt-1 text-muted-foreground">
                  Demo mode is on — skip sign-up and impersonate a fake user.
                </p>
                <Link
                  href="/demo"
                  className="mt-3 inline-block font-medium text-primary hover:underline"
                >
                  Pick a demo user →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
