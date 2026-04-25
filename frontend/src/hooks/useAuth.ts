import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, setTokenRefreshCallback, tryRefreshToken, API_BASE_URL, setActiveChurchId } from "../lib/api";
import { normalizeIndianPhone } from "../types";
import { useI18n } from "../i18n";
import type { Notice } from "../types";

/** Church membership returned by OTP verify / my-churches */
export interface UserChurch {
  church_id: string;
  church_name: string;
  church_code?: string;
  logo_url?: string;
  role: string;
}

/** Local session type for JWT-based auth */
export interface LocalSession {
  access_token: string;
  user: { id: string; email: string; phone?: string };
}

export const SESSION_KEY = "shalom_jwt";

export function useAuth(setNotice: React.Dispatch<React.SetStateAction<Notice>>) {
  const navigate = useNavigate();
  const { t } = useI18n();

  // ── Auth state — start with null, refresh cookie will restore session ──
  const [session, setSession] = useState<LocalSession | null>(null);
  const [customAuth, setCustomAuth] = useState<{
    access_token: string;
    user: { id: string; phone: string; email: string };
  } | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busyKey, setBusyKey] = useState("");

  // ── Phone OTP state ──
  const [phoneInput, setPhoneInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpStep, setOtpStep] = useState<"phone" | "otp">("phone");

  // ── Bootstrap control — exposed so bootstrap effect in App can reset it ──
  const hasBootstrappedRef = useRef(false);
  const [bootstrapRetry, setBootstrapRetry] = useState(0);
  // M-9: Track in-flight requests to prevent duplicate concurrent submissions
  const inFlightRef = useRef<Set<string>>(new Set());

  // ── Multi-church state ──
  const [userChurches, setUserChurches] = useState<UserChurch[]>([]);
  const [showChurchPicker, setShowChurchPicker] = useState(false);

  // ── Derived values ──
  const token = customAuth?.access_token || session?.access_token || "";
  const userEmail = customAuth?.user?.email || session?.user?.email || "";
  const userPhone = customAuth?.user?.phone || session?.user?.phone || "";
  const isLoggedIn = Boolean(session || customAuth);

  // Wire token-refresh callback once
  useEffect(() => {
    setTokenRefreshCallback((newToken) => {
      setCustomAuth((prev) => (prev ? { ...prev, access_token: newToken } : prev));
      setSession((prev) => (prev ? { ...prev, access_token: newToken } : prev));
    });
  }, []);

  // Token is memory-only — no localStorage persistence (XSS protection)

  // Proactive token refresh (every 25 minutes — token TTL is 30m)
  useEffect(() => {
    if (!token) return;
    const TWENTY_FIVE_MIN_MS = 25 * 60 * 1000;
    const id = setInterval(() => {
      tryRefreshToken().catch(() => {});
    }, TWENTY_FIVE_MIN_MS);
    return () => clearInterval(id);
  }, [token]);

  // Background token refresh on mount — uses httpOnly refresh cookie to restore session
  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.access_token) {
          try {
            const payload = JSON.parse(atob(data.access_token.split(".")[1]));
            setSession({
              access_token: data.access_token,
              user: { id: payload.sub || "", email: payload.email || "", phone: payload.phone || "" },
            });
          } catch {
            /* decode failed */
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Auth actions ──

  const sendOtp = useCallback(async () => {
    const phone = normalizeIndianPhone(phoneInput);
    if (!phone || phone.length < 5) {
      setNotice({ tone: "error", text: t("auth.errorPhoneNumberRequired") });
      return;
    }
    setBusyKey("login");
    setNotice({ tone: "neutral", text: t("auth.sendingOtp") });
    try {
      await apiRequest("/api/otp/send", { method: "POST", body: { phone } });
      setOtpStep("otp");
      setNotice({ tone: "success", text: t("auth.otpSentSuccess") });
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("auth.errorSendOtpFailed") });
    } finally {
      setBusyKey("");
    }
  }, [phoneInput, setNotice, t]);

  const verifyOtp = useCallback(async () => {
    const phone = normalizeIndianPhone(phoneInput);
    const otp = otpInput.trim();
    if (!otp) {
      setNotice({ tone: "error", text: t("auth.errorOtpCodeRequired") });
      return;
    }
    setBusyKey("login");
    setNotice({ tone: "neutral", text: t("auth.verifying") });
    try {
      const result = await apiRequest<{
        access_token: string;
        user: { id: string; phone: string; email: string };
        churches?: UserChurch[];
      }>("/api/otp/verify", { method: "POST", body: { phone, otp } });
      hasBootstrappedRef.current = false;
      setSession({
        access_token: result.access_token,
        user: { id: result.user.id, email: result.user.email, phone: result.user.phone },
      });
      setCustomAuth(null);
      setOtpInput("");

      const churches = result.churches || [];
      setUserChurches(churches);

      if (churches.length > 1) {
        // Multiple churches — show picker instead of navigating to dashboard
        setShowChurchPicker(true);
        setNotice({ tone: "success", text: t("auth.successSignIn") });
      } else if (churches.length === 1) {
        // Single church — auto-select and proceed
        setActiveChurchId(churches[0].church_id);
        setNotice({ tone: "success", text: t("auth.successSignIn") });
        navigate("/dashboard", { replace: true });
        setBootstrapRetry((v) => v + 1);
      } else {
        // M-7: No churches — the bootstrap flow will handle showing join page
        setNotice({ tone: "success", text: t("auth.successSignIn") });
        navigate("/dashboard", { replace: true });
        setBootstrapRetry((v) => v + 1);
      }
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || "Verification failed." });
    } finally {
      setBusyKey("");
    }
  }, [phoneInput, otpInput, navigate, setNotice, t]);

  /** Called when user picks a church from the multi-church picker */
  const selectChurch = useCallback(async (churchId: string) => {
    // M-2: Re-validate token freshness before switching — prevents stale session
    if (token) await tryRefreshToken();
    setActiveChurchId(churchId);
    setShowChurchPicker(false);
    hasBootstrappedRef.current = false;
    setBootstrapRetry((v) => v + 1);
    navigate("/dashboard", { replace: true });
  }, [navigate, token]);

  /** Switch to a different church (from nav menu) — SH-011: forces stale state clear */
  const switchChurch = useCallback(async () => {
    if (!token) return;
    try {
      const result = await apiRequest<{ churches: UserChurch[] }>("/api/auth/my-churches", { token });
      setUserChurches(result.churches || []);
      if (result.churches.length > 1) {
        setShowChurchPicker(true);
        // M-10: Reset bootstrap + bump retry so stale church data is cleared immediately
        hasBootstrappedRef.current = false;
        setBootstrapRetry((v) => v + 1);
      }
    } catch (err: any) {
      setNotice({ tone: "error", text: "Failed to load churches" });
    }
  }, [token, setNotice]);

  const signOut = useCallback(async () => {
    setBusyKey("logout");
    try {
      if (token) {
        await apiRequest("/api/auth/refresh/revoke", { method: "POST", token }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    setBusyKey("");
    // Clear any legacy storage
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    setActiveChurchId(null);
    hasBootstrappedRef.current = false;
    setSession(null);
    setCustomAuth(null);
    // SH-012: Clear multi-church state to prevent stale data on next login
    setUserChurches([]);
    setShowChurchPicker(false);
    setNotice({ tone: "success", text: t("auth.signedOut") });
    setOtpStep("phone");
    setPhoneInput("");
    setOtpInput("");
    navigate("/signin", { replace: true });
  }, [token, navigate, setNotice, t]);

  const withAuthRequest = useCallback(
    async function withAuthRequest<T>(
      key: string,
      action: () => Promise<T>,
      successText?: string,
    ): Promise<T | null> {
      if (!token) {
        setNotice({ tone: "error", text: t("auth.pleaseSignInFirst") });
        return null;
      }
      // M-9: Prevent duplicate concurrent requests with same key
      if (inFlightRef.current.has(key)) return null;
      inFlightRef.current.add(key);
      setBusyKey(key);
      try {
        const result = await action();
        if (successText) setNotice({ tone: "success", text: successText });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : t("common.unexpectedError");
        const isNetworkError =
          message.toLowerCase().includes("network") || message.toLowerCase().includes("timed out");
        setNotice({
          tone: "error",
          text: isNetworkError ? `${message} ${t("common.checkConnection")}` : message,
        });
        return null;
      } finally {
        inFlightRef.current.delete(key);
        setBusyKey("");
      }
    },
    [token, t, setNotice],
  );

  return {
    // State
    session,
    setSession,
    customAuth,
    setCustomAuth,
    loadingSession,
    busyKey,
    setBusyKey,
    token,
    userEmail,
    userPhone,
    isLoggedIn,

    // OTP
    phoneInput,
    setPhoneInput,
    otpInput,
    setOtpInput,
    otpStep,
    setOtpStep,
    sendOtp,
    verifyOtp,

    // Multi-church
    userChurches,
    showChurchPicker,
    setShowChurchPicker,
    selectChurch,
    switchChurch,

    // Actions
    signOut,
    withAuthRequest,

    // Bootstrap control
    hasBootstrappedRef,
    bootstrapRetry,
    setBootstrapRetry,
  };
}
