"use client";

import { useEffect } from "react";
import { subscribeUserPush } from "@/app/(app)/profile/push-actions";

/**
 * Invisible self-healing for push subscriptions, mounted once in the app
 * layout.
 *
 * The server's PushSubscription row can disappear while the browser still
 * holds a live subscription: dead endpoints are pruned after a 404/410, and
 * push services rotate endpoints on their own schedule. The profile toggle
 * only reads the browser side, so a user can look fully "set up" while the
 * server has nothing to send to — they silently stop receiving notifications.
 *
 * On the first page load of each session, re-upsert whatever subscription the
 * browser holds so that drift heals itself the next time the user opens the
 * app, instead of requiring them to notice and manually resubscribe.
 */
export function PushSync() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (sessionStorage.getItem("push-synced")) return;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (!sub) return;
        sessionStorage.setItem("push-synced", "1");
        return subscribeUserPush(
          JSON.parse(JSON.stringify(sub)),
          navigator.userAgent,
        );
      })
      .catch(() => undefined);
  }, []);
  return null;
}
