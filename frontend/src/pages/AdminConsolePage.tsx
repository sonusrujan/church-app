import { useState, useRef, lazy, Suspense, type MouseEvent } from "react";
import {
  CalendarDays,
  Church,
  CreditCard,
  Heart,
  Shield,
  ShieldCheck,
  UserPlus,
  Users,
  Activity,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  TrendingUp,
  XCircle,
  Gift,
  Download,
  FileText,
  DollarSign,
  RefreshCw,
  Edit,
  Upload,
  RotateCcw,
  Clock,
  Crown,
  Settings,
  BarChart3,
  AlertTriangle,
  Image,
  Megaphone,
  Bell,
  Trash2,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import LoadingSkeleton from "../components/LoadingSkeleton";
import NotificationBadge from "../components/NotificationBadge";
import PhotoUpload from "../components/PhotoUpload";
import { apiRequest } from "../lib/api";
import type { AdminTabKey } from "../types";

// ── Lazy-loaded tab components ──
const MemberOpsTab = lazy(() => import("./admin-tabs/MemberOpsTab"));
const ChurchOpsTab = lazy(() => import("./admin-tabs/ChurchOpsTab"));
const LeadershipTab = lazy(() => import("./admin-tabs/LeadershipTab"));
const AdminOpsTab = lazy(() => import("./admin-tabs/AdminOpsTab"));
const CreateChurchTab = lazy(() => import("./admin-tabs/CreateChurchTab"));
const RolesTab = lazy(() => import("./admin-tabs/RolesTab"));
const PaymentGatewayTab = lazy(() => import("./admin-tabs/PaymentGatewayTab"));
const SaaSSettingsTab = lazy(() => import("./admin-tabs/SaaSSettingsTab"));
const SaaSSubscriptionsTab = lazy(() => import("./admin-tabs/SaaSSubscriptionsTab"));
const PlatformRazorpayTab = lazy(() => import("./admin-tabs/PlatformRazorpayTab"));
const PreRegisterTab = lazy(() => import("./admin-tabs/PreRegisterTab"));
const MembershipRequestsTab = lazy(() => import("./admin-tabs/MembershipRequestsTab"));
const FamilyRequestsTab = lazy(() => import("./admin-tabs/FamilyRequestsTab"));
const CancellationRequestsTab = lazy(() => import("./admin-tabs/CancellationRequestsTab"));
const TrialTab = lazy(() => import("./admin-tabs/TrialTab"));
const IncomeDashboardTab = lazy(() => import("./admin-tabs/IncomeDashboardTab"));
const ManualPaymentTab = lazy(() => import("./admin-tabs/ManualPaymentTab"));
const RefundsTab = lazy(() => import("./admin-tabs/RefundsTab"));
const RefundRequestsTab = lazy(() => import("./admin-tabs/RefundRequestsTab"));
const EditSubscriptionTab = lazy(() => import("./admin-tabs/EditSubscriptionTab"));
const CreateSubscriptionTab = lazy(() => import("./admin-tabs/CreateSubscriptionTab"));
const PaymentHistoryTab = lazy(() => import("./admin-tabs/PaymentHistoryTab"));
const BulkImportTab = lazy(() => import("./admin-tabs/BulkImportTab"));
const RestoreTab = lazy(() => import("./admin-tabs/RestoreTab"));
const ScheduledReportsTab = lazy(() => import("./admin-tabs/ScheduledReportsTab"));
const ExportTab = lazy(() => import("./admin-tabs/ExportTab"));
const EventsTab = lazy(() => import("./admin-tabs/EventsTab"));
const ActivityLogTab = lazy(() => import("./admin-tabs/ActivityLogTab"));
const AuditLogTab = lazy(() => import("./admin-tabs/AuditLogTab"));
const DioceseTab = lazy(() => import("./admin-tabs/DioceseTab"));
const AdBannerTab = lazy(() => import("./admin-tabs/AdBannerTab"));
const AnnouncementsTab = lazy(() => import("./admin-tabs/AnnouncementsTab"));
const SpecialDatesTab = lazy(() => import("./admin-tabs/SpecialDatesTab"));
const DonationFundsTab = lazy(() => import("./admin-tabs/DonationFundsTab"));
const PushNotificationTab = lazy(() => import("./admin-tabs/PushNotificationTab"));
const AccountDeletionRequestsTab = lazy(() => import("./admin-tabs/AccountDeletionRequestsTab"));

export default function AdminConsolePage() {
  const { t } = useI18n();
  const {
    token,
    isSuperAdmin,
    isAdminUser,
    isChurchAdmin,
    memberDashboard,
    refreshMemberDashboard,
    openOperationConfirmDialog,
    adminCounts,
  } = useApp();

  const [activeAdminTab, setActiveAdminTab] = useState<AdminTabKey>("members");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [mobileToolOpen, setMobileToolOpen] = useState(false);

  function selectTab(tab: AdminTabKey) {
    setActiveAdminTab(tab);
    setMobileToolOpen(true);
  }

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  }

  // ── keyboard nav ──
  const adminTabs: AdminTabKey[] = isSuperAdmin
    ? ["members", "churches", "leadership", "diocese", "ad-banners", "admins", "create-church", "roles", "payments", "saas-settings", "saas-subscriptions", "platform-razorpay", "pre-register", "membership-requests", "family-requests", "cancellation-requests", "account-deletion-requests", "trial", "income-dashboard", "manual-payment", "refunds", "refund-requests", "create-subscription", "subscriptions", "payment-history", "bulk-import", "restore", "scheduled-reports", "export", "special-dates", "audit-log", "announcements", "events", "activity", "push-notifications"]
    : isChurchAdmin
      ? ["members", "leadership", "pre-register", "membership-requests", "family-requests", "cancellation-requests", "account-deletion-requests", "income-dashboard", "manual-payment", "refunds", "refund-requests", "create-subscription", "subscriptions", "payment-history", "bulk-import", "church-logo", "special-dates", "audit-log", "announcements", "events", "activity"]
      : [];

  function handleAdminNavKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const idx = adminTabs.indexOf(activeAdminTab);
    if (idx === -1) return;
    const next = e.key === "ArrowDown"
      ? (idx + 1) % adminTabs.length
      : (idx - 1 + adminTabs.length) % adminTabs.length;
    setActiveAdminTab(adminTabs[next]);
    const nav = (e.currentTarget as HTMLElement);
    const buttons = nav.querySelectorAll<HTMLButtonElement>(".admin-tree-item");
    buttons[next]?.focus();
  }

  // ── confirm-capture logic ──
  // Uses data-confirm attribute on buttons instead of parsing button text (i18n-safe)

  function getActionConfirmKeyword(button: HTMLButtonElement): string | null {
    // First check for explicit data-confirm attribute (preferred, i18n-safe)
    const dataConfirm = button.getAttribute("data-confirm");
    if (dataConfirm) return dataConfirm;

    // Fallback: check button text for known English keywords
    const normalized = (button.textContent || "").trim().toLowerCase();
    if (!normalized) return null;
    if (
      normalized.startsWith("search") ||
      normalized.startsWith("fetch") ||
      normalized.startsWith("select") ||
      normalized.startsWith("preview") ||
      normalized.startsWith("refresh") ||
      normalized.startsWith("load")
    )
      return null;
    if (normalized.includes("delete")) return "DELETE";
    if (normalized.includes("transfer")) return "TRANSFER";
    if (normalized.includes("update")) return "UPDATE";
    if (normalized.includes("remove")) return "REMOVE";
    if (normalized.includes("grant")) return "GRANT";
    if (normalized.includes("revoke")) return "REVOKE";
    return null;
  }

  const confirmBypassRef = useRef(false);

  function handleAdminToolsActionConfirmCapture(event: MouseEvent<HTMLElement>) {
    if (!isSuperAdmin) return;
    if (confirmBypassRef.current) return;

    const target = event.target as HTMLElement | null;
    const button = target?.closest("button");
    if (!button || button.disabled) return;

    const label = (button.textContent || t("admin.operation")).trim().replace(/\s+/g, " ");
    const keyword = getActionConfirmKeyword(button);
    if (!keyword) return;

    event.preventDefault();
    event.stopPropagation();

    openOperationConfirmDialog(
      t("admin.confirmActionTitle", { label }),
      t("admin.confirmActionDescription", { label, keyword }),
      keyword,
      async () => {
        confirmBypassRef.current = true;
        try {
          button.click();
        } finally {
          confirmBypassRef.current = false;
        }
      },
    );
  }

  // ── JSX ──

  return (
    <div className={`admin-console${mobileToolOpen ? " admin-tool-open" : ""}`} onClickCapture={handleAdminToolsActionConfirmCapture}>
      {/* ── Tree Navigation Sidebar ── */}
      <nav className="admin-tree-nav" onKeyDown={handleAdminNavKeyDown}>
        <p className="admin-tree-title">{t("admin.console")}</p>

        {isSuperAdmin ? (
          <>
            <button className="admin-tree-group-toggle" onClick={() => toggleGroup("operations")} aria-expanded={!collapsedGroups.operations}>
              <span>{t("admin.operations")}</span>
              <span className="group-badge">6</span>
              <ChevronDown size={14} strokeWidth={1.5} className={`group-chevron${collapsedGroups.operations ? " collapsed" : ""}`} />
            </button>
            <div className="admin-tree-group-items" data-collapsed={collapsedGroups.operations || undefined}>
              <button className={`admin-tree-item${activeAdminTab === "members" ? " active" : ""}`} onClick={() => selectTab("members")}>
                <Users size={16} strokeWidth={1.5} /> <span>{t("admin.members")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "churches" ? " active" : ""}`} onClick={() => selectTab("churches")}>
                <Church size={16} strokeWidth={1.5} /> <span>{t("admin.churches")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "leadership" ? " active" : ""}`} onClick={() => selectTab("leadership")}>
                <Crown size={16} strokeWidth={1.5} /> <span>{t("admin.leadership")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "diocese" ? " active" : ""}`} onClick={() => selectTab("diocese")}>
                <Crown size={16} strokeWidth={1.5} /> <span>{t("admin.diocese")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "ad-banners" ? " active" : ""}`} onClick={() => selectTab("ad-banners")}>
                <Image size={16} strokeWidth={1.5} /> <span>{t("admin.adBanners")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "push-notifications" ? " active" : ""}`} onClick={() => selectTab("push-notifications")}>
                <Bell size={16} strokeWidth={1.5} /> <span>{t("admin.pushSms")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "admins" ? " active" : ""}`} onClick={() => selectTab("admins")}>
                <ShieldCheck size={16} strokeWidth={1.5} /> <span>{t("admin.admins")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
            </div>

            <button className="admin-tree-group-toggle" onClick={() => toggleGroup("setup")} aria-expanded={!collapsedGroups.setup}>
              <span>{t("admin.setup")}</span>
              <span className="group-badge">3</span>
              <ChevronDown size={14} strokeWidth={1.5} className={`group-chevron${collapsedGroups.setup ? " collapsed" : ""}`} />
            </button>
            <div className="admin-tree-group-items" data-collapsed={collapsedGroups.setup || undefined}>
              <button className={`admin-tree-item${activeAdminTab === "create-church" ? " active" : ""}`} onClick={() => selectTab("create-church")}>
                <Church size={16} strokeWidth={1.5} /> <span>{t("admin.createChurch")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "roles" ? " active" : ""}`} onClick={() => selectTab("roles")}>
                <Shield size={16} strokeWidth={1.5} /> <span>{t("admin.roleManagement")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "payments" ? " active" : ""}`} onClick={() => selectTab("payments")}>
                <CreditCard size={16} strokeWidth={1.5} /> <span>{t("admin.paymentGateway")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
            </div>

            <button className="admin-tree-group-toggle" onClick={() => toggleGroup("saas")} aria-expanded={!collapsedGroups.saas}>
              <span>{t("admin.saasPlatform")}</span>
              <span className="group-badge">3</span>
              <ChevronDown size={14} strokeWidth={1.5} className={`group-chevron${collapsedGroups.saas ? " collapsed" : ""}`} />
            </button>
            <div className="admin-tree-group-items" data-collapsed={collapsedGroups.saas || undefined}>
              <button className={`admin-tree-item${activeAdminTab === "saas-settings" ? " active" : ""}`} onClick={() => selectTab("saas-settings")}>
                <Settings size={16} strokeWidth={1.5} /> <span>{t("admin.platformSettings")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "saas-subscriptions" ? " active" : ""}`} onClick={() => selectTab("saas-subscriptions")}>
                <BarChart3 size={16} strokeWidth={1.5} /> <span>{t("admin.churchSubscriptions")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "platform-razorpay" ? " active" : ""}`} onClick={() => selectTab("platform-razorpay")}>
                <DollarSign size={16} strokeWidth={1.5} /> <span>{t("admin.platformRazorpay")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
            </div>

            <button className="admin-tree-group-toggle" onClick={() => toggleGroup("management")} aria-expanded={!collapsedGroups.management}>
              <span>{t("admin.management")}</span>
              <span className="group-badge">2</span>
              <ChevronDown size={14} strokeWidth={1.5} className={`group-chevron${collapsedGroups.management ? " collapsed" : ""}`} />
            </button>
            <div className="admin-tree-group-items" data-collapsed={collapsedGroups.management || undefined}>
              <button className={`admin-tree-item${activeAdminTab === "trial" ? " active" : ""}`} onClick={() => selectTab("trial")}>
                <Gift size={16} strokeWidth={1.5} /> <span>{t("admin.freeTrial")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "restore" ? " active" : ""}`} onClick={() => selectTab("restore")}>
                <RotateCcw size={16} strokeWidth={1.5} /> <span>{t("admin.restoreRelink")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
            </div>
          </>
        ) : null}

        {isAdminUser ? (
          <>
            <button className="admin-tree-group-toggle" onClick={() => toggleGroup("finance")} aria-expanded={!collapsedGroups.finance}>
              <span>{t("admin.finance")}</span>
              <span className="group-badge">7</span>
              <ChevronDown size={14} strokeWidth={1.5} className={`group-chevron${collapsedGroups.finance ? " collapsed" : ""}`} />
            </button>
            <div className="admin-tree-group-items" data-collapsed={collapsedGroups.finance || undefined}>
              <button className={`admin-tree-item${activeAdminTab === "income-dashboard" ? " active" : ""}`} onClick={() => selectTab("income-dashboard")}>
                <TrendingUp size={16} strokeWidth={1.5} /> <span>{t("admin.incomeDashboard")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "manual-payment" ? " active" : ""}`} onClick={() => selectTab("manual-payment")}>
                <DollarSign size={16} strokeWidth={1.5} /> <span>{t("admin.manualPayment")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "refunds" ? " active" : ""}`} onClick={() => selectTab("refunds")}>
                <RefreshCw size={16} strokeWidth={1.5} /> <span>{t("admin.refunds")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "create-subscription" ? " active" : ""}`} onClick={() => selectTab("create-subscription")}>
                <UserPlus size={16} strokeWidth={1.5} /> <span>{t("admin.createSubscription")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "subscriptions" ? " active" : ""}`} onClick={() => selectTab("subscriptions")}>
                <Edit size={16} strokeWidth={1.5} /> <span>{t("admin.editSubscription")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "payment-history" ? " active" : ""}`} onClick={() => selectTab("payment-history")}>
                <CreditCard size={16} strokeWidth={1.5} /> <span>{t("admin.paymentHistory")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "refund-requests" ? " active" : ""}`} onClick={() => selectTab("refund-requests")}>
                <AlertTriangle size={16} strokeWidth={1.5} /> <span>{t("admin.refundRequests")}</span> <NotificationBadge count={adminCounts?.refund_requests ?? 0} /> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
              <button className={`admin-tree-item${activeAdminTab === "donation-funds" ? " active" : ""}`} onClick={() => selectTab("donation-funds")}>
                <Heart size={16} strokeWidth={1.5} /> <span>{t("admin.donationFunds")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
              </button>
            </div>
          </>
        ) : null}

        <button className="admin-tree-group-toggle" onClick={() => toggleGroup("general")} aria-expanded={!collapsedGroups.general}>
          <span>{t("admin.general")}</span>
          <ChevronDown size={14} strokeWidth={1.5} className={`group-chevron${collapsedGroups.general ? " collapsed" : ""}`} />
        </button>
        <div className="admin-tree-group-items" data-collapsed={collapsedGroups.general || undefined}>
          {isChurchAdmin ? (
            <button className={`admin-tree-item${activeAdminTab === "members" ? " active" : ""}`} onClick={() => selectTab("members")}>
              <Users size={16} strokeWidth={1.5} /> <span>{t("admin.members")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isChurchAdmin ? (
            <button className={`admin-tree-item${activeAdminTab === "leadership" ? " active" : ""}`} onClick={() => selectTab("leadership")}>
              <Crown size={16} strokeWidth={1.5} /> <span>{t("admin.leadership")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "pre-register" ? " active" : ""}`} onClick={() => selectTab("pre-register")}>
              <UserPlus size={16} strokeWidth={1.5} /> <span>{t("admin.preRegister")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "membership-requests" ? " active" : ""}`} onClick={() => selectTab("membership-requests")}>
              <ClipboardList size={16} strokeWidth={1.5} /> <span>{t("admin.joinRequests")}</span> <NotificationBadge count={adminCounts?.membership_requests ?? 0} /> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "family-requests" ? " active" : ""}`} onClick={() => selectTab("family-requests")}>
              <Users size={16} strokeWidth={1.5} /> <span>{t("admin.familyRequests")}</span> <NotificationBadge count={adminCounts?.family_requests ?? 0} /> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "cancellation-requests" ? " active" : ""}`} onClick={() => selectTab("cancellation-requests")}>
              <XCircle size={16} strokeWidth={1.5} /> <span>{t("admin.cancellations")}</span> <NotificationBadge count={adminCounts?.cancellation_requests ?? 0} /> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "account-deletion-requests" ? " active" : ""}`} onClick={() => selectTab("account-deletion-requests")}>
              <Trash2 size={16} strokeWidth={1.5} /> <span>{t("admin.accountDeletionRequests")}</span> <NotificationBadge count={adminCounts?.account_deletion_requests ?? 0} /> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "bulk-import" ? " active" : ""}`} onClick={() => selectTab("bulk-import")}>
              <Upload size={16} strokeWidth={1.5} /> <span>{t("admin.bulkImport")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isChurchAdmin ? (
            <button className={`admin-tree-item${activeAdminTab === "church-logo" ? " active" : ""}`} onClick={() => selectTab("church-logo")}>
              <Image size={16} strokeWidth={1.5} /> <span>{t("admin.churchLogo")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isSuperAdmin ? (
            <button className={`admin-tree-item${activeAdminTab === "scheduled-reports" ? " active" : ""}`} onClick={() => selectTab("scheduled-reports")}>
              <Clock size={16} strokeWidth={1.5} /> <span>{t("admin.scheduledReports")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isSuperAdmin ? (
            <button className={`admin-tree-item${activeAdminTab === "export" ? " active" : ""}`} onClick={() => selectTab("export")}>
              <Download size={16} strokeWidth={1.5} /> <span>{t("admin.dataExport")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "special-dates" ? " active" : ""}`} onClick={() => selectTab("special-dates")}>
              <Gift size={16} strokeWidth={1.5} /> <span>{t("admin.specialDates")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "audit-log" ? " active" : ""}`} onClick={() => selectTab("audit-log")}>
              <FileText size={16} strokeWidth={1.5} /> <span>{t("admin.auditLog")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "announcements" ? " active" : ""}`} onClick={() => selectTab("announcements")}>
              <Megaphone size={16} strokeWidth={1.5} /> <span>{t("admin.announcements")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "events" ? " active" : ""}`} onClick={() => selectTab("events")}>
              <CalendarDays size={16} strokeWidth={1.5} /> <span>{t("admin.eventsAlerts")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
          {isAdminUser ? (
            <button className={`admin-tree-item${activeAdminTab === "activity" ? " active" : ""}`} onClick={() => selectTab("activity")}>
              <Activity size={16} strokeWidth={1.5} /> <span>{t("admin.activityLog")}</span> <ChevronRight size={14} strokeWidth={1.5} className="admin-tree-arrow" />
            </button>
          ) : null}
        </div>
      </nav>

      {/* ── Content Area ── */}
      <section className="admin-content">
        <button className="admin-back-btn" onClick={() => setMobileToolOpen(false)}>
          <ChevronLeft size={16} strokeWidth={1.5} /> {t("admin.backToTools")}
        </button>
        {activeAdminTab === "members" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><MemberOpsTab /></Suspense> : null}
        {activeAdminTab === "churches" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><ChurchOpsTab /></Suspense> : null}
        {activeAdminTab === "leadership" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><LeadershipTab /></Suspense> : null}
        {activeAdminTab === "admins" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><AdminOpsTab /></Suspense> : null}
        {activeAdminTab === "pre-register" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><PreRegisterTab /></Suspense> : null}
        {activeAdminTab === "roles" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><RolesTab /></Suspense> : null}
        {activeAdminTab === "create-church" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><CreateChurchTab /></Suspense> : null}
        {activeAdminTab === "payments" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><PaymentGatewayTab /></Suspense> : null}
        {activeAdminTab === "announcements" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><AnnouncementsTab /></Suspense> : null}
        {activeAdminTab === "events" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><EventsTab /></Suspense> : null}
        {activeAdminTab === "activity" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><ActivityLogTab /></Suspense> : null}
        {activeAdminTab === "membership-requests" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><MembershipRequestsTab /></Suspense> : null}
        {activeAdminTab === "family-requests" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><FamilyRequestsTab /></Suspense> : null}
        {activeAdminTab === "cancellation-requests" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><CancellationRequestsTab /></Suspense> : null}
        {activeAdminTab === "account-deletion-requests" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><AccountDeletionRequestsTab /></Suspense> : null}
        {activeAdminTab === "trial" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><TrialTab /></Suspense> : null}
        {activeAdminTab === "income-dashboard" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><IncomeDashboardTab /></Suspense> : null}
        {activeAdminTab === "manual-payment" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><ManualPaymentTab /></Suspense> : null}
        {activeAdminTab === "refunds" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><RefundsTab /></Suspense> : null}
        {activeAdminTab === "create-subscription" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><CreateSubscriptionTab /></Suspense> : null}
        {activeAdminTab === "subscriptions" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><EditSubscriptionTab /></Suspense> : null}
        {activeAdminTab === "payment-history" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><PaymentHistoryTab /></Suspense> : null}
        {activeAdminTab === "bulk-import" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><BulkImportTab /></Suspense> : null}
        {activeAdminTab === "restore" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><RestoreTab /></Suspense> : null}
        {activeAdminTab === "scheduled-reports" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><ScheduledReportsTab /></Suspense> : null}
        {activeAdminTab === "export" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><ExportTab /></Suspense> : null}
        {activeAdminTab === "saas-settings" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><SaaSSettingsTab /></Suspense> : null}
        {activeAdminTab === "saas-subscriptions" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><SaaSSubscriptionsTab /></Suspense> : null}
        {activeAdminTab === "platform-razorpay" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><PlatformRazorpayTab /></Suspense> : null}
        {activeAdminTab === "refund-requests" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><RefundRequestsTab /></Suspense> : null}
        {activeAdminTab === "diocese" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><DioceseTab /></Suspense> : null}
        {activeAdminTab === "ad-banners" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><AdBannerTab /></Suspense> : null}
        {activeAdminTab === "church-logo" && isChurchAdmin ? (
          <div style={{ maxWidth: 480 }}>
            <h2 style={{ marginBottom: "0.5rem" }}>{t("admin.churchLogo")}</h2>
            <p style={{ fontSize: "0.9rem", color: "var(--on-surface-variant)", marginBottom: "1rem" }}>
              {t("admin.churchLogoDescription")}
            </p>
            <PhotoUpload
              currentUrl={memberDashboard?.church?.logo_url || ""}
              onUploaded={async (url) => {
                await apiRequest("/api/churches/my-logo", { method: "PATCH", token, body: { logo_url: url } });
                refreshMemberDashboard();
              }}
              onDeleted={async () => {
                await apiRequest("/api/churches/my-logo", { method: "PATCH", token, body: { logo_url: "" } });
                refreshMemberDashboard();
              }}
              token={token}
              folder="logos"
              size={80}
              fallback={<span style={{ fontSize: "1.5rem" }}>🏛</span>}
            />
          </div>
        ) : null}
        {activeAdminTab === "special-dates" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><SpecialDatesTab /></Suspense> : null}
        {activeAdminTab === "audit-log" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><AuditLogTab /></Suspense> : null}
        {activeAdminTab === "push-notifications" && isSuperAdmin ? <Suspense fallback={<LoadingSkeleton />}><PushNotificationTab /></Suspense> : null}
        {activeAdminTab === "donation-funds" && isAdminUser ? <Suspense fallback={<LoadingSkeleton />}><DonationFundsTab /></Suspense> : null}
      </section>
    </div>
  );
}
