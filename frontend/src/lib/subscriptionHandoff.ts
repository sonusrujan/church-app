import { apiRequest, API_BASE_URL } from "./api";
import { isNativePlatform, openExternalBrowser, closeInAppBrowser } from "./native";

/**
 * Web origin where /subscribe/manage lives. In production this is the public
 * website; in dev it falls back to the same host as the API.
 */
function webOrigin(): string {
  if (import.meta.env.VITE_WEB_ORIGIN) return String(import.meta.env.VITE_WEB_ORIGIN);
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return window.location.origin;
  }
}

/**
 * Start the native → web subscription-management handoff.
 * Mints a single-use token, opens the external browser at
 * `${origin}/subscribe/manage?t=<token>`, and resolves once the browser opens.
 * The app relies on the appUrlOpen listener to be notified of payment success.
 */
export async function startManageSubscriptionHandoff(accessToken: string): Promise<void> {
  const { token } = await apiRequest<{ token: string; expires_at: string; purpose: string }>(
    "/api/auth/web-handoff/mint",
    {
      method: "POST",
      token: accessToken,
      body: { purpose: "manage_subscription" },
    },
  );

  const url = `${webOrigin()}/subscribe/manage?t=${encodeURIComponent(token)}`;

  if (await isNativePlatform()) {
    await openExternalBrowser(url);
  } else {
    // On the web app itself (admin already on the site), navigate in-place.
    window.location.assign(url);
  }
}

/**
 * Called from App.tsx on mount to catch the `shalom://subscription/return`
 * deep link when the user returns from the external browser. Returns a
 * disposer to be called on unmount.
 */
export async function installSubscriptionReturnListener(
  onSuccess: () => void,
): Promise<() => void> {
  if (!(await isNativePlatform())) return () => {};

  const { onAppUrlOpen } = await import("./native");
  return onAppUrlOpen((url) => {
    if (url.hostname !== "subscription" && !url.pathname.startsWith("/subscription")) return;
    const looksLikeReturn = url.pathname === "/return" || url.href.endsWith("/return");
    if (!looksLikeReturn) return;
    closeInAppBrowser().catch(() => {});
    onSuccess();
  });
}
