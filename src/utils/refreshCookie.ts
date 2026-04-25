import type { CookieOptions } from "express";

const REFRESH_COOKIE_PATH = "/api/auth/refresh";
const LEGACY_REFRESH_COOKIE_PATH = "/api/auth";

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

// In production, the frontend (web/PWA/Capacitor) is typically served from a
// different origin than the API. `sameSite: "lax"` blocks the refresh cookie
// on cross-site XHR, which is what was signing users out on every reload.
// `sameSite: "none"` requires `secure: true`. In development we keep "lax"
// so http://localhost still works.
export function refreshCookieOptions(extra?: Partial<CookieOptions>): CookieOptions {
  const isProduction = isProductionEnv();
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: REFRESH_COOKIE_PATH,
    ...extra,
  };
}

export function clearRefreshCookieOptions(): CookieOptions {
  const isProduction = isProductionEnv();
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: REFRESH_COOKIE_PATH,
  };
}

// Used to clear stale cookies that may be sitting at the legacy path
// from a prior deploy.
export function clearLegacyRefreshCookieOptions(): CookieOptions {
  const isProduction = isProductionEnv();
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: LEGACY_REFRESH_COOKIE_PATH,
  };
}
