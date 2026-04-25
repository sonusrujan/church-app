import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  CreditCard,
  Megaphone,
  CalendarDays,
  ChevronRight,
  Wallet,
} from "lucide-react";
import donationIcon from "../assets/donation-icon.png";
import prayerIcon from "../assets/prayer-icon.png";
import { useApp } from "../context/AppContext";
import { apiRequest } from "../lib/api";
import LoadingSkeleton from "../components/LoadingSkeleton";

import { useI18n } from "../i18n";
import {
  formatAmount,
  formatDate,
  loadRazorpayCheckoutScript,
  type DueSubscriptionRow,
} from "../types";

export default function DashboardPage() {
  const {
    token,
    userEmail,
    authContext,
    isSuperAdmin,
    isChurchAdmin,
    memberDashboard,
    refreshMemberDashboard,
    churches,
    admins,

    paymentsEnabled,
    paymentConfigError,
    busyKey,
    setBusyKey,
    setNotice,
    withAuthRequest,
    loadChurches,
    loadAdmins,
    loadIncomeSummary,
    paymentInProgressRef,
    events,
    notifications,
  } = useApp();
  const { t } = useI18n();

  // ── Local state ──

  const [selectedDueSubscriptionIds, setSelectedDueSubscriptionIds] = useState<string[]>([]);
  const [cancellingSubId, setCancellingSubId] = useState("");
  const [showPaymentSummary, setShowPaymentSummary] = useState(false);
  const [cancelModalSubId, setCancelModalSubId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [saasPayBusy, setSaasPayBusy] = useState(false);
  const [saasPayments, setSaasPayments] = useState<{ id: string; amount: number; payment_method: string | null; payment_date: string; transaction_id: string | null }[]>([]);
  const [saasPaymentsLoaded, setSaasPaymentsLoaded] = useState(false);

  // ── Derived values ──
  const dueSubscriptions = useMemo(
    () => memberDashboard?.due_subscriptions || [],
    [memberDashboard?.due_subscriptions],
  );

  const selectedDueSubscriptions = useMemo(() => {
    if (!dueSubscriptions.length) return [] as DueSubscriptionRow[];
    const selectedIdSet = new Set(selectedDueSubscriptionIds);
    return dueSubscriptions.filter((s) => selectedIdSet.has(s.subscription_id));
  }, [dueSubscriptions, selectedDueSubscriptionIds]);

  const hasDueSubscription = dueSubscriptions.length > 0;
  const hasActiveSubscription = (memberDashboard?.subscriptions || []).some(
    (s) => s.status === "active" || s.status === "overdue" || s.status === "pending_first_payment",
  );
  const selectedDueAmount = selectedDueSubscriptions.reduce(
    (sum, s) => sum + Number(s.amount || 0),
    0,
  );

  // ── Auto-select dues ──
  useEffect(() => {
    const dueIds = dueSubscriptions.map((s) => s.subscription_id);
    setSelectedDueSubscriptionIds((current) => {
      const dueIdSet = new Set(dueIds);
      const filtered = current.filter((id) => dueIdSet.has(id));
      if (filtered.length === 0 && dueIds.length > 0) return dueIds;
      return filtered;
    });
  }, [dueSubscriptions]);

  // ── Growth metrics ──
  type GrowthMetrics = {
    total_members: number;
    monthly_growth: Array<{ month: string; count: number }>;
    active_subscriptions: number;
    overdue_subscriptions: number;
  };
  const [growthMetrics, setGrowthMetrics] = useState<GrowthMetrics | null>(null);
  const [growthLoading, setGrowthLoading] = useState(false);

  const loadGrowthMetrics = useCallback(async () => {
    if (!token || !isChurchAdmin) return;
    setGrowthLoading(true);
    try {
      const data = await apiRequest<GrowthMetrics>("/api/admin/growth", { token });
      setGrowthMetrics(data);
    } catch {
      // silently fail — not critical
    } finally {
      setGrowthLoading(false);
    }
  }, [token, isChurchAdmin]);

  useEffect(() => {
    if (isChurchAdmin) void loadGrowthMetrics();
  }, [isChurchAdmin, loadGrowthMetrics]);

  // ── Handlers ──
  function toggleDueSubscription(subscriptionId: string) {
    setSelectedDueSubscriptionIds((current) =>
      current.includes(subscriptionId)
        ? current.filter((id) => id !== subscriptionId)
        : [...current, subscriptionId],
    );
  }



  function openCancelModal(subscriptionId: string) {
    setCancelModalSubId(subscriptionId);
    setCancelReason("");
  }

  async function confirmSubscriptionCancellation() {
    const subId = cancelModalSubId;
    setCancelModalSubId("");
    setCancellingSubId(subId);
    await withAuthRequest(
      "cancel-sub-request",
      () => apiRequest("/api/requests/cancellation-requests", {
        method: "POST", token,
        body: { subscription_id: subId, reason: cancelReason.trim() || undefined },
      }),
      t("dashboard.cancellationRequestSubmitted"),
    );
    setCancellingSubId("");
  }

  // ── SaaS fee payment (church admin pays platform) ──

  async function paySaasFee() {
    if (saasPayBusy) return;
    setSaasPayBusy(true);
    try {
      const orderPayload = await apiRequest<{
        order: { id: string; amount: number; currency: string };
        key_id: string;
        church_id: string;
        subscription_id: string;
        amount: number;
        billing_cycle: string;
      }>("/api/saas/pay/order", { method: "POST", token });

      const checkoutLoaded = await loadRazorpayCheckoutScript();
      if (!checkoutLoaded) throw new Error("Unable to load Razorpay checkout. Please retry.");

      const RazorpayConstructor = (window as any).Razorpay;
      if (typeof RazorpayConstructor !== "function")
        throw new Error("Razorpay checkout is unavailable in this browser.");

      await new Promise<void>((resolve, reject) => {
        const razorpay = new RazorpayConstructor({
          key: orderPayload.key_id,
          amount: orderPayload.order.amount,
          currency: orderPayload.order.currency || "INR",
          name: "Shalom Platform",
          description: `Platform Fee — ${memberDashboard?.church?.name || "Church"}`,
          order_id: orderPayload.order.id,
          prefill: {
            name: authContext?.profile.full_name || "",
            email: userEmail,
          },
          notes: {
            type: "saas_fee",
            church_id: orderPayload.church_id,
            subscription_id: orderPayload.subscription_id,
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await apiRequest<{ success: true }>("/api/saas/pay/verify", {
                method: "POST",
                token,
                body: {
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                },
              });
              await refreshMemberDashboard();
              setSaasPaymentsLoaded(false);
              setNotice({ tone: "success", text: t("dashboard.successPlatformFeePaid") });
              resolve();
            } catch (verifyError: unknown) {
              const status =
                verifyError && typeof verifyError === "object" && "status" in verifyError
                  ? (verifyError as { status: number }).status
                  : 0;
              if (status === 503 || status === 0) {
                await refreshMemberDashboard();
                setNotice({
                  tone: "error",
                  text: t("dashboard.verificationPending"),
                });
                resolve();
              } else {
                reject(verifyError);
              }
            }
          },
          modal: { ondismiss: () => reject(new Error("Payment checkout was cancelled.")) },
          theme: { color: "#2a6f7c" },
        });
        razorpay.open();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("dashboard.errorPlatformFeeFailed");
      setNotice({ tone: "error", text: message });
    } finally {
      setSaasPayBusy(false);
    }
  }

  async function loadSaasPayments() {
    try {
      const data = await apiRequest<{ id: string; amount: number; payment_method: string | null; payment_date: string; transaction_id: string | null }[]>(
        "/api/saas/my-payments",
        { token },
      );
      setSaasPayments(data);
      setSaasPaymentsLoaded(true);
    } catch {
      setNotice({ tone: "error", text: t("dashboard.errorHistoryLoadFailed") });
    }
  }

  async function paySubscriptionDue() {
    if (!paymentsEnabled) {
      setNotice({ tone: "error", text: t("dashboard.errorPaymentsDisabled") });
      return;
    }
    if (isSuperAdmin) {
      setNotice({ tone: "error", text: t("dashboard.errorNotAvailableSuperAdmin") });
      return;
    }
    if (!hasDueSubscription) {
      setNotice({ tone: "neutral", text: "No dues pending right now." });
      return;
    }
    if (!selectedDueSubscriptionIds.length) {
      setNotice({ tone: "error", text: t("dashboard.errorNoSubscriptionSelected") });
      return;
    }
    if (paymentInProgressRef.current) return;

    paymentInProgressRef.current = true;
    setBusyKey("pay-now");
    try {
      const orderPayload = await apiRequest<{
        order: { id: string; amount: number; currency: string; receipt: string };
        key_id: string;
        member_id: string;
        subscription_ids: string[];
        total_amount: number;
        selected_due_subscriptions: DueSubscriptionRow[];
      }>("/api/payments/subscription/order", {
        method: "POST",
        token,
        body: { subscription_ids: selectedDueSubscriptionIds },
      });

      const checkoutLoaded = await loadRazorpayCheckoutScript();
      if (!checkoutLoaded) throw new Error(t("dashboard.errorCheckoutLoadFailed"));

      const RazorpayConstructor = (window as any).Razorpay;
      if (typeof RazorpayConstructor !== "function")
        throw new Error(t("dashboard.errorCheckoutUnavailable"));

      await new Promise<void>((resolve, reject) => {
        const razorpay = new RazorpayConstructor({
          key: orderPayload.key_id,
          amount: orderPayload.order.amount,
          currency: orderPayload.order.currency,
          name: memberDashboard?.church?.name || "SHALOM Subscription",
          description: "Subscription Due Payment",
          order_id: orderPayload.order.id,
          prefill: { name: authContext?.profile.full_name || "", email: userEmail },
          notes: {
            type: "subscription_due",
            member_id: orderPayload.member_id,
            subscription_ids: orderPayload.subscription_ids.join(","),
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await apiRequest<{ success: true }>("/api/payments/subscription/verify", {
                method: "POST",
                token,
                body: {
                  subscription_ids: orderPayload.subscription_ids,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                },
              });
              setSelectedDueSubscriptionIds([]);
              await refreshMemberDashboard();
              void loadIncomeSummary();
              setNotice({ tone: "success", text: t("dashboard.successSubscriptionPaid") });
              resolve();
            } catch (verifyError: unknown) {
              const status =
                verifyError && typeof verifyError === "object" && "status" in verifyError
                  ? (verifyError as { status: number }).status
                  : 0;
              if (status === 503 || status === 0) {
                // Do NOT clear selected dues — payment is unverified
                await refreshMemberDashboard();
                void loadIncomeSummary();
                setNotice({
                  tone: "error",
                  text: t("dashboard.verificationPending"),
                });
                resolve();
              } else {
                reject(verifyError);
              }
            }
          },
          modal: { ondismiss: () => reject(new Error("Payment checkout was cancelled.")) },
          theme: { color: "#2a6f7c" },
        });
        razorpay.open();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("dashboard.errorSubscriptionPaymentFailed");
      setNotice({ tone: "error", text: message });
    } finally {
      paymentInProgressRef.current = false;
      setBusyKey("");
    }
  }

  // ── Super admin dashboard ──
  if (isSuperAdmin) {
    return (
      <section className="page-grid">
        <article className="panel">
          <h3>{t("dashboard.quickStats")}</h3>
          <div className="stats-grid">
            <div className="stat">
              <span>{t("dashboard.churches")}</span>
              <strong>{churches.length}</strong>
            </div>
            <div className="stat">
              <span>{t("dashboard.admins")}</span>
              <strong>{admins.length}</strong>
            </div>
          </div>
          <div className="actions-row">
            <button className="btn" onClick={loadChurches} disabled={busyKey === "churches"}>
              {busyKey === "churches" ? t("common.loading") : t("dashboard.loadChurches")}
            </button>
            <button className="btn" onClick={loadAdmins} disabled={busyKey === "admins"}>
              {busyKey === "admins" ? t("common.loading") : t("dashboard.loadAdmins")}
            </button>
          </div>
        </article>

        <article className="panel">
          <h3>{t("dashboard.growthMetrics")}</h3>
          {growthLoading && !growthMetrics ? (
            <LoadingSkeleton lines={5} />
          ) : growthMetrics ? (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">{t("dashboard.totalMembers")}</div>
                  <div className="stat-value">{growthMetrics.total_members}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">{t("dashboard.activeSubs")}</div>
                  <div className="stat-value">{growthMetrics.active_subscriptions}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">{t("dashboard.overdue")}</div>
                  <div className="stat-value">{growthMetrics.overdue_subscriptions}</div>
                </div>
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.75rem 0 0.25rem" }}>
                {t("dashboard.newMembersChart")}
              </p>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={growthMetrics.monthly_growth} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} name={t("dashboard.members")} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p className="muted empty-state">{t("dashboard.growthNotAvailable")}</p>
          )}
        </article>

        <article className="panel">
          <h3>{t("dashboard.churchDirectory")}</h3>
          <div className="list-stack">
            {churches.length === 0 ? (
              <p className="muted empty-state">{t("dashboard.noChurchesLoaded")}</p>
            ) : (
              churches.map((church) => (
                <div key={church.id} className="list-item">
                  <strong>{church.name}</strong>
                  <span>
                    {t("dashboard.uniqueId")} {church.unique_id || church.church_code || t("dashboard.notGenerated")}
                  </span>
                  <span>{church.address || church.location || t("dashboard.addressNotSet")}</span>
                  <span>
                    Members: {church.member_count || 0} | Admins: {church.admin_count || 0} |
                    Pastors: {church.pastor_count || 0}
                  </span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel panel-wide ops-tree">
          <h3>{t("dashboard.adminDirectory")}</h3>
          <div className="list-stack">
            {admins.length === 0 ? (
              <p className="muted empty-state">{t("dashboard.noAdminsLoaded")}</p>
            ) : (
              admins.map((admin) => (
                <div key={admin.id} className="list-item">
                  <strong>{admin.full_name || admin.phone_number || admin.email}</strong>
                  <span>{admin.phone_number || admin.email}</span>
                  <span>{admin.church_id || t("dashboard.noChurch")}</span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    );
  }

  // ── Member / church admin dashboard ──

  const totalOutstanding = dueSubscriptions.reduce(
    (sum, item) => sum + Number(item.amount || 0), 0,
  );

  const latestNotifications = notifications.slice(0, 3);
  const latestEvents = events.slice(0, 4);

  function formatEventDate(dateStr: string | null) {
    if (!dateStr) return { month: "—", day: "—" };
    const d = new Date(dateStr);
    return {
      month: d.toLocaleString("en", { month: "short" }).toUpperCase(),
      day: String(d.getDate()),
    };
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t("common.minutesAgo", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("common.hoursAgo", { n: hours });
    const days = Math.floor(hours / 24);
    return days === 1 ? t("common.yesterday") : t("common.daysAgo", { n: days });
  }

  return (
    <>
      <div className="dash-page">
        {/* ── Onboarding card for new members ── */}
        {!isChurchAdmin && !hasActiveSubscription && !dueSubscriptions.length && !memberDashboard?.history?.length ? (
          <section className="dash-section-card" style={{ background: "var(--primary-container)", marginBottom: "1.5rem" }}>
            <h3 style={{ margin: "0 0 0.5rem" }}>{t("dashboard.gettingStarted")}</h3>
            <ol style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.8, fontSize: "0.95rem" }}>
              <li>{t("dashboard.onboardingStep1")}</li>
              <li>{t("dashboard.onboardingStep2")}</li>
              <li>{t("dashboard.onboardingStep3")}</li>
            </ol>
          </section>
        ) : null}

        {/* ── Bento Grid ── */}
        <div className="dash-bento">
          {/* Dues & Contributions — Large (merged with subscription info) */}
          <div className="dash-card-dues">
            <div className="dash-card-dues-decor" />
            <div className="dash-card-dues-body">
              <div className="dash-card-dues-head">
                <Wallet size={20} strokeWidth={1.5} className="dash-card-dues-wallet" />
                <span className="dash-card-dues-label">{t("dashboard.duesContributions")}</span>
              </div>
              <span className="dash-card-dues-tag">{t("dashboard.outstandingBalance")}</span>
              <div className="dash-card-dues-amount">{formatAmount(totalOutstanding)}</div>

              {/* Inline subscription summary */}
              {hasActiveSubscription ? (() => {
                const allSubs = memberDashboard?.subscriptions || [];
                const activeSubs = allSubs.filter(
                  (s) => s.status === "active" || s.status === "overdue" || s.status === "pending_first_payment",
                );
                const totalMonthly = activeSubs.reduce((sum, s) => sum + Number(s.amount || 0), 0);
                return (
                  <div style={{ marginTop: "1rem", borderTop: "1px solid rgba(220,208,255,0.30)", paddingTop: "0.75rem" }}>
                    <div className="dash-sub-stats" style={{ marginBottom: "0.5rem" }}>
                      <div className="dash-sub-stat">
                        <span className="dash-sub-stat-label">{t("dashboard.active")}</span>
                        <strong className="dash-sub-stat-value">{activeSubs.length}</strong>
                      </div>
                      <div className="dash-sub-stat">
                        <span className="dash-sub-stat-label">{t("dashboard.monthlyTotal")}</span>
                        <strong className="dash-sub-stat-value">{formatAmount(totalMonthly)}</strong>
                      </div>
                      <div className="dash-sub-stat">
                        <span className="dash-sub-stat-label">{t("dashboard.nextDue")}</span>
                        <strong className="dash-sub-stat-value">{formatDate(memberDashboard?.tracking?.next_due_date)}</strong>
                      </div>
                    </div>
                    <div className="dash-sub-list">
                      {activeSubs.map((sub) => (
                        <div key={sub.id} className="dash-sub-row">
                          <div>
                            <strong>{sub.person_name || sub.plan_name}</strong>
                            <span className="dash-sub-detail">
                              {formatAmount(sub.amount)} / {sub.billing_cycle} — <em>{sub.status}</em>
                            </span>
                          </div>
                          <button
                            className="dash-btn-cancel"
                            onClick={() => openCancelModal(sub.id)}
                            disabled={cancellingSubId === sub.id || busyKey === "cancel-sub-request"}
                            title="Request cancellation (admin approval required)"
                          >
                            {cancellingSubId === sub.id ? t("common.requesting") : t("common.cancel")}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })() : !isChurchAdmin ? (
                <p className="dash-muted" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
                  {t("dashboard.subscriptionSetByAdmin")}
                </p>
              ) : null}

              {/* Due items selection */}
              {dueSubscriptions.length > 0 ? (
                <div style={{ marginTop: "0.75rem", borderTop: "1px solid rgba(220,208,255,0.30)", paddingTop: "0.75rem" }}>
                  <div className="dash-due-list">
                    {dueSubscriptions.map((dueItem) => (
                      <label key={dueItem.subscription_id} className="checkbox-line">
                        <input
                          type="checkbox"
                          checked={selectedDueSubscriptionIds.includes(dueItem.subscription_id)}
                          onChange={() => toggleDueSubscription(dueItem.subscription_id)}
                        />
                        <span>
                          {dueItem.person_name}
                          {dueItem.family_member_id ? <span className="dash-due-family-tag">{t("dashboard.family")}</span> : null}
                        </span>
                        {" | "}{formatAmount(dueItem.amount)} | {t("dashboard.due")}{" "}
                        {formatDate(dueItem.next_payment_date)}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="dash-card-dues-actions">
              <button
                className="dash-btn-pay"
                onClick={() => {
                  if (hasDueSubscription && selectedDueSubscriptionIds.length) setShowPaymentSummary(true);
                }}
                disabled={!paymentsEnabled || !hasDueSubscription || !selectedDueSubscriptionIds.length}
              >
                <CreditCard size={16} strokeWidth={1.5} />
                {busyKey === "pay-now" ? t("common.processing") : t("dashboard.payNow")}
              </button>
              <Link to="/history" className="dash-btn-secondary">{t("dashboard.viewHistory")}</Link>
            </div>
            {!paymentsEnabled && hasDueSubscription ? (
              <p className="dash-muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
                {t("dashboard.paymentsUnavailable")}{paymentConfigError ? `: ${paymentConfigError}` : "."}
              </p>
            ) : null}
          </div>

          {/* Prayer Request */}
          <div className="dash-card-prayer">
            <div className="dash-prayer-orb">
              <img src={prayerIcon} alt="Prayer" className="dash-orb-icon" />
            </div>
            <h3 className="dash-prayer-title">{t("dashboard.prayerRequests")}</h3>
            <p className="dash-prayer-desc">{t("dashboard.prayerDescription")}</p>
            <Link to="/prayer-request" className="dash-prayer-btn">
              {t("dashboard.submitRequest")}
            </Link>
          </div>

          {/* Donate */}
          <div className="dash-card-donate">
            <div className="dash-donate-orb">
              <img src={donationIcon} alt="Donate" className="dash-orb-icon" />
            </div>
            <h3 className="dash-donate-title">{t("dashboard.makeDonation")}</h3>
            <p className="dash-donate-desc">{t("dashboard.donationDescription")}</p>
            <Link to="/donate" className="dash-donate-btn">
              {t("dashboard.donateNow")}
            </Link>
          </div>

          {/* Announcements */}
          <div className="dash-card-announcements">
            <div className="dash-card-head">
              <div className="dash-card-head-left">
                <Megaphone size={20} strokeWidth={1.5} className="dash-card-head-icon" />
                <h3>{t("dashboard.latestAnnouncements")}</h3>
              </div>
              <Link to="/events" className="dash-card-see-all">{t("common.viewAll")}</Link>
            </div>
            <div className="dash-announcements-list">
              {latestNotifications.length ? latestNotifications.map((n, i) => (
                <div key={n.id} className="dash-announcement-item">
                  <div className={`dash-announcement-bar ${i % 2 === 0 ? "dash-announcement-bar--green" : "dash-announcement-bar--blue"}`} />
                  <div className="dash-announcement-body">
                    <div className="dash-announcement-meta">
                      <span className="dash-announcement-type">{t("dashboard.churchUpdate")}</span>
                      <span className="dash-announcement-time">• {timeAgo(n.created_at)}</span>
                    </div>
                    <h4 className="dash-announcement-title">{n.title}</h4>
                    <p className="dash-announcement-text">{n.message}</p>
                  </div>
                </div>
              )) : (
                <p className="dash-empty">{t("dashboard.noAnnouncements")}</p>
              )}
            </div>
          </div>

          {/* Upcoming Events */}
          <div className="dash-card-events">
            <div className="dash-card-head">
              <div className="dash-card-head-left">
                <CalendarDays size={20} strokeWidth={1.5} className="dash-card-head-icon" />
                <h3>{t("dashboard.upcomingEvents")}</h3>
              </div>
            </div>
            <div className="dash-events-list">
              {latestEvents.length ? latestEvents.map((ev) => {
                const d = formatEventDate(ev.event_date);
                return (
                  <div key={ev.id} className="dash-event-row">
                    <div className="dash-event-date-block">
                      <span className="dash-event-month">{d.month}</span>
                      <span className="dash-event-day">{d.day}</span>
                    </div>
                    <div className="dash-event-info">
                      <h4 className="dash-event-title">{ev.title}</h4>
                      <p className="dash-event-meta">{ev.message?.slice(0, 60)}{ev.message && ev.message.length > 60 ? "..." : ""}</p>
                    </div>
                    <ChevronRight size={18} strokeWidth={1.5} className="dash-event-chevron" />
                  </div>
                );
              }) : (
                <p className="dash-empty">{t("dashboard.noEvents")}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Functional Sections ── */}
        <div className="dash-sections">
          {/* Church Platform Subscription — visible to admins */}
          {isChurchAdmin && (memberDashboard?.church_subscription || memberDashboard?.church_saas_settings) ? (() => {
            const sub = memberDashboard.church_subscription;
            const settings = memberDashboard.church_saas_settings;
            const amount = sub ? Number(sub.amount) : (settings?.church_subscription_enabled ? settings.church_subscription_amount : 0);
            const billingCycle = sub?.billing_cycle || "monthly";
            const status = sub?.status || (settings?.church_subscription_enabled ? "active" : "inactive");
            const nextDue = sub?.next_payment_date || null;
            const hasSubscription = Boolean(sub) || Boolean(settings?.church_subscription_enabled && amount > 0);
            const isCancelled = status === "cancelled";

            return (
              <div className="dash-section-card">
                <h3 className="dash-section-title">{t("dashboard.shalomAppSubscription")}</h3>
                {hasSubscription ? (
                  <>
                    <p className="dash-muted" style={{ marginBottom: "0.75rem" }}>
                      {t("dashboard.platformFeeDesc")}
                    </p>
                    <div className="dash-sub-stats">
                      <div className="dash-sub-stat">
                        <span className="dash-sub-stat-label">{t("common.amount")}</span>
                        <strong className="dash-sub-stat-value">{formatAmount(amount)}</strong>
                      </div>
                      <div className="dash-sub-stat">
                        <span className="dash-sub-stat-label">{t("dashboard.billing")}</span>
                        <strong className="dash-sub-stat-value" style={{ textTransform: "capitalize" }}>{billingCycle}</strong>
                      </div>
                      <div className="dash-sub-stat">
                        <span className="dash-sub-stat-label">Status</span>
                        <strong className="dash-sub-stat-value" style={{ textTransform: "capitalize" }}>{status}</strong>
                      </div>
                      {nextDue ? (
                        <div className="dash-sub-stat">
                          <span className="dash-sub-stat-label">{t("dashboard.nextDue")}</span>
                          <strong className="dash-sub-stat-value">{formatDate(nextDue)}</strong>
                        </div>
                      ) : null}
                    </div>

                    {/* Pay Now button */}
                    {!isCancelled && amount > 0 ? (
                      <div style={{ marginTop: "1rem" }}>
                        <button
                          className="btn btn-primary"
                          onClick={() => void paySaasFee()}
                          disabled={saasPayBusy}
                          style={{ minWidth: 160 }}
                        >
                          <Wallet size={16} strokeWidth={1.5} style={{ marginRight: 6 }} />
                          {saasPayBusy ? t("common.processing") : t("dashboard.payNowAmount", { amount: formatAmount(amount) })}
                        </button>
                      </div>
                    ) : null}

                    {/* Payment History toggle */}
                    <div style={{ marginTop: "1rem" }}>
                      <button
                        className="btn btn-ghost"
                        onClick={() => { if (!saasPaymentsLoaded) void loadSaasPayments(); else setSaasPaymentsLoaded(false); }}
                        style={{ fontSize: "0.85rem", padding: "4px 12px" }}
                      >
                        {saasPaymentsLoaded ? t("dashboard.hidePaymentHistory") : t("dashboard.viewPaymentHistory")}
                      </button>
                      {saasPaymentsLoaded && saasPayments.length > 0 ? (
                        <div style={{ marginTop: "0.75rem" }}>
                          <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--border-color, #ddd)", textAlign: "left" }}>
                                <th style={{ padding: "4px 8px" }}>{t("common.date")}</th>
                                <th style={{ padding: "4px 8px" }}>{t("common.amount")}</th>
                                <th style={{ padding: "4px 8px" }}>{t("common.method")}</th>
                                <th style={{ padding: "4px 8px" }}>{t("common.txnId")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {saasPayments.map((p) => (
                                <tr key={p.id} style={{ borderBottom: "1px solid var(--border-color, #eee)" }}>
                                  <td style={{ padding: "4px 8px" }}>{formatDate(p.payment_date)}</td>
                                  <td style={{ padding: "4px 8px" }}>{formatAmount(p.amount)}</td>
                                  <td style={{ padding: "4px 8px", textTransform: "capitalize" }}>{p.payment_method || "-"}</td>
                                  <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: "0.8rem" }}>{p.transaction_id ? p.transaction_id.slice(0, 16) : "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : saasPaymentsLoaded && saasPayments.length === 0 ? (
                        <p className="dash-muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{t("dashboard.noPaymentsRecorded")}</p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="dash-muted">
                    {t("dashboard.noPlatformSubscription")}
                  </p>
                )}
              </div>
            );
          })() : null}


        </div>
      </div>

      {/* ── Payment Summary Modal ── */}
      {showPaymentSummary ? (
        <section className="modal-overlay" role="dialog" aria-modal="true" aria-label="Payment summary"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPaymentSummary(false); }}>
          <article className="modal-card">
            <div className="modal-header">
              <h3>{t("dashboard.paymentSummary")}</h3>
              <button className="btn" onClick={() => setShowPaymentSummary(false)}>{t("common.close")}</button>
            </div>
            <p className="muted">{t("dashboard.paymentSummaryDesc")}</p>
            <div className="list-stack" style={{ margin: "12px 0" }}>
              {selectedDueSubscriptions.map((item) => (
                <div key={item.subscription_id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-color, #eee)" }}>
                  <span>{item.person_name}</span>
                  <strong>{formatAmount(item.amount)}</strong>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "1.1rem", padding: "8px 0", borderTop: "2px solid var(--border-color, #ccc)" }}>
              <span>{t("dashboard.total")}</span>
              <span>{formatAmount(selectedDueAmount)}</span>
            </div>
            <div className="actions-row" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => { setShowPaymentSummary(false); paySubscriptionDue(); }}
                disabled={busyKey === "pay-now"}>
                {busyKey === "pay-now" ? t("common.processing") : t("dashboard.confirmPay")}
              </button>
              <button className="btn" onClick={() => setShowPaymentSummary(false)}>{t("common.cancel")}</button>
            </div>
          </article>
        </section>
      ) : null}

      {cancelModalSubId ? (
        <section className="modal-overlay" onClick={() => setCancelModalSubId("")}>
          <article className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3 style={{ marginBottom: 12 }}>{t("dashboard.cancelSubscription")}</h3>
            <label htmlFor="cancel-reason" style={{ display: "block", marginBottom: 4, fontSize: "0.95rem" }}>
              {t("dashboard.cancelReasonLabel")}
            </label>
            <textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder={t("dashboard.cancelReasonPlaceholder")}
              style={{ width: "100%", resize: "vertical", marginBottom: 16, padding: 8, borderRadius: 6, border: "1px solid var(--border-color, #ccc)" }}
            />
            <div className="actions-row">
              <button className="btn btn-primary" onClick={confirmSubscriptionCancellation}>
                {t("dashboard.submitRequest")}
              </button>
              <button className="btn" onClick={() => setCancelModalSubId("")}>{t("common.goBack")}</button>
            </div>
          </article>
        </section>
      ) : null}
    </>
  );
}
