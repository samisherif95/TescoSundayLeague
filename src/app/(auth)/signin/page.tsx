import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForms } from "./_forms";

const BANNERS: Record<string, { tone: "ok" | "error"; text: string }> = {
  reset: { tone: "ok", text: "Password updated — log in with your new password." },
  verified: { tone: "ok", text: "Email verified! You can log in now." },
  verifyError: {
    tone: "error",
    text: "That verification link is invalid or expired. Try logging in to resend it.",
  },
};

/**
 * Auth.js bounces failed provider sign-ins back here as `?error=<code>` (it's
 * our configured `pages.signIn`). We used to render nothing for those, so the
 * most common one — signing up with a password and then trying "Continue with
 * Google" on the same address — dumped the user back on this page with no
 * explanation at all, looking for all the world like the button was broken.
 */
const AUTH_ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    "This email already has an account with a password. Log in with your email and password below (or use “Forgot password?”), then you're in.",
  OAuthCallbackError: "Google sign-in didn't complete. Please try again.",
  OAuthSignInError: "Google sign-in didn't complete. Please try again.",
  AccessDenied: "That account can't sign in. Try another, or ask your group admin.",
  Configuration:
    "Sign-in is misconfigured on our side. Please tell your group admin.",
};
const AUTH_ERROR_FALLBACK = "Something went wrong signing you in. Please try again.";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    reset?: string;
    verified?: string;
    verifyError?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const banner =
    (params.reset && BANNERS.reset) ||
    (params.verified && BANNERS.verified) ||
    (params.verifyError && BANNERS.verifyError) ||
    (params.error && {
      tone: "error" as const,
      text: AUTH_ERRORS[params.error] ?? AUTH_ERROR_FALLBACK,
    }) ||
    null;

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
        {banner && (
          <div
            role="status"
            className={
              banner.tone === "ok"
                ? "mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-center text-sm text-foreground"
                : "mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-center text-sm text-destructive"
            }
          >
            {banner.text}
          </div>
        )}
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
