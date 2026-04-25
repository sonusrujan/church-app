export const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:4000";

// ── Token refresh plumbing ──
let _onTokenRefreshed: ((newToken: string) => void) | null = null;
let _refreshPromise: Promise<string | null> | null = null;

/** App.tsx calls this once to wire up the token update callback */
export function setTokenRefreshCallback(cb: (newToken: string) => void) {
  _onTokenRefreshed = cb;
}

export async function tryRefreshToken(): Promise<string | null> {
  // Deduplicate concurrent refresh calls
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
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
      throw new Error("Session expired. Please sign in again.");
    }
    if (response.status === 402) {
      // Church inactive or trial expired — surface the server message
      throw new Error(message || "Your church subscription is inactive. Please contact support.");
    }
    if (response.status === 403) {
      throw new Error(message || "You do not have permission to perform this action.");
    }
    if (response.status === 404) {
      throw new Error(message || "The requested resource was not found.");
    }
    if (response.status >= 500) {
      throw new Error("Server error. Please try again later.");
    }

    throw new Error(message);
  }

  return payload as T;
}
