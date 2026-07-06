import webpush from "web-push";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

let configured = false;

/** Lazily wire up VAPID. Returns false (with a warning) if keys are absent. */
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;
  webpush.setVapidDetails(
    env.vapidSubject,
    env.vapidPublicKey,
    env.vapidPrivateKey,
  );
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Relative path to open when the notification is clicked, e.g. /games/abc. */
  url?: string;
};

// A push send failure is transient — worth retrying — when the push service is
// throttling us (429) or momentarily down (5xx), or when there's no status at
// all (the connection dropped before a response). 404/410 mean the
// subscription is gone for good, and other 4xx (401/403 bad VAPID signature,
// 413 oversized payload) are configuration bugs a retry can't fix.
function isTransient(err: unknown): boolean {
  const status = (err as { statusCode?: number })?.statusCode;
  if (typeof status !== "number") return true;
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendWithRetry(
  sub: { endpoint: string; p256dh: string; auth: string },
  body: string,
) {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
    } catch (err) {
      if (attempt < maxAttempts && isTransient(err)) {
        await sleep(2 ** (attempt - 1) * 500); // 500ms, then 1s
        continue;
      }
      throw err;
    }
  }
}

/**
 * Send a web-push notification to every device subscribed by the given users.
 * No-ops (with a warning) when VAPID keys aren't configured, so server actions
 * never throw just because push isn't set up. Dead endpoints (404/410) are
 * pruned automatically; transient push-service failures are retried; anything
 * else is logged — these sends are otherwise fire-and-forget, and a silent
 * drop leaves "I never got the notification" impossible to diagnose.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return;
  if (!ensureConfigured()) {
    console.warn("VAPID keys missing — push not sent:", payload.title);
    return;
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((s) => sendWithRetry(s, body)),
  );

  const stale: string[] = [];
  results.forEach((r, i) => {
    if (r.status !== "rejected") return;
    const status = (r.reason as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      stale.push(subs[i].endpoint);
      return;
    }
    // 401/403 in particular means the stored subscription was created under
    // different VAPID keys than the server is signing with now — every send
    // fails until the device resubscribes, so make that visible.
    console.error(
      `Push "${payload.title}" to user ${subs[i].userId} failed` +
        ` (status ${status ?? "network"})` +
        (status === 401 || status === 403
          ? " — VAPID key mismatch? Device must resubscribe:"
          : ":"),
      r.reason,
    );
  });
  if (stale.length > 0) {
    await prisma.pushSubscription
      .deleteMany({ where: { endpoint: { in: stale } } })
      .catch(() => undefined);
  }
}
