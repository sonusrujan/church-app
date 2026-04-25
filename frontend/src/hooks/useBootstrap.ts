import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest, tryRefreshToken } from "../lib/api";
import { useI18n } from "../i18n";
import type {
  AuthContextData,
  ChurchRow,
  AdminRow,
  PastorRow,
  EventRow,
  NotificationRow,
  IncomeSummary,
  MemberDashboard,
  PaymentConfigResponse,
  Notice,
} from "../types";

interface UseBootstrapDeps {
  token: string;
  userEmail: string;
  userPhone: string;
  setBusyKey: React.Dispatch<React.SetStateAction<string>>;
  setNotice: React.Dispatch<React.SetStateAction<Notice>>;
  hasBootstrappedRef: React.MutableRefObject<boolean>;
  bootstrapRetry: number;
  setBootstrapRetry: React.Dispatch<React.SetStateAction<number>>;
  setSession: React.Dispatch<React.SetStateAction<any>>;
  setCustomAuth: React.Dispatch<React.SetStateAction<any>>;
  withAuthRequest: <T>(key: string, action: () => Promise<T>, successText?: string) => Promise<T | null>;
}

export function useBootstrap(deps: UseBootstrapDeps) {
  const {
    token,
    setBusyKey,
    setNotice,
    hasBootstrappedRef,
    bootstrapRetry,
    setBootstrapRetry,
    setSession,
    setCustomAuth,
    withAuthRequest,
  } = deps;

  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  // ── State managed by bootstrap ──
  const [authContext, setAuthContext] = useState<AuthContextData | null>(null);
  const [memberDashboard, setMemberDashboard] = useState<MemberDashboard | null>(null);
  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [pastors, setPastors] = useState<PastorRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [incomeSummary, setIncomeSummary] = useState<IncomeSummary | null>(null);
  const [adminCounts, setAdminCounts] = useState<{
    membership_requests: number;
    family_requests: number;
    cancellation_requests: number;
    account_deletion_requests: number;
    refund_requests: number;
    prayer_requests: number;
    events: number;
    notifications: number;
  } | null>(null);

  // ── UI state ──
  const [bootstrapError, setBootstrapError] = useState("");
  const [showJoinPage, setShowJoinPage] = useState(false);
  const [familyHeadName, setFamilyHeadName] = useState("");

  // ── Payment state ──
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [paymentConfigError, setPaymentConfigError] = useState("");
  const paymentInProgressRef = useRef(false);

  // ── Banners ──
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // ── Derived ──
  const isSuperAdmin = Boolean(authContext?.is_super_admin);
  const isAdminUser = Boolean(authContext && (authContext.profile.role === "admin" || isSuperAdmin));
  const isChurchAdmin = Boolean(isAdminUser && !isSuperAdmin);
  const isMemberOnlyUser = Boolean(authContext && !isAdminUser);

  // ── Data loaders ──

  async function forceLogoutUnregistered() {
    setAuthContext(null);
    setMemberDashboard(null);
    setChurches([]);
    setAdmins([]);
    setShowJoinPage(true);
    setNotice({ tone: "neutral", text: t("auth.accountNotRegistered") });
  }

  async function loadContext() {
    const context = await withAuthRequest("context", () =>
      apiRequest<AuthContextData>("/api/auth/me", { token }),
    );
    if (!context) return null;
    setAuthContext(context);
    if (!context.is_super_admin) {
      try {
        const paymentConfig = await apiRequest<PaymentConfigResponse>("/api/payments/config", { token });
        setPaymentsEnabled(Boolean(paymentConfig.payments_enabled));
        setPaymentConfigError(
          paymentConfig.payments_enabled ? "" : paymentConfig.reason || t("auth.paymentsDisabledFallback"),
        );
      } catch (error) {
        setPaymentsEnabled(false);
        const message = error instanceof Error ? error.message : t("auth.errorPaymentConfigLoadFailed");
        setPaymentConfigError(message);
        setNotice({ tone: "error", text: t("auth.paymentConfigCheckFailed", { message }) });
      }
    } else {
      setPaymentsEnabled(false);
      setPaymentConfigError("");
    }
    return context;
  }

  async function refreshMemberDashboard(silent = true) {
    if (!token) return null;
    try {
      const dashboard = await apiRequest<MemberDashboard>("/api/auth/member-dashboard", { token });
      setMemberDashboard(dashboard);
      if (dashboard._warnings?.length) {
        setNotice({ tone: "error", text: t("auth.dataIncomplete") + dashboard._warnings.join(" ") });
      } else if (!silent) {
        setNotice({ tone: "success", text: t("auth.dashboardRefreshed") });
      }
      return dashboard;
    } catch (error) {
      const message = error instanceof Error ? error.message : t("auth.errorMemberDashboardLoadFailed");
      if (message.toLowerCase().includes("not registered")) {
        await forceLogoutUnregistered();
        return null;
      }
      if (!silent) setNotice({ tone: "error", text: message });
      return null;
    }
  }

  async function loadChurches() {
    const endpoint = isSuperAdmin ? "/api/churches/summary" : "/api/churches/list";
    const rows = await withAuthRequest("churches", () =>
      apiRequest<ChurchRow[]>(endpoint, { token }),
      "Church list refreshed.",
    );
    if (rows) setChurches(rows);
  }

  async function loadAdmins() {
    if (!isSuperAdmin) return;
    const rows = await withAuthRequest("admins", () =>
      apiRequest<AdminRow[]>("/api/admins/list", { token }),
      "Admin list refreshed.",
    );
    if (rows) setAdmins(rows);
  }

  async function loadPastors(overrideChurchId?: string) {
    const scopedChurchId = overrideChurchId || (isSuperAdmin ? "" : authContext?.auth.church_id || "");
    if (!scopedChurchId) {
      setPastors([]);
      return;
    }
    const endpoint = isSuperAdmin
      ? `/api/pastors/list?church_id=${encodeURIComponent(scopedChurchId)}`
      : "/api/pastors/list";
    const rows = await withAuthRequest("pastors", () =>
      apiRequest<PastorRow[]>(endpoint, { token }),
      "Pastors refreshed.",
    );
    if (!rows) return;
    setPastors(rows);
  }

  async function loadEventsAndNotifications() {
    const scopedChurchId = authContext?.auth.church_id || "";
    if (isSuperAdmin && !scopedChurchId) {
      setEvents([]);
      setNotifications([]);
      return;
    }
    const [eventRows, notificationRows] = await Promise.all([
      withAuthRequest("events", () => apiRequest<EventRow[]>("/api/engagement/events", { token })),
      withAuthRequest("notifications", () =>
        apiRequest<NotificationRow[]>("/api/engagement/notifications", { token }),
      ),
    ]);
    if (eventRows) setEvents(eventRows);
    if (notificationRows) setNotifications(notificationRows);
  }

  async function loadIncomeSummary(overrideChurchId?: string) {
    if (!isAdminUser) return;
    const scopedChurchId = overrideChurchId || authContext?.auth.church_id || "";
    if (isSuperAdmin && !scopedChurchId) {
      setIncomeSummary(null);
      return;
    }
    const query = overrideChurchId ? `?church_id=${encodeURIComponent(overrideChurchId)}` : "";
    const summary = await withAuthRequest("income", () =>
      apiRequest<IncomeSummary>(`/api/admins/income${query}`, { token }),
      "Income summary refreshed.",
    );
    if (summary) setIncomeSummary(summary);
  }

  async function loadAdminCounts() {
    if (!isAdminUser) return;
    const scopedChurchId = authContext?.auth.church_id || "";
    if (isSuperAdmin && !scopedChurchId) {
      setAdminCounts(null);
      return;
    }
    try {
      const counts = await apiRequest<{
        membership_requests: number;
        family_requests: number;
        cancellation_requests: number;
        account_deletion_requests: number;
        refund_requests: number;
        prayer_requests: number;
        events: number;
        notifications: number;
      }>("/api/engagement/admin-counts", { token });
      if (counts) setAdminCounts(counts);
    } catch {
      /* silent fail for badge counts */
    }
  }

  // ── Bootstrap effect ──
  useEffect(() => {
    if (!token) {
      hasBootstrappedRef.current = false;
      setAuthContext(null);
      setMemberDashboard(null);
      setChurches([]);
      setAdmins([]);
      setPaymentsEnabled(false);
      setPaymentConfigError("");
      setBootstrapError("");
      setShowJoinPage(false);
      return;
    }
    if (hasBootstrappedRef.current) return;
    let cancelled = false;

    async function bootstrap() {
      setBusyKey("bootstrap");
      setBootstrapError("");
      try {
        const context = await apiRequest<AuthContextData>("/api/auth/me", { token });
        if (cancelled) return;
        setAuthContext(context);
        if (context.is_super_admin) {
          const churchRows = await apiRequest<ChurchRow[]>("/api/churches/summary", { token });
          if (cancelled) return;
          setChurches(churchRows);
          setPaymentsEnabled(false);
          setPaymentConfigError("");
          const adminRows = await apiRequest<AdminRow[]>("/api/admins/list", { token });
          if (!cancelled) setAdmins(adminRows);
          setNotice({ tone: "success", text: t("auth.adminWorkspaceReady") });
        } else {
          let paymentConfig: PaymentConfigResponse = { payments_enabled: false, key_id: "" };
          let paymentConfigLoadError = "";
          try {
            paymentConfig = await apiRequest<PaymentConfigResponse>("/api/payments/config", { token });
          } catch (error) {
            paymentConfig = { payments_enabled: false, key_id: "" };
            const message = error instanceof Error ? error.message : t("auth.errorPaymentConfigLoadFailed");
            paymentConfigLoadError = message;
            if (!cancelled)
              setNotice({ tone: "error", text: t("auth.paymentConfigCheckFailed", { message }) });
          }
          if (cancelled) return;
          setPaymentsEnabled(Boolean(paymentConfig.payments_enabled));
          setPaymentConfigError(
            paymentConfigLoadError ||
              (paymentConfig.payments_enabled ? "" : paymentConfig.reason || t("auth.paymentsDisabledFallback")),
          );
          const dashboard = await refreshMemberDashboard(true);
          if (cancelled) return;
          if (dashboard) setMemberDashboard(dashboard);
          if (!paymentConfigLoadError)
            setNotice({ tone: "success", text: t("auth.memberDashboardReady") });
        }
        if (!cancelled) {
          hasBootstrappedRef.current = true;
          if (location.pathname === "/signin") navigate("/dashboard", { replace: true });
          if (typeof Notification !== "undefined") {
            if (Notification.permission === "granted") {
              import("../lib/pushSubscription")
                .then(({ subscribeToPush }) => subscribeToPush(token))
                .catch(() => {});
            } else if (Notification.permission === "default") {
              setShowPushBanner(true);
            }
          }
          const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
          const isStandalone =
            ("standalone" in navigator && (navigator as any).standalone) ||
            window.matchMedia("(display-mode: standalone)").matches;
          if (isIos && !isStandalone && !sessionStorage.getItem("ios_install_dismissed")) {
            setShowInstallBanner(true);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t("auth.errorSessionInitFailed");
        if (
          message.toLowerCase().includes("family_dependent") ||
          message.toLowerCase().includes("managed by a family member")
        ) {
          if (!cancelled) {
            const headName = message.includes(":") ? message.split(":").slice(1).join(":").trim() : "";
            setFamilyHeadName(headName);
            setBootstrapError("family_dependent");
            setNotice({ tone: "error", text: t("auth.familyMemberBlocked") });
          }
          return;
        }
        if (message.toLowerCase().includes("not registered")) {
          await forceLogoutUnregistered();
          return;
        }
        if (message.toLowerCase().includes("session expired")) {
          const refreshedToken = await tryRefreshToken();
          if (!cancelled && refreshedToken) {
            hasBootstrappedRef.current = false;
            setSession((prev: any) =>
              prev
                ? { ...prev, access_token: refreshedToken }
                : { access_token: refreshedToken, user: { id: "", email: "", phone: "" } },
            );
            setCustomAuth(null);
            setBootstrapRetry((v: number) => v + 1);
            return;
          }
          if (!cancelled) {
            setSession(null);
            setCustomAuth(null);
            setAuthContext(null);
          }
          return;
        }
        if (!cancelled) {
          const userMessage = t("auth.workspaceLoadError");
          setBootstrapError(userMessage);
          setNotice({ tone: "error", text: userMessage });
        }
      } finally {
        if (!cancelled) setBusyKey("");
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [token, bootstrapRetry]);

  // Load pastors, events, income on auth change
  useEffect(() => {
    if (!token || !authContext) return;
    void loadPastors();
    void loadEventsAndNotifications();
    if (isAdminUser) {
      void loadIncomeSummary();
      void loadAdminCounts();
    }
  }, [token, authContext?.profile.role, authContext?.auth.church_id, isSuperAdmin, isAdminUser]);

  // Poll admin counts every 60s for live badge updates (M-9: skip when tab is hidden)
  useEffect(() => {
    if (!token || !isAdminUser) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void loadAdminCounts();
    }, 60_000);
    return () => clearInterval(interval);
  }, [token, isAdminUser]);

  return {
    // Context / profile
    authContext,
    setAuthContext,
    isSuperAdmin,
    isAdminUser,
    isChurchAdmin,
    isMemberOnlyUser,

    // Dashboard
    memberDashboard,
    setMemberDashboard,
    refreshMemberDashboard,

    // Collections
    churches,
    admins,
    pastors,
    setPastors,
    events,
    notifications,
    incomeSummary,
    adminCounts,
    loadAdminCounts,

    // Loaders
    loadChurches,
    loadAdmins,
    loadPastors,
    loadEventsAndNotifications,
    loadIncomeSummary,
    loadContext,

    // Payment
    paymentsEnabled,
    paymentConfigError,
    paymentInProgressRef,

    // Banners
    showPushBanner,
    setShowPushBanner,
    showInstallBanner,
    setShowInstallBanner,

    // Bootstrap UI
    bootstrapError,
    setBootstrapError,
    showJoinPage,
    setShowJoinPage,
    familyHeadName,
  };
}
