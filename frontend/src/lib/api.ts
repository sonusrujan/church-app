export const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

// ── Active church context ──
let _activeChurchId: string | null = null;

/** Set the active church ID — sent as X-Church-Id header on all API requests */
export function setActiveChurchId(churchId: string | null) {
  _activeChurchId = churchId;
  if (churchId) {
    localStorage.setItem("active_church_id", churchId);
  } else {
    localStorage.removeItem("active_church_id");
  }
}

/** Get the current active church ID */
export function getActiveChurchId(): string | null {
  if (_activeChurchId) return _activeChurchId;
  // 7.3: Use localStorage so church context is shared across tabs
  const stored = localStorage.getItem("active_church_id");
  if (stored) _activeChurchId = stored;
  return _activeChurchId;
}

// ── Token refresh plumbing ──
let _onTokenRefreshed: ((newToken: string) => void) | null = null;
let _onAuthFailure: (() => void) | null = null;
let _refreshPromise: Promise<string | null> | null = null;

/** App.tsx calls this once to wire up the token update callback */
export function setTokenRefreshCallback(cb: (newToken: string) => void) {
  _onTokenRefreshed = cb;
}

/** Called when auth is definitively lost (refresh failed) — clears client session */
export function setAuthFailureCallback(cb: () => void) {
  _onAuthFailure = cb;
}

export async function tryRefreshToken(): Promise<string | null> {
  // Deduplicate concurrent refresh calls
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const refreshHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      };
      const cid = getActiveChurchId();
      if (cid) refreshHeaders["X-Church-Id"] = cid;
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: refreshHeaders,
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json();
      const newToken = data?.access_token as string | undefined;
      if (newToken && _onTokenRefreshed) _onTokenRefreshed(newToken);
      return newToken || null;
    } catch {
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  token?: string;
  body?: unknown;
  /** Request timeout in ms (default 30 000) */
  timeout?: number;
};

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { token, body, headers, timeout = 30_000, ...rest } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");
  requestHeaders.set("X-Requested-With", "XMLHttpRequest");

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  // Send active church context on every authenticated request
  const churchId = getActiveChurchId();
  if (churchId) {
    requestHeaders.set("X-Church-Id", churchId);
  }

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
      credentials: "include",
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Please check your connection and try again.");
    }
    if (err instanceof TypeError) {
      throw new Error("Network error. Please check your internet connection.");
    }
    throw new Error("An unexpected error occurred while connecting to the server.");
  } finally {
    if (timer) clearTimeout(timer);
  }

  let payload: unknown;
  try {
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    payload = isJson ? await response.json() : await response.text();
  } catch {
    throw new Error(`Server returned an unreadable response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : (payload as Record<string, unknown>)?.error as string ||
          (payload as Record<string, unknown>)?.message as string ||
          `Request failed (HTTP ${response.status})`;

    if (response.status === 401) {
      // Attempt silent token refresh
      const newToken = await tryRefreshToken();
      if (newToken) {
        // Retry the original request with the fresh token
        const retryHeaders = new Headers(requestHeaders);
        retryHeaders.set("Authorization", `Bearer ${newToken}`);
        const retryRes = await fetch(`${API_BASE_URL}${path}`, {
          ...rest,
          headers: retryHeaders,
          body: requestBody,
          credentials: "include",
        });
        if (retryRes.ok) {
          const ct = retryRes.headers.get("content-type") || "";
          return (ct.includes("application/json") ? await retryRes.json() : await retryRes.text()) as T;
        }
      }
      if (_onAuthFailure) _onAuthFailure();
      throw new ApiError("Session expired. Please sign in again.", response.status, payload);
    }
    if (response.status === 402) {
      // Church inactive or trial expired — surface the server message
      throw new ApiError(message || "Your church subscription is inactive. Please contact support.", response.status, payload);
    }
    if (response.status === 403) {
      throw new ApiError(message || "You do not have permission to perform this action.", response.status, payload);
    }
    if (response.status === 404) {
      throw new ApiError(message || "The requested resource was not found.", response.status, payload);
    }
    if (response.status >= 500) {
      throw new ApiError("Server error. Please try again later.", response.status, payload);
    }

    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

// ── Blob request (PDF receipts, CSV exports) ──

type ApiBlobOptions = {
  token?: string;
  accept?: string;
  timeout?: number;
  headers?: HeadersInit;
};

export async function apiBlobRequest(
  path: string,
  options: ApiBlobOptions = {},
): Promise<Blob> {
  const { token, accept = "application/pdf", timeout = 30_000, headers } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", accept);
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  const churchId = getActiveChurchId();
  if (churchId) requestHeaders.set("X-Church-Id", churchId);

  const controller = new AbortController();
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers: requestHeaders,
      signal: controller.signal,
      credentials: "include",
    });

    if (!response.ok) {
      if (response.status === 401) {
        const newToken = await tryRefreshToken();
        if (newToken) {
          const retryHeaders = new Headers(requestHeaders);
          retryHeaders.set("Authorization", `Bearer ${newToken}`);
          const retryRes = await fetch(`${API_BASE_URL}${path}`, {
            method: "GET",
            headers: retryHeaders,
            credentials: "include",
          });
          if (retryRes.ok) return retryRes.blob();
        }
        throw new Error("Session expired. Please sign in again.");
      }
      throw new Error(`Request failed (HTTP ${response.status})`);
    }
    return response.blob();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out.");
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── FormData upload (images, media) ──

type ApiUploadOptions = {
  token?: string;
  timeout?: number;
};

export async function apiUploadRequest<T = Record<string, unknown>>(
  path: string,
  formData: FormData,
  options: ApiUploadOptions = {},
): Promise<T> {
  const { token, timeout = 60_000 } = options;

  const requestHeaders = new Headers();
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  const churchId = getActiveChurchId();
  if (churchId) requestHeaders.set("X-Church-Id", churchId);
  // Do NOT set Content-Type — browser sets multipart boundary automatically

  const controller = new AbortController();
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    let response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: requestHeaders,
      body: formData,
      signal: controller.signal,
      credentials: "include",
    });

    if (response.status === 401) {
      const newToken = await tryRefreshToken();
      if (newToken) {
        const retryHeaders = new Headers(requestHeaders);
        retryHeaders.set("Authorization", `Bearer ${newToken}`);
        response = await fetch(`${API_BASE_URL}${path}`, {
          method: "POST",
          headers: retryHeaders,
          body: formData,
          credentials: "include",
        });
      }
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || `Upload failed (HTTP ${response.status})`);
    }
    return data as T;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Upload timed out.");
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
