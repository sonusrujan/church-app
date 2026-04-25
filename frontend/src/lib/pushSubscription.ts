import { apiRequest } from "./api";
import { isNativePlatform } from "./native";

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
 * Native (Capacitor) push subscription. Registers for APNs/FCM via the
 * @capacitor/push-notifications plugin and forwards the device token to the
 * backend. The service worker path is skipped entirely in the WebView.
 */
async function subscribeNative(token: string): Promise<boolean> {
  try {
    // Dynamic imports keep the web bundle clean when Capacitor isn't installed.
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { Capacitor } = await import("@capacitor/core");

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return false;

    return await new Promise<boolean>((resolve) => {
      const regListenerP = PushNotifications.addListener("registration", async (t: { value: string }) => {
        try {
          const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";
          await apiRequest<{ success: true }>("/api/push/subscribe-native", {
            method: "POST",
            token,
            body: { platform, token: t.value, app_id: "app.shalom.church" },
          });
          resolve(true);
        } catch {
          resolve(false);
        } finally {
          try { (await regListenerP).remove(); } catch { /* ignore */ }
        }
      });

      const errListenerP = PushNotifications.addListener("registrationError", async () => {
        resolve(false);
        try { (await errListenerP).remove(); } catch { /* ignore */ }
      });

      PushNotifications.register().catch(() => resolve(false));
    });
  } catch {
    return false;
  }
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
    if (await isNativePlatform()) {
      return await subscribeNative(token);
    }

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
