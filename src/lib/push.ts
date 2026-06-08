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

/**
 * Send a web-push notification to every device subscribed by the given users.
 * No-ops (with a warning) when VAPID keys aren't configured, so server actions
 * never throw just because push isn't set up. Dead endpoints (404/410) are
 * pruned automatically.
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
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      ),
    ),
  );

  const stale: string[] = [];
  results.forEach((r, i) => {
    if (
      r.status === "rejected" &&
      (r.reason?.statusCode === 404 || r.reason?.statusCode === 410)
    ) {
      stale.push(subs[i].endpoint);
    }
  });
  if (stale.length > 0) {
    await prisma.pushSubscription
      .deleteMany({ where: { endpoint: { in: stale } } })
      .catch(() => undefined);
  }
}
