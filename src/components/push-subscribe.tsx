"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  subscribeUserPush,
  unsubscribeUserPush,
} from "@/app/(app)/profile/push-actions";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushSubscribe() {
  const [isSupported, setIsSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Mount-time browser/capability detection: this must run in an effect, not
    // a lazy initializer, because the server has no `navigator` and rendering a
    // different value on the client would cause a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsIOS(
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
        !("MSStream" in window),
    );
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);
    if ("serviceWorker" in navigator && "PushManager" in window) {
      setIsSupported(true);
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setSubscribed(Boolean(sub)))
        .catch(() => undefined);
    }
  }, []);

  async function subscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        toast.error("Push isn't configured on the server yet.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const serialized = JSON.parse(JSON.stringify(sub));
      const res = await subscribeUserPush(serialized, navigator.userAgent);
      if (res?.error) toast.error(res.error);
      else {
        setSubscribed(true);
        toast.success("Notifications on — we'll ping you about games.");
      }
    } catch {
      toast.error("Couldn't enable notifications. Did you allow permission?");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribeUserPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notifications off.");
    } finally {
      setBusy(false);
    }
  }

  if (!isSupported) {
    if (isIOS && !isStandalone) {
      return (
        <p className="text-sm text-muted-foreground">
          To get notifications on iPhone, tap the Share button and choose “Add
          to Home Screen”, then open the app from your home screen.
        </p>
      );
    }
    return (
      <p className="text-sm text-muted-foreground">
        Push notifications aren&apos;t supported in this browser.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {subscribed ? (
        <Button variant="outline" onClick={unsubscribe} disabled={busy}>
          <BellOff className="mr-2 h-4 w-4" />
          Turn off notifications
        </Button>
      ) : (
        <Button onClick={subscribe} disabled={busy}>
          <Bell className="mr-2 h-4 w-4" />
          Enable notifications
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Get pinged when a game opens, teams are picked, you&apos;re booking, or
        someone drops out.
      </p>
    </div>
  );
}
