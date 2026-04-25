import { apiRequest } from "./api";

/**
 * Check the current push notification status.
 * Returns: "subscribed" | "prompt" | "denied" | "unsupported"
 */
export function getPushStatus(): "subscribed" | "prompt" | "denied" | "unsupported" {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "prompt"; // granted but might not be subscribed yet
  return "prompt";
}

/**
 * Check if user already has an active push subscription on this browser.
 */
export async function isSubscribed(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}

/**
 * Subscribe the current browser to push notifications.
 * Must be called from a user gesture (click handler) for the permission prompt to appear.
 */
export async function subscribeToPush(token: string): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return false;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    // Fetch VAPID public key from backend
    const { publicKey } = await apiRequest<{ publicKey: string }>("/api/push/vapid-public-key");
    if (!publicKey) return false;

    const reg = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await reg.pushManager.getSubscription();

    // If subscription exists but uses a different applicationServerKey, unsubscribe first
    if (subscription) {
      const existingKey = subscription.options?.applicationServerKey;
      if (existingKey) {
        const existingKeyB64 = arrayBufferToBase64Url(existingKey);
        if (existingKeyB64 !== publicKey) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
    }

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }

    const subJson = subscription.toJSON();
    await apiRequest("/api/push/subscribe", {
      method: "POST",
      token,
      body: {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
      },
    });

    return true;
  } catch (err) {
    console.warn("Push subscription failed:", err);
    return false;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(token: string): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;

    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return true;

    await apiRequest("/api/push/unsubscribe", {
      method: "POST",
      token,
      body: { endpoint: subscription.endpoint },
    });

    await subscription.unsubscribe();
    return true;
  } catch (err) {
    console.warn("Push unsubscribe failed:", err);
    return false;
  }
}

// ── Helpers ──

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
