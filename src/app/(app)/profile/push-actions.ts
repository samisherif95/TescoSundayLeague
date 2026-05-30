"use server";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/session";

export type SerializedSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** Store (or refresh) a device's push subscription for the current user. */
export async function subscribeUserPush(
  sub: SerializedSubscription,
  userAgent?: string,
) {
  const user = await requireOnboardedUser();
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { error: "Invalid subscription" };
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: {
      userId: user.id,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent,
    },
    create: {
      userId: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent,
    },
  });
  return { ok: true as const };
}

/** Remove a device's push subscription (scoped to the current user). */
export async function unsubscribeUserPush(endpoint: string) {
  const user = await requireOnboardedUser();
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: user.id },
  });
  return { ok: true as const };
}
