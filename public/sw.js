self.addEventListener("push", function (event) {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: data.icon || "/icon.png",
    badge: "/badge.png",
    vibrate: [100, 50, 100],
    data: { url: data.url || "/home" },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Push services rotate subscriptions on their own schedule. Without this
// handler the server keeps pushing to the dead old endpoint (and eventually
// prunes it), while the browser silently holds a new one the server has never
// seen — the user stops receiving notifications with no visible sign anything
// broke. Resubscribe with the same key and tell the server which row to swap.
self.addEventListener("pushsubscriptionchange", function (event) {
  const old = event.oldSubscription;
  if (!old || !old.options) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe(old.options)
      .then((newSub) =>
        fetch("/api/push/resubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oldEndpoint: old.endpoint,
            subscription: newSub.toJSON(),
          }),
        }),
      )
      .catch(() => undefined),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const target = event.notification.data?.url || "/home";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab on the target if one is open.
        for (const client of clientList) {
          if (client.url.includes(target) && "focus" in client) {
            return client.focus();
          }
        }
        return clients.openWindow(target);
      }),
  );
});
