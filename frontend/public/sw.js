// __BUILD_TIMESTAMP__ is replaced during build (see vite.config.ts sw-version plugin)
const CACHE_VERSION = "__BUILD_TIMESTAMP__";
const CACHE_NAME = `shalom-v${CACHE_VERSION}`;
const PRECACHE_URLS = ["/", "/index.html", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Listen for skipWaiting message from the app
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Push Notification Handler ──
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Shalom", body: event.data.text() };
  }

  const title = payload.title || "Shalom";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    data: { url: payload.url || "/" },
    vibrate: [100, 50, 100],
    // Use unique tag per notification so multiple notifications don't collapse into one
    tag: payload.tag || `shalom-${Date.now()}`,
    renotify: true,
    // iOS/Safari: require interaction so it stays visible longer
    requireInteraction: true,
    timestamp: payload.timestamp || Date.now(),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click Handler ──
// Uses a cache entry as a reliable cross-context signal for iOS PWA.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  const fullUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    // 1. Store the target URL in a cache entry the app will read on resume/open
    caches.open("notification-click").then((cache) =>
      cache.put("/_notification_url", new Response(url))
    ).then(() =>
      self.clients.matchAll({ type: "window", includeUncontrolled: true })
    ).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          // 2. Also send postMessage for already-active windows
          client.postMessage({ type: "NAVIGATE", url });
          try { return client.focus(); } catch (e) { /* focus may not be supported */ }
          return;
        }
      }
      // 3. No existing window — open one
      return self.clients.openWindow(fullUrl);
    })
  );
});

// ── Push Subscription Change Handler ──
// Fires when the browser rotates push keys or the subscription expires.
// Re-subscribes automatically and syncs the new endpoint to the backend.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription;
        const newSubOptions = oldSub
          ? { userVisibleOnly: true, applicationServerKey: oldSub.options?.applicationServerKey }
          : { userVisibleOnly: true };

        const newSub = await self.registration.pushManager.subscribe(newSubOptions);
        const subJson = newSub.toJSON();

        // Notify backend of the new subscription (unauthenticated — backend matches by old endpoint)
        await fetch("/api/push/resubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oldEndpoint: oldSub?.endpoint || null,
            newEndpoint: subJson.endpoint,
            keys: { p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth },
          }),
        });
      } catch (err) {
        // Best-effort — if this fails the user will re-subscribe on next app visit
        console.warn("pushsubscriptionchange: re-subscribe failed", err);
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET and API requests
  if (request.method !== "GET" || request.url.includes("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/offline.html"))
      )
  );
});
