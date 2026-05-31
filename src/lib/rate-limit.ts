import { headers } from "next/headers";
import { prisma } from "@/lib/db";

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

/**
 * Fixed-window rate limiter backed by Postgres (this stack has no Redis).
 * Allows up to `limit` hits per `windowMs` for a given key; the window resets
 * on the first hit after it lapses.
 *
 * Approximate under heavy concurrency — a few extra hits can slip through a
 * fresh window since the count is read-then-incremented — which is fine for
 * throttling auth emails / login attempts in a small private app. Fails OPEN:
 * if the limiter's own DB call errors we allow the request, so a limiter hiccup
 * can never lock everyone out of signing in.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    const now = new Date();
    const existing = await prisma.rateLimit.findUnique({ where: { key } });

    if (!existing || existing.expiresAt <= now) {
      const expiresAt = new Date(now.getTime() + windowMs);
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, expiresAt },
        update: { count: 1, expiresAt },
      });
      return { ok: true };
    }

    if (existing.count >= limit) {
      return {
        ok: false,
        retryAfterSec: Math.max(
          1,
          Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000),
        ),
      };
    }

    await prisma.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip") ?? "unknown";
}

/** Human "X minutes"/"X seconds" for a retry-after value, for error copy. */
export function retryAfterText(retryAfterSec: number): string {
  if (retryAfterSec >= 60) {
    const mins = Math.ceil(retryAfterSec / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}`;
}
