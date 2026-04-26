import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  HandHeart,
  Heart,
  History,
  Home,
  LayoutDashboard,
  Menu,
  Settings,
  Shield,
  UserRound,
  X,
} from "lucide-react";
import shalomLogo from "./assets/shalom-logo.png";
import AppContext from "./context/AppContext";
import type { Notice } from "./types";
import { initials } from "./types";
import { useAuth } from "./hooks/useAuth";
import { useBootstrap } from "./hooks/useBootstrap";
import { useConfirmDialog } from "./hooks/useConfirmDialog";
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const AdminConsolePage = lazy(() => import("./pages/AdminConsolePage"));
const JoinPage = lazy(() => import("./pages/JoinPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const PublicDonationPage = lazy(() => import("./pages/PublicDonationPage"));
const DonationCheckoutPage = lazy(() => import("./pages/DonationCheckoutPage"));
const PrayerRequestPage = lazy(() => import("./pages/PrayerRequestPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const UserHomePage = lazy(() => import("./pages/UserHomePage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsAndConditionsPage = lazy(() => import("./pages/TermsAndConditionsPage"));
const SubscriptionManagePage = lazy(() => import("./pages/SubscriptionManagePage"));
import ErrorBoundary from "./components/ErrorBoundary";
import OfflineIndicator from "./components/OfflineIndicator";
import CookieConsentBanner from "./components/CookieConsentBanner";
import LanguageSelector from "./components/LanguageSelector";
import NotificationBadge from "./components/NotificationBadge";
import BottomNav from "./components/BottomNav";
import { useI18n } from "./i18n";

// ── Helpers ──

function SignOutPage({ onSignOut, busy }: { onSignOut: () => Promise<void>; busy: boolean }) {
  const { t } = useI18n();
  useEffect(() => {
    void onSignOut();
  }, []);
  return (
    <section className="auth-shell">
      <section className="auth-card">
        <h1>{t("auth.signingOut")}</h1>
        <p>{busy ? t("auth.endingSession") : t("auth.redirecting")}</p>
      </section>
    </section>
  );
}

/** Animated setup step with staggered reveal */
function SetupStep({ label, delay }: { label: string; delay: number }) {
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), delay);
    const t2 = setTimeout(() => setDone(true), delay + 1800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [delay]);
  return (
    <div className={`setup-step${visible ? " setup-step-visible" : ""}${done ? " setup-step-done" : ""}`}>
      <span className="setup-step-indicator">{done ? "✓" : <span className="setup-step-spinner" />}</span>
      <span className="setup-step-label">{label}</span>
    </div>
  );
}

/** Scroll .main-area to top whenever the route changes */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    const el = document.querySelector(".main-area");
    if (el) el.scrollTo(0, 0);
    else window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// ── App Component ──

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── UI state ──
  const [notice, setNotice] = useState<Notice>({ tone: "neutral", text: "" });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { t, hasChosenLanguage } = useI18n();

  // ── Custom hooks ──
  const auth = useAuth(setNotice);
  const bootstrap = useBootstrap({
    token: auth.token,
    userEmail: auth.userEmail,
    userPhone: auth.userPhone,
    setBusyKey: auth.setBusyKey,
    setNotice,
    hasBootstrappedRef: auth.hasBootstrappedRef,
    bootstrapRetry: auth.bootstrapRetry,
    setBootstrapRetry: auth.setBootstrapRetry,
    setSession: auth.setSession,
    setCustomAuth: auth.setCustomAuth,
    withAuthRequest: auth.withAuthRequest,
  });
  const confirmDialog = useConfirmDialog(auth.busyKey, auth.setBusyKey, setNotice);

  // Destructure for convenience
  const { token, userEmail, userPhone, isLoggedIn, busyKey, loadingSession } = auth;
  const {
    authContext, setAuthContext, isSuperAdmin, isAdminUser, isChurchAdmin, isMemberOnlyUser,
    memberDashboard, setMemberDashboard, refreshMemberDashboard,
    churches, admins, pastors, setPastors, events, notifications, incomeSummary, adminCounts, loadAdminCounts,
    loadChurches, loadAdmins, loadPastors, loadEventsAndNotifications, loadIncomeSummary, loadContext,
    paymentsEnabled, paymentConfigError, paymentInProgressRef,
    showPushBanner, setShowPushBanner, showInstallBanner, setShowInstallBanner,
    bootstrapError, showJoinPage, familyHeadName,
  } = bootstrap;

  // Set initial notice text once i18n is ready
  useEffect(() => {
    setNotice((prev) => prev.text === "" ? { tone: "neutral", text: t("auth.enterPhonePrompt") } : prev);
  }, [t]);

  // Listen for NAVIGATE messages from the service worker
  useEffect(() => {
    const checkNotificationUrl = async () => {
      try {
        const cache = await caches.open("notification-click");
        const resp = await cache.match("/_notification_url");
        if (resp) {
          const url = await resp.text();
          await cache.delete("/_notification_url");
          if (url && url !== "/" && url !== window.location.pathname) navigate(url);
        }
      } catch { /* caches API unavailable */ }
    };

    const msgHandler = (event: MessageEvent) => {
      if (event.data?.type === "NAVIGATE" && event.data.url) {
        caches.open("notification-click").then(c => c.delete("/_notification_url")).catch(() => {});
        navigate(event.data.url);
      }
    };

    const visHandler = () => {
      if (document.visibilityState === "visible") checkNotificationUrl();
    };

    navigator.serviceWorker?.addEventListener("message", msgHandler);
    document.addEventListener("visibilitychange", visHandler);
    checkNotificationUrl();

    return () => {
      navigator.serviceWorker?.removeEventListener("message", msgHandler);
      document.removeEventListener("visibilitychange", visHandler);
    };
  }, [navigate]);

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (notice.tone === "neutral" || !notice.text) return;
    const timer = setTimeout(() => setNotice({ tone: "neutral", text: "" }), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const workspaceToneClass = isSuperAdmin
    ? "super-admin-layout"
    : isChurchAdmin
      ? "admin-layout"
      : "member-layout";

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith("/profile")) return t("nav.profile");
    if (location.pathname.startsWith("/history")) return t("nav.history");
    if (location.pathname.startsWith("/events")) return t("nav.events");
    if (location.pathname.startsWith("/donate")) return t("nav.donate");
    if (location.pathname.startsWith("/admin-tools"))
      return isSuperAdmin ? t("nav.superAdminConsole") : t("nav.adminSection");
    return t("nav.dashboard");
  }, [isSuperAdmin, location.pathname, t]);

  // ── Derived badge counts ──
  const duesCount = memberDashboard?.due_subscriptions?.length ?? 0;
  const totalAdminPending = adminCounts
    ? adminCounts.membership_requests + adminCounts.family_requests + adminCounts.cancellation_requests
      + adminCounts.account_deletion_requests + adminCounts.refund_requests + adminCounts.prayer_requests
    : 0;

  // ── Context value ──

  const contextValue = useMemo(
    () => ({
      token,
      userEmail,
      userPhone,
      authContext,
      setAuthContext,
      isSuperAdmin,
      isAdminUser,
      isChurchAdmin,
      isMemberOnlyUser,
      notice,
      setNotice,
      busyKey,
      setBusyKey: auth.setBusyKey,
      withAuthRequest: auth.withAuthRequest,
      memberDashboard,
      setMemberDashboard,
      refreshMemberDashboard,
      churches,
      admins,
      pastors,
      setPastors,
      events,
      notifications,
      incomeSummary,
      loadChurches,
      loadAdmins,
      loadPastors,
      loadEventsAndNotifications,
      loadIncomeSummary,
      loadContext,
      adminCounts,
      refreshAdminCounts: loadAdminCounts,
      paymentsEnabled,
      paymentConfigError,
      paymentInProgressRef,
      openOperationConfirmDialog: confirmDialog.openOperationConfirmDialog,
    }),
    [
      token, userEmail, userPhone, authContext, isSuperAdmin, isAdminUser, isChurchAdmin, isMemberOnlyUser,
      notice, busyKey, memberDashboard, churches, admins, pastors, events, notifications, adminCounts,
      incomeSummary, paymentsEnabled, paymentConfigError, auth.withAuthRequest, confirmDialog.openOperationConfirmDialog,
    ],
  );

  // ── Early-return guards ──

  // Public pages accessible regardless of auth state
  const isPublicDonationRoute = location.pathname.startsWith("/donate");
  const isPublicStaticRoute = location.pathname === "/privacy" || location.pathname === "/terms";
  const isSubscriptionManageRoute = location.pathname === "/subscribe/manage";

  if (isPublicStaticRoute || isSubscriptionManageRoute || (isPublicDonationRoute && !loadingSession && !isLoggedIn)) {
    return (
      <Suspense fallback={<div className="auth-shell"><p>{t("common.loading")}</p></div>}>
      <Routes>
        <Route path="/donate" element={<PublicDonationPage isLoggedIn={isLoggedIn} />} />
        <Route path="/donate/public" element={<PublicDonationPage isLoggedIn={false} />} />
        <Route path="/donate/checkout" element={<DonationCheckoutPage isLoggedIn={isLoggedIn} />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsAndConditionsPage />} />
        <Route path="/subscribe/manage" element={<SubscriptionManagePage />} />
        <Route path="*" element={<Navigate to="/donate" replace />} />
      </Routes>
      </Suspense>
    );
  }

  if (loadingSession) {
    return (
      <div className="auth-shell">
        <section className="auth-card" style={{ textAlign: "center" }}>
          <h1>{t("auth.checkingSession")}</h1>
          <p>{t("auth.loadingAuthState")}</p>
          <div className="loading-bar" style={{ width: "60%", height: 3, background: "var(--primary)", borderRadius: 2, margin: "1rem auto 0", animation: "pulse 1.5s ease-in-out infinite" }} />
        </section>
      </div>
    );
  }

  // Gate 1: Not logged in → Home page (/) + Login page (/signin)
  if (!isLoggedIn) {
    return (
      <Routes>
        <Route path="/signin" element={
            <div className="auth-shell">
              <section className="auth-card">
                <p className="auth-eyebrow">{t("auth.churchManagement")}</p>
                <img src={shalomLogo} alt="Shalom" className="auth-logo" />
                <h1>{t("auth.welcome")}</h1>
                <form onSubmit={(e) => { e.preventDefault(); if (auth.otpStep === "phone") auth.sendOtp(); else auth.verifyOtp(); }}>
                {auth.otpStep === "phone" ? (
                  <>
                    <p>{t("auth.enterPhone")}</p>
                    <label>
                      {t("auth.phoneLabel")}
                      <div style={{ display: "flex", alignItems: "stretch" }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", padding: "0 0.75rem",
                          background: "var(--surface-container)", borderRadius: "var(--radius-md) 0 0 var(--radius-md)",
                          border: "1px solid rgba(220,208,255,0.30)", borderRight: "none",
                          fontWeight: 600, fontSize: "0.9375rem", color: "var(--on-surface)", whiteSpace: "nowrap",
                          userSelect: "none",
                        }}>+91</span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          value={auth.phoneInput}
                          onChange={(e) => auth.setPhoneInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
                          placeholder="9876543210"
                          disabled={busyKey === "login"}
                          maxLength={10}
                          style={{ borderRadius: "0 var(--radius-md) var(--radius-md) 0" }}
                        />
                      </div>
                    </label>
                    <button type="submit" className="btn btn-primary" disabled={busyKey === "login" || !auth.phoneInput.trim()}>
                      {busyKey === "login" ? t("auth.sendingOtp") : t("auth.sendOtp")}
                    </button>
                  </>
                ) : (
                  <>
                    <p>{t("auth.otpSentTo")} <strong>+91{auth.phoneInput}</strong></p>
                    {notice.text ? <div className={`notice notice-${notice.tone}`}>{notice.text}</div> : null}
                    <label>
                      {t("auth.otpLabel")}
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={auth.otpInput}
                        onChange={(e) => auth.setOtpInput(e.target.value)}
                        placeholder={t("auth.otpPlaceholder")}
                        disabled={busyKey === "login"}
                        maxLength={6}
                        autoFocus
                      />
                    </label>
                    <div className="actions-row">
                      <button type="button" className="btn" onClick={() => { auth.setOtpStep("phone"); auth.setOtpInput(""); setNotice({ tone: "neutral", text: t("auth.enterPhonePrompt") }); }} disabled={busyKey === "login"}>
                        {t("auth.changeNumber")}
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={busyKey === "login" || !auth.otpInput.trim()}>
                        {busyKey === "login" ? t("auth.verifying") : t("auth.verifyOtp")}
                      </button>
                    </div>
                  </>
                )}
                </form>
                <Link to="/explore" className="explore-church-link">
                  {t("explore.checkChurch")} <ChevronRight size={14} />
                </Link>
              </section>
            </div>
          }
        />
        <Route path="/explore" element={<Suspense fallback={<div className="auth-shell"><p>{t("common.loading")}</p></div>}><ExplorePage /></Suspense>} />
        <Route path="/" element={<Suspense fallback={<div className="auth-shell"><p>{t("common.loading")}</p></div>}><HomePage /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Gate 2: Logged in but language not chosen yet → Language selector
  if (!hasChosenLanguage) {
    return <LanguageSelector />;
  }

  // Gate 3: Logged in but not registered → Church code entry
  if (!authContext) {
    if (showJoinPage) {
      return <Suspense fallback={<div className="auth-shell"><p>{t("common.loading")}</p></div>}>
        <JoinPage token={token} userEmail={userEmail} userPhone={userPhone} onSignOut={auth.signOut} onJoined={() => { auth.hasBootstrappedRef.current = false; auth.setBootstrapRetry((v) => v + 1); }} />
      </Suspense>;
    }
    if (bootstrapError === "family_dependent") {
      const displayName = familyHeadName || t("auth.yourFamilyHead");
      return (
        <div className="auth-shell">
          <section className="auth-card" style={{ textAlign: "center", maxWidth: 440 }}>
            <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>👨‍👩‍👧</div>
            <h1 style={{ fontSize: "1.3rem", marginBottom: "0.75rem" }}>{t("auth.familyMemberAccount")}</h1>
            <p style={{ fontSize: "0.95rem", lineHeight: 1.6, color: "var(--text-muted)" }}>
              {t("auth.familyMemberDescription", { name: displayName })}
            </p>
            <p style={{ fontSize: "0.9rem", lineHeight: 1.6, color: "var(--text-muted)", marginTop: "0.5rem" }}>
              {t("auth.familyMemberHint", { name: displayName })}
            </p>
            <ol style={{ textAlign: "left", margin: "1rem auto 0", maxWidth: 360, fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.6, paddingLeft: "1.25rem" }}>
              <li>{t("auth.familyStep1", { name: displayName })}</li>
              <li>{t("auth.familyStep2")}</li>
              <li>{t("auth.familyStep3")}</li>
            </ol>
            <div className="actions-row" style={{ justifyContent: "center", marginTop: "1.25rem", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() => { auth.hasBootstrappedRef.current = false; auth.setBootstrapRetry((v) => v + 1); }}
                disabled={busyKey === "bootstrap"}
              >
                {busyKey === "bootstrap" ? t("common.retrying") : t("common.retry")}
              </button>
              <button className="btn btn-primary" onClick={auth.signOut} disabled={busyKey === "logout"}>
                {busyKey === "logout" ? t("auth.signingOut") : t("nav.signOut")}
              </button>
            </div>
          </section>
        </div>
      );
    }
    return (
      <div className="auth-shell">
        <section className="auth-card setup-card">
          {bootstrapError ? (
            <>
              <div className="setup-icon setup-icon-error">!</div>
              <h1>{t("auth.workspaceError")}</h1>
              <p>{t("auth.workspaceErrorDesc")}</p>
              <div className="notice notice-error">{bootstrapError}</div>
              <div className="actions-row">
                <button className="btn" onClick={() => { auth.hasBootstrappedRef.current = false; auth.setBootstrapRetry((v) => v + 1); }} disabled={busyKey === "bootstrap"}>
                  {busyKey === "bootstrap" ? t("common.retrying") : t("common.retry")}
                </button>
                <button className="btn btn-primary" onClick={auth.signOut} disabled={busyKey === "logout"}>
                  {busyKey === "logout" ? t("auth.signingOut") : t("nav.signOut")}
                </button>
              </div>
            </>
          ) : (
            <>
              <img src={shalomLogo} alt="Shalom" className="setup-logo" />
              <h1 className="setup-title">{t("auth.settingUpTitle")}</h1>
              <p className="setup-subtitle">{t("auth.settingUpDesc")}</p>
              <div className="setup-steps">
                <SetupStep label={t("auth.setupStep1")} delay={0} />
                <SetupStep label={t("auth.setupStep2")} delay={1200} />
                <SetupStep label={t("auth.setupStep3")} delay={2800} />
              </div>
              <div className="setup-progress-track">
                <div className="setup-progress-fill" />
              </div>
              <p className="setup-hint">{t("auth.setupHint")}</p>
            </>
          )}
        </section>
      </div>
    );
  }

  // ── Main authenticated layout ──

  const memberName = authContext?.profile?.full_name || userPhone || userEmail;
  const avatarText = initials(authContext?.profile?.full_name, userPhone || userEmail);
  const avatarUrl = authContext?.profile?.avatar_url || "";

  return (
    <AppContext.Provider value={contextValue}>
      <a href="#main-content" className="skip-to-content">{t("common.skipToContent")}</a>
      <OfflineIndicator />
      <CookieConsentBanner />
      <div className={`app-layout ${workspaceToneClass}`}>
        {/* Floating burger (mobile only — top-left) */}
        <button
          className={`floating-burger ${mobileNavOpen ? "fab-open" : ""}`}
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label={t("nav.toggleNavigation")}
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-nav"
        >
          {mobileNavOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <nav className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
          <div className="brand-block">
            <img src={shalomLogo} alt="Shalom" className="nav-logo" />
            <span className="brand-name">{authContext?.profile.full_name || (isSuperAdmin ? t("profile.superAdmin") : "Shalom")}</span>
          </div>
          <nav id="mobile-nav" className="nav-stack">
            <div className="sidebar-user-badge">
              {avatarUrl ? (
                <img className="avatar" src={avatarUrl} alt={memberName} />
              ) : (
                <div className="avatar avatar-fallback">{avatarText}</div>
              )}
              <div>
                <strong>{memberName}</strong>
                <span>{isSuperAdmin ? "super_admin" : authContext?.profile?.role || "member"}</span>
              </div>
            </div>
            <p className="nav-section-label">{t("nav.main")}</p>
            <Link className={`nav-link ${location.pathname === "/home" ? "active" : ""}`} to="/home" onClick={() => setMobileNavOpen(false)}>
              <span className="nav-icon"><Home size={20} strokeWidth={1.5} /></span>
              <span>{t("nav.home")}</span>
            </Link>
            <Link className={`nav-link ${location.pathname === "/dashboard" ? "active" : ""}`} to="/dashboard" onClick={() => setMobileNavOpen(false)}>
              <span className="nav-icon"><LayoutDashboard size={20} strokeWidth={1.5} /></span>
              <span>{t("nav.dashboard")}</span>
            </Link>
            {!isSuperAdmin ? (
              <Link className={`nav-link ${location.pathname === "/profile" ? "active" : ""}`} to="/profile" onClick={() => setMobileNavOpen(false)}>
                <span className="nav-icon"><UserRound size={20} strokeWidth={1.5} /></span>
                <span>{t("nav.profile")}</span>
              </Link>
            ) : null}
            {!isSuperAdmin ? (
              <Link className={`nav-link ${location.pathname === "/history" ? "active" : ""}`} to="/history" onClick={() => setMobileNavOpen(false)}>
                <span className="nav-icon"><History size={20} strokeWidth={1.5} /></span>
                <span>{t("nav.history")}</span>
                <NotificationBadge count={duesCount} />
              </Link>
            ) : null}
            <Link className={`nav-link ${location.pathname === "/events" ? "active" : ""}`} to="/events" onClick={() => setMobileNavOpen(false)}>
              <span className="nav-icon"><CalendarDays size={20} strokeWidth={1.5} /></span>
              <span>{t("nav.events")}</span>
              <NotificationBadge count={adminCounts?.events ?? 0} />
            </Link>
            <Link className={`nav-link ${location.pathname === "/donate" ? "active" : ""}`} to="/donate" onClick={() => setMobileNavOpen(false)}>
              <span className="nav-icon"><HandHeart size={20} strokeWidth={1.5} /></span>
              <span>{t("nav.donate")}</span>
            </Link>
            {!isSuperAdmin ? (
              <Link className={`nav-link ${location.pathname === "/prayer-request" ? "active" : ""}`} to="/prayer-request" onClick={() => setMobileNavOpen(false)}>
                <span className="nav-icon"><Heart size={20} strokeWidth={1.5} /></span>
                <span>{t("nav.prayerRequest")}</span>
                <NotificationBadge count={adminCounts?.prayer_requests ?? 0} />
              </Link>
            ) : null}
            {isAdminUser ? <p className="nav-section-label">{isSuperAdmin ? t("nav.superAdminTools") : t("nav.adminTools")}</p> : null}
            {isAdminUser ? (
              <Link className={`nav-link ${location.pathname === "/admin-tools" ? "active" : ""}`} to="/admin-tools" onClick={() => setMobileNavOpen(false)}>
                <span className="nav-icon"><Shield size={20} strokeWidth={1.5} /></span>
                <span>{isSuperAdmin ? t("nav.superAdminConsole") : t("nav.adminTools")}</span>
                <NotificationBadge count={totalAdminPending} />
              </Link>
            ) : null}
            {isMemberOnlyUser ? <p className="nav-section-label">{t("nav.memberOnly")}</p> : null}
            <Link className={`nav-link ${location.pathname === "/settings" ? "active" : ""}`} to="/settings" onClick={() => setMobileNavOpen(false)}>
              <span className="nav-icon"><Settings size={20} strokeWidth={1.5} /></span>
              <span>{t("nav.settings")}</span>
            </Link>
          </nav>

        </nav>

        {/* Mobile nav backdrop overlay */}
        {mobileNavOpen && <div className="nav-backdrop" onClick={() => setMobileNavOpen(false)} />}

        <main className="main-area" id="main-content">
          <header className="topbar">
            <div>
              <p className="topbar-label">{pageTitle}</p>
              <h1>
                {isSuperAdmin
                  ? t("nav.shalomSuperAdmin")
                  : isChurchAdmin
                    ? t("nav.shalomChurchAdmin")
                    : t("nav.shalomMember")}
              </h1>
            </div>
          </header>

          {/* Scroll to top on every route change (fixes mobile staying at bottom) */}
          <ScrollToTop />

          {/* Toast notification */}
          {notice.text && notice.tone !== "neutral" && (
            <div className={`toast-notification toast-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"}>
              {notice.text}
              <button className="toast-close" onClick={() => setNotice({ tone: "neutral", text: "" })}>✕</button>
            </div>
          )}

          {/* Push notification permission banner */}
          {showPushBanner && (
            <div className="push-banner" role="alert">
              <span>{t("banner.pushPrompt")}</span>
              <div className="push-banner-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    setShowPushBanner(false);
                    try {
                      const { subscribeToPush } = await import("./lib/pushSubscription");
                      const ok = await subscribeToPush(token);
                      if (ok) {
                        setNotice({ tone: "success", text: t("settings.pushEnabled") });
                      } else if (typeof Notification !== "undefined" && Notification.permission === "denied") {
                        setNotice({ tone: "error", text: t("banner.pushBlocked") });
                      }
                    } catch { /* ignore */ }
                  }}
                >
                  {t("banner.allow")}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowPushBanner(false)}>{t("banner.notNow")}</button>
              </div>
            </div>
          )}

          {/* iOS "Add to Home Screen" install banner */}
          {showInstallBanner && (
            <div className="push-banner" role="alert">
              <span>{t("banner.installPrompt")} {t("banner.installInstructions")}</span>
              <div className="push-banner-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setShowInstallBanner(false);
                    sessionStorage.setItem("ios_install_dismissed", "1");
                  }}
                >
                  {t("banner.gotIt")}
                </button>
              </div>
            </div>
          )}

          <ErrorBoundary>
          <Suspense fallback={<div className="page-loading"><p>{t("common.loadingPage")}</p></div>}>
          <Routes>
            <Route path="/home" element={<UserHomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/explore" element={<Suspense fallback={<div className="page-loading"><p>{t("common.loadingPage")}</p></div>}><ExplorePage isLoggedIn /></Suspense>} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/history" element={isSuperAdmin ? <Navigate to="/dashboard" replace /> : <HistoryPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/donate" element={<PublicDonationPage isLoggedIn={true} userChurch={memberDashboard?.church ? { id: memberDashboard.church.id, name: memberDashboard.church.name } : undefined} />} />
            <Route path="/donate/public" element={<PublicDonationPage isLoggedIn={false} />} />
            <Route path="/donate/checkout" element={<DonationCheckoutPage isLoggedIn={true} />} />
            <Route path="/prayer-request" element={<PrayerRequestPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsAndConditionsPage />} />
            <Route path="/admin-tools" element={isAdminUser ? <AdminConsolePage /> : <Navigate to="/dashboard" replace />} />
            <Route path="/settings" element={<SettingsPage busyKey={auth.busyKey} />} />
            <Route path="/signout" element={<SignOutPage onSignOut={auth.signOut} busy={busyKey === "logout"} />} />
            <Route path="/auth/callback" element={<Navigate to="/home" replace />} />
            <Route path="/signin" element={<Navigate to="/home" replace />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>

          {/* ── Operation Confirm Modal ── */}
          {confirmDialog.showOperationConfirmModal ? (
            <section className="modal-overlay" role="dialog" aria-modal="true" aria-label={t("common.confirmOperation")}
              onClick={(event) => { if (event.target === event.currentTarget) confirmDialog.closeOperationConfirmDialog(); }}>
              <article className="modal-card">
                <div className="modal-header">
                  <h3>{confirmDialog.operationConfirmTitle || t("common.confirmOperation")}</h3>
                  <button className="btn" onClick={confirmDialog.closeOperationConfirmDialog} disabled={busyKey === "operation-confirm"}>{t("common.close")}</button>
                </div>
                <p className="muted">{confirmDialog.operationConfirmDescription || t("common.confirmOperationDesc")}</p>
                {["DELETE", "REMOVE", "REVOKE", "TRANSFER"].includes(confirmDialog.operationConfirmKeyword) ? (
                  <>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={confirmDialog.operationConfirmChecked} onChange={(e) => confirmDialog.setOperationConfirmChecked(e.target.checked)} />
                      {t("common.confirmCheckboxLabel")}
                    </label>
                    <div className="actions-row">
                      <button className="btn" onClick={confirmDialog.closeOperationConfirmDialog} disabled={busyKey === "operation-confirm"}>{t("common.cancel")}</button>
                      <button className="btn btn-danger" onClick={confirmDialog.executeOperationConfirmDialog}
                        disabled={busyKey === "operation-confirm" || !confirmDialog.operationConfirmChecked}>
                        {busyKey === "operation-confirm" ? t("common.processing") : `${t("common.confirm")} ${confirmDialog.operationConfirmKeyword.charAt(0) + confirmDialog.operationConfirmKeyword.slice(1).toLowerCase()}`}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="actions-row" style={{ marginTop: 16 }}>
                    <button className="btn" onClick={confirmDialog.closeOperationConfirmDialog} disabled={busyKey === "operation-confirm"}>{t("common.cancel")}</button>
                    <button className="btn btn-primary" onClick={confirmDialog.executeOperationConfirmDialog}
                      disabled={busyKey === "operation-confirm"}>
                      {busyKey === "operation-confirm" ? t("common.processing") : t("common.confirm")}
                    </button>
                  </div>
                )}
              </article>
            </section>
          ) : null}
        </main>

        {/* Floating bottom navigation bar (mobile only — CSS hides on desktop) */}
        <BottomNav
          isSuperAdmin={isSuperAdmin}
          isAdminUser={isAdminUser}
          paymentsEnabled={paymentsEnabled}
          duesCount={duesCount}
          adminPendingCount={totalAdminPending}
        />
      </div>
    </AppContext.Provider>
  );
}

export default App;
