import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { nextSundayNoon, signupDeadline } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * Harmless cron canary / health check. SAFE TO RUN ANYTIME:
 *  - no DB reads or writes
 *  - no emails, no push notifications
 *  - never mutates any game state
 *
 * Its only job is to prove the cron *plumbing* works end-to-end:
 *   1. Vercel's scheduler actually fires the cron (a log line appears), and
 *   2. the `CRON_SECRET` auth handshake the real crons rely on is wired up.
 *
 * Unlike the real crons it does NOT reject unauthenticated callers — it instead
 * *reports* what it saw so the failure mode is obvious in the logs. It leaks no
 * secret: only booleans about whether the header was present / matched.
 *
 * Mirrors the comparison in `assertCronAuth` (src/lib/cron.ts) on purpose, so a
 * green ping here means the real crons' auth gate would pass too.
 *
 * TEMPORARY: remove this route (and its vercel.json entry, if added) once the
 * cron issue is diagnosed.
 */
export async function GET() {
  const h = await headers();
  const authz = h.get("authorization");
  const secret = process.env.CRON_SECRET;
  const secretConfigured = Boolean(secret);
  const headerPresent = Boolean(authz);
  // Same check the real crons gate on — but reported, not enforced.
  const matched = secretConfigured && authz === `Bearer ${secret}`;

  const kickoff = nextSundayNoon();
  const payload = {
    ok: true,
    marker: "CRON_HEALTH_PING",
    now: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV ?? null,
    // Set by Vercel at runtime — confirms this executed on Vercel, not locally.
    vercelRegion: process.env.VERCEL_REGION ?? null,
    isVercelCron: (h.get("user-agent") ?? "").includes("vercel-cron"),
    auth: {
      // Did the request carry an Authorization header at all? Vercel only sends
      // one when CRON_SECRET is set in the PROJECT env. `false` here on a real
      // cron invocation => CRON_SECRET is not set in Vercel => every real cron
      // is currently 401ing.
      headerPresent,
      // Is CRON_SECRET present in THIS deployment's env?
      cronSecretConfigured: secretConfigured,
      // Did the header match the configured secret? (the real gate's verdict)
      matched,
    },
    // Pure date math, no I/O — also confirms the schedule logic at a glance.
    schedule: {
      nextSundayNoonUtc: kickoff.toISOString(),
      signupDeadlineUtc: signupDeadline(kickoff).toISOString(),
    },
  };

  // Loud, greppable marker for the logs.
  console.log("[cron-health]", JSON.stringify(payload));
  return NextResponse.json(payload);
}
