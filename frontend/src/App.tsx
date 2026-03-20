import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Church,
  CreditCard,
  History,
  LayoutDashboard,
  LogOut,
  Shield,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
  Activity,
  ChevronRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiRequest } from "./lib/api";
import shalomLogo from "./assets/shalom-logo.png";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

const mockGrowthData = [
  { month: "Jan", members: 120, attendance: 200 },
  { month: "Feb", members: 135, attendance: 220 },
  { month: "Mar", members: 160, attendance: 270 },
  { month: "Apr", members: 190, attendance: 310 },
  { month: "May", members: 210, attendance: 340 },
  { month: "Jun", members: 250, attendance: 400 },
];

const mockIncomeData = [
  { day: "Mon", income: 420 },
  { day: "Tue", income: 380 },
  { day: "Wed", income: 850 },
  { day: "Thu", income: 300 },
  { day: "Fri", income: 640 },
  { day: "Sat", income: 1100 },
  { day: "Sun", income: 3200 },
];

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url?: string | null;
  role: string;
  church_id: string | null;
};

type AdminRow = ProfileRow;

type ChurchRow = {
  id: string;
  church_code?: string | null;
  unique_id?: string;
  name: string;
  address?: string | null;
  location: string | null;
  contact_phone?: string | null;
  admin_count?: number;
  member_count?: number;
  pastor_count?: number;
};

type NoticeTone = "neutral" | "success" | "error";

type AuthContext = {
  auth: {
    id: string;
    email: string;
    role: string;
    church_id: string;
  };
  profile: ProfileRow;
  is_super_admin: boolean;
};

type MemberRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone_number: string | null;
  alt_phone_number: string | null;
  address: string | null;
  membership_id: string | null;
  verification_status: string | null;
  subscription_amount: number | string | null;
  church_id: string | null;
  created_at: string;
};

type SubscriptionRow = {
  id: string;
  member_id: string;
  family_member_id: string | null;
  plan_name: string;
  amount: number | string;
  billing_cycle: string;
  start_date: string;
  next_payment_date: string;
  status: string;
  person_name?: string;
};

type FamilyMemberRow = {
  id: string;
  member_id: string;
  full_name: string;
  gender: string | null;
  relation: string | null;
  age: number | null;
  dob: string | null;
  has_subscription: boolean;
  created_at: string;
};

type DueSubscriptionRow = {
  subscription_id: string;
  family_member_id: string | null;
  person_name: string;
  amount: number;
  billing_cycle: string;
  next_payment_date: string;
  status: string;
};

type ReceiptRow = {
  id: string;
  member_id: string;
  subscription_id: string | null;
  amount: number | string;
  payment_method: string | null;
  transaction_id: string | null;
  payment_status: string | null;
  payment_date: string;
  receipt_number: string | null;
  receipt_download_path: string;
};

type HistoryRow = {
  id: string;
  type: "subscription" | "payment";
  title: string;
  status: string;
  amount: number;
  date: string;
};

type SubscriptionEventRow = {
  id: string;
  member_id: string;
  subscription_id: string | null;
  church_id: string | null;
  event_type: string;
  status_before: string | null;
  status_after: string | null;
  amount: number | string | null;
  source: string;
  metadata: Record<string, unknown>;
  event_at: string;
  created_at: string;
};

type MemberDashboard = {
  profile: ProfileRow;
  church: {
    id: string;
    church_code?: string | null;
    name: string;
    address?: string | null;
    location: string | null;
    contact_phone: string | null;
    created_at: string;
  } | null;
  member: MemberRow | null;
  family_members: FamilyMemberRow[];
  subscriptions: SubscriptionRow[];
  due_subscriptions: DueSubscriptionRow[];
  receipts: ReceiptRow[];
  donations: {
    total_paid: number;
    successful_count: number;
    last_payment_date: string | null;
  };
  history: HistoryRow[];
  tracking: {
    current_status: string;
    next_due_date: string | null;
    latest_event_at: string | null;
    events: SubscriptionEventRow[];
  };
};

type PreRegisterResult = {
  user: AdminRow;
  member: MemberRow;
};

type PaymentConfigResponse = {
  payments_enabled: boolean;
  key_id: string;
  source?: string;
  reason?: string;
};

type ChurchPaymentSettings = {
  church_id: string;
  payments_enabled: boolean;
  key_id: string;
  has_key_secret: boolean;
  schema_ready: boolean;
};

type IncomeSummary = {
  church_id: string;
  daily_income: number;
  monthly_income: number;
  yearly_income: number;
  successful_payments_count: number;
};

type PastorRow = {
  id: string;
  church_id: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  details: string | null;
  is_active: boolean;
};

type EventRow = {
  id: string;
  church_id: string;
  title: string;
  message: string;
  event_date: string | null;
  created_at: string;
};

type NotificationRow = {
  id: string;
  church_id: string;
  title: string;
  message: string;
  created_at: string;
};

type MemberDeleteImpact = {
  family_members: number;
  subscriptions: number;
  payments: number;
};

type ChurchDeleteImpact = {
  users: number;
  members: number;
  pastors: number;
  church_events: number;
  church_notifications: number;
  prayer_requests: number;
  payments: number;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_REGEX.test(value);
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatAmount(value?: number | string | null) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "Rs 0.00";
  }
  return `Rs ${amount.toFixed(2)}`;
}

function initials(fullName: string | null | undefined, email: string) {
  const source = (fullName || email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "U";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function toReadableEvent(eventType: string) {
  return eventType
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function loadRazorpayCheckoutScript() {
  if ((window as any).Razorpay) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function SignOutPage({ onSignOut, busy }: { onSignOut: () => Promise<void>; busy: boolean }) {
  useEffect(() => {
    void onSignOut();
  }, []);

  return (
    <section className="auth-shell">
      <section className="auth-card">
        <h1>Signing Out</h1>
        <p>{busy ? "Ending your session..." : "Redirecting..."}</p>
      </section>
    </section>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authContext, setAuthContext] = useState<AuthContext | null>(null);
  const [memberDashboard, setMemberDashboard] = useState<MemberDashboard | null>(null);

  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);

  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string }>({
    tone: "neutral",
    text: "Sign in with Google to continue.",
  });
  const [busyKey, setBusyKey] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapRetry, setBootstrapRetry] = useState(0);

  const [profileName, setProfileName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileAltPhone, setProfileAltPhone] = useState("");
  const [profileSubscriptionAmount, setProfileSubscriptionAmount] = useState("");
  const [profileSubscriptionEditable, setProfileSubscriptionEditable] = useState(false);

  const [preRegEmail, setPreRegEmail] = useState("");
  const [preRegName, setPreRegName] = useState("");
  const [preRegMembershipId, setPreRegMembershipId] = useState("");
  const [preRegAddress, setPreRegAddress] = useState("");
  const [preRegAmount, setPreRegAmount] = useState("");
  const [preRegChurchId, setPreRegChurchId] = useState("");
  const [preRegResult, setPreRegResult] = useState<PreRegisterResult | null>(null);
  const [churchCreateName, setChurchCreateName] = useState("");
  const [churchCreateAddress, setChurchCreateAddress] = useState("");
  const [churchCreateLocation, setChurchCreateLocation] = useState("");
  const [churchCreatePhone, setChurchCreatePhone] = useState("");
  const [churchCreateAdmins, setChurchCreateAdmins] = useState("");
  const [paymentConfigChurchId, setPaymentConfigChurchId] = useState("");
  const [churchPaymentEnabled, setChurchPaymentEnabled] = useState(false);
  const [churchPaymentKeyId, setChurchPaymentKeyId] = useState("");
  const [churchPaymentKeySecret, setChurchPaymentKeySecret] = useState("");
  const [churchPaymentHasSecret, setChurchPaymentHasSecret] = useState(false);
  const [churchPaymentSchemaReady, setChurchPaymentSchemaReady] = useState(true);

  const [grantEmail, setGrantEmail] = useState("");
  const [grantChurchId, setGrantChurchId] = useState("");
  const [revokeEmail, setRevokeEmail] = useState("");

  const [eventTitle, setEventTitle] = useState("");
  const [eventMessage, setEventMessage] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [donationAmount, setDonationAmount] = useState("");
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [pastors, setPastors] = useState<PastorRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [incomeSummary, setIncomeSummary] = useState<IncomeSummary | null>(null);
  const [pastorChurchId, setPastorChurchId] = useState("");
  const [pastorName, setPastorName] = useState("");
  const [pastorPhone, setPastorPhone] = useState("");
  const [pastorEmail, setPastorEmail] = useState("");
  const [pastorDetails, setPastorDetails] = useState("");
  const [pastorTransferChurchId, setPastorTransferChurchId] = useState("");
  const [superMemberChurchId, setSuperMemberChurchId] = useState("");
  const [superMemberQuery, setSuperMemberQuery] = useState("");
  const [superMemberResults, setSuperMemberResults] = useState<MemberRow[]>([]);
  const [superMemberSelectedId, setSuperMemberSelectedId] = useState("");
  const [superMemberEditName, setSuperMemberEditName] = useState("");
  const [superMemberEditStatus, setSuperMemberEditStatus] = useState("");
  const [superMemberDeleteImpact, setSuperMemberDeleteImpact] = useState<MemberDeleteImpact | null>(null);
  const [superChurchQuery, setSuperChurchQuery] = useState("");
  const [superChurchResults, setSuperChurchResults] = useState<ChurchRow[]>([]);
  const [superChurchSelectedId, setSuperChurchSelectedId] = useState("");
  const [superChurchEditName, setSuperChurchEditName] = useState("");
  const [superChurchEditAddress, setSuperChurchEditAddress] = useState("");
  const [superChurchEditLocation, setSuperChurchEditLocation] = useState("");
  const [superChurchEditPhone, setSuperChurchEditPhone] = useState("");
  const [superChurchDeleteImpact, setSuperChurchDeleteImpact] = useState<ChurchDeleteImpact | null>(null);
  const [superChurchIncome, setSuperChurchIncome] = useState<IncomeSummary | null>(null);
  const [superPastorFromChurchId, setSuperPastorFromChurchId] = useState("");
  const [superPastorQuery, setSuperPastorQuery] = useState("");
  const [superPastorResults, setSuperPastorResults] = useState<PastorRow[]>([]);
  const [superPastorSelectedId, setSuperPastorSelectedId] = useState("");
  const [superPastorTargetChurchId, setSuperPastorTargetChurchId] = useState("");
  const [superPastorEditName, setSuperPastorEditName] = useState("");
  const [superPastorEditPhone, setSuperPastorEditPhone] = useState("");
  const [superPastorEditEmail, setSuperPastorEditEmail] = useState("");
  const [superAdminChurchId, setSuperAdminChurchId] = useState("");
  const [superAdminQuery, setSuperAdminQuery] = useState("");
  const [superAdminResults, setSuperAdminResults] = useState<AdminRow[]>([]);
  const [superAdminSelectedId, setSuperAdminSelectedId] = useState("");
  const [superAdminEditName, setSuperAdminEditName] = useState("");
  const [superAdminTargetChurchId, setSuperAdminTargetChurchId] = useState("");
  const [prayerDetails, setPrayerDetails] = useState("");
  const [selectedPastorIds, setSelectedPastorIds] = useState<string[]>([]);
  const [familyMemberName, setFamilyMemberName] = useState("");
  const [familyMemberGender, setFamilyMemberGender] = useState("");
  const [familyMemberRelation, setFamilyMemberRelation] = useState("");
  const [familyMemberAge, setFamilyMemberAge] = useState("");
  const [familyMemberDob, setFamilyMemberDob] = useState("");
  const [familyMemberWithSubscription, setFamilyMemberWithSubscription] = useState(false);
  const [familyMemberSubscriptionAmount, setFamilyMemberSubscriptionAmount] = useState("");
  const [selectedDueSubscriptionIds, setSelectedDueSubscriptionIds] = useState<string[]>([]);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [paymentConfigError, setPaymentConfigError] = useState("");
  const [activeAdminTab, setActiveAdminTab] = useState<
    "members" | "churches" | "pastors" | "admins" | "pre-register" | "roles" | "create-church" | "payments" | "events" | "activity"
  >("members");
  const [showOperationConfirmModal, setShowOperationConfirmModal] = useState(false);
  const [operationConfirmTitle, setOperationConfirmTitle] = useState("");
  const [operationConfirmDescription, setOperationConfirmDescription] = useState("");
  const [operationConfirmKeyword, setOperationConfirmKeyword] = useState("CONFIRM");
  const [operationConfirmChecked, setOperationConfirmChecked] = useState(false);
  const [operationConfirmInput, setOperationConfirmInput] = useState("");
  const operationConfirmActionRef = useRef<null | (() => void | Promise<void>)>(null);
  const operationConfirmBypassRef = useRef(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  const token = session?.access_token || "";
  const userEmail = session?.user?.email || "";

  const isSuperAdmin = Boolean(authContext?.is_super_admin);
  const isAdminUser = Boolean(authContext && (authContext.profile.role === "admin" || isSuperAdmin));
  const isChurchAdmin = Boolean(isAdminUser && !isSuperAdmin);
  const isMemberOnlyUser = Boolean(authContext && !isAdminUser);

  const workspaceToneClass = isSuperAdmin
    ? "super-admin-layout"
    : isChurchAdmin
      ? "admin-layout"
      : "member-layout";

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith("/profile")) {
      return "Profile";
    }
    if (location.pathname.startsWith("/history")) {
      return "History";
    }
    if (location.pathname.startsWith("/events")) {
      return "Events";
    }
    if (location.pathname.startsWith("/admin-tools")) {
      return isSuperAdmin ? "Super Admin Console" : "Admin Section";
    }
    return "Dashboard";
  }, [isSuperAdmin, location.pathname]);

  function getActionConfirmKeyword(label: string) {
    const normalized = label.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (
      normalized.startsWith("search") ||
      normalized.startsWith("fetch") ||
      normalized.startsWith("select") ||
      normalized.startsWith("preview") ||
      normalized.startsWith("refresh") ||
      normalized.startsWith("load")
    ) {
      return null;
    }

    if (normalized.includes("delete")) return "DELETE";
    if (normalized.includes("transfer")) return "TRANSFER";
    if (normalized.includes("update")) return "UPDATE";
    if (normalized.includes("remove")) return "REMOVE";
    if (normalized.includes("grant")) return "GRANT";
    if (normalized.includes("revoke")) return "REVOKE";
    if (normalized.includes("create")) return "CREATE";
    if (normalized.includes("add")) return "ADD";
    if (normalized.includes("pre-register")) return "REGISTER";
    if (normalized.includes("save")) return "SAVE";
    if (normalized.includes("post")) return "POST";

    return null;
  }

  function openOperationConfirmDialog(
    title: string,
    description: string,
    keyword: string,
    action: () => void | Promise<void>
  ) {
    operationConfirmActionRef.current = action;
    setOperationConfirmTitle(title);
    setOperationConfirmDescription(description);
    setOperationConfirmKeyword(keyword.trim().toUpperCase() || "CONFIRM");
    setOperationConfirmChecked(false);
    setOperationConfirmInput("");
    setShowOperationConfirmModal(true);
  }

  function closeOperationConfirmDialog() {
    if (busyKey === "operation-confirm") {
      return;
    }
    operationConfirmActionRef.current = null;
    setShowOperationConfirmModal(false);
    setOperationConfirmTitle("");
    setOperationConfirmDescription("");
    setOperationConfirmKeyword("CONFIRM");
    setOperationConfirmChecked(false);
    setOperationConfirmInput("");
  }

  async function executeOperationConfirmDialog() {
    if (!operationConfirmActionRef.current) {
      return;
    }

    if (
      !operationConfirmChecked ||
      operationConfirmInput.trim().toUpperCase() !== operationConfirmKeyword
    ) {
      setNotice({ tone: "error", text: `To continue, check the box and type ${operationConfirmKeyword}.` });
      return;
    }

    setBusyKey("operation-confirm");
    const action = operationConfirmActionRef.current;
    operationConfirmActionRef.current = null;

    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Operation failed";
      setNotice({ tone: "error", text: message });
    } finally {
      setBusyKey("");
      setShowOperationConfirmModal(false);
      setOperationConfirmTitle("");
      setOperationConfirmDescription("");
      setOperationConfirmKeyword("CONFIRM");
      setOperationConfirmChecked(false);
      setOperationConfirmInput("");
    }
  }

  function handleAdminToolsActionConfirmCapture(event: MouseEvent<HTMLElement>) {
    if (!isSuperAdmin || !location.pathname.startsWith("/admin-tools")) {
      return;
    }

    if (operationConfirmBypassRef.current || showOperationConfirmModal) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const button = target?.closest("button");
    if (!button) {
      return;
    }

    if (button.disabled) {
      return;
    }

    const label = (button.textContent || "operation").trim().replace(/\s+/g, " ") || "operation";
    const keyword = getActionConfirmKeyword(label);
    if (!keyword) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    openOperationConfirmDialog(
      `Confirm ${label}`,
      `You are about to run: ${label}. Type ${keyword} to authorize this protected action.`,
      keyword,
      async () => {
        operationConfirmBypassRef.current = true;
        try {
          button.click();
        } finally {
          operationConfirmBypassRef.current = false;
        }
      }
    );
  }

  const dueSubscriptions = useMemo(() => {
    return memberDashboard?.due_subscriptions || [];
  }, [memberDashboard?.due_subscriptions]);

  const selectedDueSubscriptions = useMemo(() => {
    if (!dueSubscriptions.length) {
      return [] as DueSubscriptionRow[];
    }
    const selectedIdSet = new Set(selectedDueSubscriptionIds);
    return dueSubscriptions.filter((subscription) => selectedIdSet.has(subscription.subscription_id));
  }, [dueSubscriptions, selectedDueSubscriptionIds]);

  const sortedReceipts = useMemo(() => {
    const receipts = [...(memberDashboard?.receipts || [])];
    receipts.sort((left, right) => {
      const leftDate = new Date(left.payment_date).getTime();
      const rightDate = new Date(right.payment_date).getTime();
      return rightDate - leftDate;
    });
    return receipts;
  }, [memberDashboard?.receipts]);

  const hasDueSubscription = dueSubscriptions.length > 0;
  const selectedDueAmount = selectedDueSubscriptions.reduce((sum, subscription) => {
    return sum + Number(subscription.amount || 0);
  }, 0);

  async function withAuthRequest<T>(
    key: string,
    action: () => Promise<T>,
    successText?: string
  ): Promise<T | null> {
    if (!token) {
      setNotice({ tone: "error", text: "Please sign in first." });
      return null;
    }

    setBusyKey(key);
    try {
      const result = await action();
      if (successText) {
        setNotice({ tone: "success", text: successText });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred.";
      const isNetworkError = message.toLowerCase().includes("network") || message.toLowerCase().includes("timed out");
      const isAuthError = message.toLowerCase().includes("session expired") || message.toLowerCase().includes("sign in");
      if (isAuthError && supabase) {
        await supabase.auth.signOut().catch(() => {});
        setSession(null);
        setAuthContext(null);
      }
      setNotice({ tone: "error", text: isNetworkError ? `${message} Check your connection.` : message });
      return null;
    } finally {
      setBusyKey("");
    }
  }

  async function forceLogoutUnregistered() {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setAuthContext(null);
    setMemberDashboard(null);
    setChurches([]);
    setAdmins([]);
    setNotice({
      tone: "error",
      text: "This email is not present in records. Please contact your administrator.",
    });
    navigate("/signin", { replace: true });
  }

  async function loadContext() {
    const context = await withAuthRequest("context", () => apiRequest<AuthContext>("/api/auth/me", { token }));
    if (!context) {
      return null;
    }

    setAuthContext(context);

    if (!context.is_super_admin) {
      try {
        const paymentConfig = await apiRequest<PaymentConfigResponse>("/api/payments/config", { token });
        setPaymentsEnabled(Boolean(paymentConfig.payments_enabled));
        setPaymentConfigError(
          paymentConfig.payments_enabled ? "" : paymentConfig.reason || "Payments are disabled for this church"
        );
      } catch (error) {
        setPaymentsEnabled(false);
        const message = error instanceof Error ? error.message : "Failed to load payment config";
        setPaymentConfigError(message);
        setNotice({ tone: "error", text: `Payment config check failed: ${message}` });
      }
    } else {
      setPaymentsEnabled(false);
      setPaymentConfigError("");
    }

    return context;
  }

  async function refreshMemberDashboard(silent = true) {
    if (!token) {
      return null;
    }

    try {
      const dashboard = await apiRequest<MemberDashboard>("/api/auth/member-dashboard", { token });
      setMemberDashboard(dashboard);
      if (!silent) {
        setNotice({ tone: "success", text: "Member dashboard refreshed." });
      }
      return dashboard;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load member dashboard";
      if (message.toLowerCase().includes("not registered")) {
        await forceLogoutUnregistered();
        return null;
      }
      if (!silent) {
        setNotice({ tone: "error", text: message });
      }
      return null;
    }
  }

  async function loadChurches() {
    const endpoint = isSuperAdmin ? "/api/churches/summary" : "/api/churches/list";
    const rows = await withAuthRequest(
      "churches",
      () => apiRequest<ChurchRow[]>(endpoint, { token }),
      "Church list refreshed."
    );
    if (rows) {
      setChurches(rows);
    }
  }

  async function loadAdmins() {
    if (!isSuperAdmin) {
      return;
    }
    const rows = await withAuthRequest(
      "admins",
      () => apiRequest<AdminRow[]>("/api/admins/list", { token }),
      "Admin list refreshed."
    );
    if (rows) {
      setAdmins(rows);
    }
  }

  async function loadPastors() {
    const scopedChurchId = isSuperAdmin ? pastorChurchId.trim() : authContext?.auth.church_id || "";
    if (!scopedChurchId) {
      setPastors([]);
      return;
    }

    const endpoint = isSuperAdmin
      ? `/api/pastors/list?church_id=${encodeURIComponent(scopedChurchId)}`
      : "/api/pastors/list";

    const rows = await withAuthRequest(
      "pastors",
      () => apiRequest<PastorRow[]>(endpoint, { token }),
      "Pastors refreshed."
    );

    if (!rows) {
      return;
    }

    setPastors(rows);
    setSelectedPastorIds((current) => current.filter((id) => rows.some((pastor) => pastor.id === id)));
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
        apiRequest<NotificationRow[]>("/api/engagement/notifications", { token })
      ),
    ]);

    if (eventRows) {
      setEvents(eventRows);
    }

    if (notificationRows) {
      setNotifications(notificationRows);
    }
  }

  async function loadIncomeSummary() {
    if (!isAdminUser) {
      return;
    }

    const scopedChurchId = authContext?.auth.church_id || "";
    if (isSuperAdmin && !scopedChurchId) {
      setIncomeSummary(null);
      return;
    }

    const summary = await withAuthRequest(
      "income",
      () => apiRequest<IncomeSummary>("/api/admins/income", { token }),
      "Income summary refreshed."
    );

    if (summary) {
      setIncomeSummary(summary);
    }
  }

  async function loadChurchPaymentSettings(targetChurchId?: string) {
    if (!isAdminUser) {
      return;
    }

    const scopedChurchId = isSuperAdmin
      ? (targetChurchId || paymentConfigChurchId || "")
      : authContext?.auth.church_id || "";

    if (!scopedChurchId) {
      setChurchPaymentEnabled(false);
      setChurchPaymentKeyId("");
      setChurchPaymentHasSecret(false);
      setChurchPaymentSchemaReady(true);
      return;
    }

    const query = isSuperAdmin ? `?church_id=${encodeURIComponent(scopedChurchId)}` : "";
    const config = await withAuthRequest(
      "church-payment-config",
      () => apiRequest<ChurchPaymentSettings>(`/api/churches/payment-config${query}`, { token }),
      "Church payment config loaded."
    );

    if (!config) {
      return;
    }

    setChurchPaymentEnabled(Boolean(config.payments_enabled));
    setChurchPaymentKeyId(config.key_id || "");
    setChurchPaymentHasSecret(Boolean(config.has_key_secret));
    setChurchPaymentSchemaReady(Boolean(config.schema_ready));
    setChurchPaymentKeySecret("");
  }

  async function saveChurchPaymentSettings() {
    if (!isAdminUser) {
      return;
    }

    const scopedChurchId = isSuperAdmin
      ? (paymentConfigChurchId || "")
      : authContext?.auth.church_id || "";

    if (!scopedChurchId) {
      setNotice({ tone: "error", text: "Select a church before updating payment settings." });
      return;
    }

    const result = await withAuthRequest(
      "save-church-payment-config",
      () =>
        apiRequest<ChurchPaymentSettings>("/api/churches/payment-config", {
          method: "POST",
          token,
          body: {
            church_id: isSuperAdmin ? scopedChurchId : undefined,
            payments_enabled: churchPaymentEnabled,
            key_id: churchPaymentKeyId.trim() || undefined,
            key_secret: churchPaymentKeySecret.trim() || undefined,
          },
        }),
      "Church payment settings updated."
    );

    if (!result) {
      return;
    }

    setChurchPaymentEnabled(Boolean(result.payments_enabled));
    setChurchPaymentKeyId(result.key_id || "");
    setChurchPaymentHasSecret(Boolean(result.has_key_secret));
    setChurchPaymentSchemaReady(Boolean(result.schema_ready));
    setChurchPaymentKeySecret("");
  }

  function togglePastorSelection(pastorId: string) {
    setSelectedPastorIds((current) => {
      if (current.includes(pastorId)) {
        return current.filter((id) => id !== pastorId);
      }

      return [...current, pastorId];
    });
  }

  async function createPastorRecord() {
    const scopedChurchId = isSuperAdmin ? pastorChurchId.trim() : authContext?.auth.church_id || "";

    if (!scopedChurchId) {
      setNotice({ tone: "error", text: "Select a church before adding a pastor." });
      return;
    }

    if (!isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: "Selected church is invalid." });
      return;
    }

    if (!pastorName.trim() || !pastorPhone.trim()) {
      setNotice({ tone: "error", text: "Pastor name and phone are required." });
      return;
    }

    const created = await withAuthRequest(
      "create-pastor",
      () =>
        apiRequest<PastorRow>("/api/pastors/create", {
          method: "POST",
          token,
          body: {
            church_id: scopedChurchId,
            full_name: pastorName.trim(),
            phone_number: pastorPhone.trim(),
            email: pastorEmail.trim() || undefined,
            details: pastorDetails.trim() || undefined,
          },
        }),
      "Pastor added successfully."
    );

    if (!created) {
      return;
    }

    setPastorName("");
    setPastorPhone("");
    setPastorEmail("");
    setPastorDetails("");
    await loadPastors();
  }

  async function deletePastorRecord(pastorId: string) {
    const scopedChurchId = isSuperAdmin ? pastorChurchId.trim() : authContext?.auth.church_id || "";

    if (!scopedChurchId) {
      setNotice({ tone: "error", text: "Select a church before deleting a pastor." });
      return;
    }

    const deleted = await withAuthRequest(
      "delete-pastor",
      () =>
        apiRequest<{ deleted: true; id: string }>(`/api/pastors/${pastorId}`, {
          method: "DELETE",
          token,
          body: {
            church_id: scopedChurchId,
          },
        }),
      "Pastor deleted successfully."
    );

    if (!deleted) {
      return;
    }

    await loadPastors();
  }

  async function transferPastorRecord(pastorId: string) {
    if (!isSuperAdmin) {
      setNotice({ tone: "error", text: "Only super admin can transfer pastors." });
      return;
    }

    const fromChurchId = pastorChurchId.trim();
    const toChurchId = pastorTransferChurchId.trim();

    if (!fromChurchId || !toChurchId) {
      setNotice({ tone: "error", text: "Select both source and target churches for transfer." });
      return;
    }

    if (!isUuid(fromChurchId) || !isUuid(toChurchId)) {
      setNotice({ tone: "error", text: "Selected church is invalid." });
      return;
    }

    if (fromChurchId === toChurchId) {
      setNotice({ tone: "error", text: "Source and target church cannot be the same." });
      return;
    }

    const transferred = await withAuthRequest(
      "transfer-pastor",
      () =>
        apiRequest<PastorRow>(`/api/pastors/${pastorId}/transfer`, {
          method: "POST",
          token,
          body: {
            from_church_id: fromChurchId,
            to_church_id: toChurchId,
          },
        }),
      "Pastor transferred successfully."
    );

    if (!transferred) {
      return;
    }

    await loadPastors();
    await loadChurches();
  }

  async function postEvent() {
    if (!eventTitle.trim() || !eventMessage.trim()) {
      setNotice({ tone: "error", text: "Event title and message are required." });
      return;
    }

    const created = await withAuthRequest(
      "post-event",
      () =>
        apiRequest<EventRow>("/api/engagement/events", {
          method: "POST",
          token,
          body: {
            title: eventTitle.trim(),
            message: eventMessage.trim(),
            event_date: eventDate || undefined,
          },
        }),
      "Event posted."
    );

    if (!created) {
      return;
    }

    setEventTitle("");
    setEventMessage("");
    setEventDate("");
    await loadEventsAndNotifications();
  }

  async function postNotification() {
    if (!notificationTitle.trim() || !notificationMessage.trim()) {
      setNotice({ tone: "error", text: "Notification title and message are required." });
      return;
    }

    const created = await withAuthRequest(
      "post-notification",
      () =>
        apiRequest<NotificationRow>("/api/engagement/notifications", {
          method: "POST",
          token,
          body: {
            title: notificationTitle.trim(),
            message: notificationMessage.trim(),
          },
        }),
      "Notification posted."
    );

    if (!created) {
      return;
    }

    setNotificationTitle("");
    setNotificationMessage("");
    await loadEventsAndNotifications();
  }

  async function submitPrayerRequest() {
    if (!selectedPastorIds.length) {
      setNotice({ tone: "error", text: "Select at least one pastor for prayer request." });
      return;
    }

    if (!prayerDetails.trim()) {
      setNotice({ tone: "error", text: "Prayer request details are required." });
      return;
    }

    const result = await withAuthRequest(
      "prayer-request",
      () =>
        apiRequest<{ prayer_request: { id: string } }>("/api/engagement/prayer-requests", {
          method: "POST",
          token,
          body: {
            pastor_ids: selectedPastorIds,
            details: prayerDetails.trim(),
          },
        }),
      "Prayer request sent to selected pastor(s)."
    );

    if (!result) {
      return;
    }

    setPrayerDetails("");
    setSelectedPastorIds([]);
  }

  async function downloadReceipt(receipt: ReceiptRow) {
    if (!token) {
      setNotice({ tone: "error", text: "Please sign in again to download receipts." });
      return;
    }

    const busyToken = `download-receipt-${receipt.id}`;
    setBusyKey(busyToken);

    try {
      const endpoint = receipt.receipt_download_path || `/api/payments/${receipt.id}/receipt`;
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"}${endpoint}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/pdf",
        },
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let message = `Failed to download receipt (${response.status})`;

        if (contentType.includes("application/json")) {
          const payload = await response.json();
          message = payload?.error || payload?.message || message;
        } else {
          const text = await response.text();
          if (text) {
            message = text;
          }
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename=\"?([^\"]+)\"?/i);
      const filename = filenameMatch?.[1] || `receipt-${receipt.receipt_number || receipt.id}.pdf`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setNotice({ tone: "error", text: err.message || "Failed to download receipt." });
    } finally {
      setBusyKey((current) => (current === busyToken ? "" : current));
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoadingSession(false);
      return;
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("Failed to restore session:", error.message);
        setNotice({ tone: "error", text: "Failed to restore your session. Please sign in again." });
      }
      setSession(data.session);
      setLoadingSession(false);
    }).catch((err) => {
      console.error("Supabase session error:", err);
      setLoadingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!token) {
      setAuthContext(null);
      setMemberDashboard(null);
      setChurches([]);
      setAdmins([]);
      setPaymentsEnabled(false);
      setPaymentConfigError("");
      setBootstrapError("");
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      setBusyKey("bootstrap");
      setBootstrapError("");
      try {
        const context = await apiRequest<AuthContext>("/api/auth/me", { token });
        if (cancelled) return;

        setAuthContext(context);

        if (context.is_super_admin) {
          const churchRows = await apiRequest<ChurchRow[]>("/api/churches/summary", { token });
          if (cancelled) return;
          setChurches(churchRows);
          setPaymentsEnabled(false);
          setPaymentConfigError("");
          if (context.is_super_admin) {
            const adminRows = await apiRequest<AdminRow[]>("/api/admins/list", { token });
            if (!cancelled) {
              setAdmins(adminRows);
            }
          }
          setNotice({ tone: "success", text: "Welcome back. Admin workspace is ready." });
        } else {
          let paymentConfig: PaymentConfigResponse = { payments_enabled: false, key_id: "" };
          let paymentConfigLoadError = "";
          try {
            paymentConfig = await apiRequest<PaymentConfigResponse>("/api/payments/config", { token });
            paymentConfigLoadError = "";
          } catch (error) {
            paymentConfig = { payments_enabled: false, key_id: "" };
            const message = error instanceof Error ? error.message : "Failed to load payment config";
            paymentConfigLoadError = message;
            if (!cancelled) {
              setNotice({ tone: "error", text: `Payment config check failed: ${message}` });
            }
          }
          if (cancelled) return;
          setPaymentsEnabled(Boolean(paymentConfig.payments_enabled));
          setPaymentConfigError(
            paymentConfigLoadError ||
              (paymentConfig.payments_enabled
                ? ""
                : paymentConfig.reason || "Payments are disabled for this church")
          );

          const dashboard = await refreshMemberDashboard(true);
          if (cancelled) return;
          if (dashboard) {
            setMemberDashboard(dashboard);
          }
          if (!paymentConfigLoadError) {
            setNotice({ tone: "success", text: "Welcome back. Member dashboard is ready." });
          }
        }

        if (!cancelled && location.pathname === "/signin") {
          navigate("/dashboard", { replace: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to initialize session";
        if (message.toLowerCase().includes("not registered")) {
          await forceLogoutUnregistered();
          return;
        }

        if (!cancelled) {
          const normalizedMessage = message.toLowerCase().includes("avatar_url")
            ? "Database update required. Run db/auth_user_linking_migration.sql in Supabase SQL Editor, then retry."
            : message;
          setBootstrapError(normalizedMessage);
          setNotice({ tone: "error", text: message });
        }
      } finally {
        if (!cancelled) {
          setBusyKey("");
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [token, bootstrapRetry]);

  useEffect(() => {
    const memberId = memberDashboard?.member?.id;
    const supabaseClient = supabase;
    if (!supabaseClient || !token || !memberId || authContext?.profile.role !== "member") {
      return;
    }

    const channel = supabaseClient
      .channel(`member-subscription-events-${memberId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "subscription_events",
          filter: `member_id=eq.${memberId}`,
        },
        () => {
          if (realtimeRefreshTimerRef.current !== null) {
            window.clearTimeout(realtimeRefreshTimerRef.current);
          }
          realtimeRefreshTimerRef.current = window.setTimeout(() => {
            void refreshMemberDashboard();
          }, 350);
        }
      )
      .subscribe();

    return () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      void supabaseClient.removeChannel(channel);
    };
  }, [authContext?.profile.role, memberDashboard?.member?.id, token]);

  useEffect(() => {
    if (!authContext) {
      return;
    }

    setProfileName(authContext.profile.full_name || "");
    setProfileAvatarUrl(authContext.profile.avatar_url || "");
    setProfileAddress(memberDashboard?.member?.address || "");
    setProfilePhone(memberDashboard?.member?.phone_number || "");
    setProfileAltPhone(memberDashboard?.member?.alt_phone_number || "");
    setProfileSubscriptionAmount(
      memberDashboard?.member?.subscription_amount !== null &&
        memberDashboard?.member?.subscription_amount !== undefined
        ? String(memberDashboard.member.subscription_amount)
        : ""
    );
    setProfileSubscriptionEditable(false);
  }, [
    authContext,
    memberDashboard?.member?.address,
    memberDashboard?.member?.phone_number,
    memberDashboard?.member?.alt_phone_number,
    memberDashboard?.member?.subscription_amount,
  ]);

    useEffect(() => {
      const dueIds = dueSubscriptions.map((subscription) => subscription.subscription_id);
      setSelectedDueSubscriptionIds((current) => {
        const existing = current.filter((id) => dueIds.includes(id));
        if (existing.length > 0) {
          return existing;
        }
        return dueIds;
      });
    }, [dueSubscriptions]);

  useEffect(() => {
    if (!isSuperAdmin) {
      setPreRegChurchId("");
      setPaymentConfigChurchId("");
      setPastorChurchId("");
      setPastorTransferChurchId("");
      setSuperMemberChurchId("");
      setSuperPastorFromChurchId("");
      setSuperAdminChurchId("");
      return;
    }
    setPreRegChurchId((current) => (current ? current : churches[0]?.id || ""));
    setPaymentConfigChurchId((current) => (current ? current : churches[0]?.id || ""));
    setPastorChurchId((current) => (current ? current : churches[0]?.id || ""));
    setPastorTransferChurchId((current) => (current ? current : churches[0]?.id || ""));
    setSuperMemberChurchId((current) => (current ? current : churches[0]?.id || ""));
    setSuperPastorFromChurchId((current) => (current ? current : churches[0]?.id || ""));
    setSuperAdminChurchId((current) => (current ? current : churches[0]?.id || ""));
  }, [churches, isSuperAdmin]);

  useEffect(() => {
    if (!token || !authContext) {
      return;
    }

    void loadPastors();
    void loadEventsAndNotifications();

    if (isAdminUser) {
      void loadIncomeSummary();
      void loadChurchPaymentSettings();
    }
  }, [
    token,
    authContext?.profile.role,
    authContext?.auth.church_id,
    isSuperAdmin,
    isAdminUser,
    paymentConfigChurchId,
    pastorChurchId,
  ]);

  async function signInWithGoogle() {
    if (!supabase) {
      setNotice({ tone: "error", text: "Authentication service is not configured. Contact your administrator." });
      return;
    }
    setBusyKey("login");
    setNotice({ tone: "neutral", text: "Redirecting to Google OAuth..." });

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("popup") || msg.includes("cancelled") || msg.includes("canceled")) {
          setNotice({ tone: "neutral", text: "Sign-in was cancelled." });
        } else {
          setNotice({ tone: "error", text: `Sign-in failed: ${error.message}` });
        }
        setBusyKey("");
      }
    } catch (err) {
      setNotice({ tone: "error", text: "Sign-in failed due to a network error. Please try again." });
      setBusyKey("");
    }
  }

  async function signOut() {
    if (!supabase) return;
    setBusyKey("logout");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Sign-out error:", error.message);
      }
    } catch (err) {
      console.error("Sign-out exception:", err);
    }
    // Always clear local state even if Supabase call failed
    setBusyKey("");
    setSession(null);
    setAuthContext(null);
    setMemberDashboard(null);
    setChurches([]);
    setAdmins([]);
    setNotice({ tone: "success", text: "You have been signed out." });
    navigate("/signin", { replace: true });
  }

  async function updateProfile() {
    let normalizedSubscriptionAmount: number | undefined;
    if (!isSuperAdmin) {
      const trimmedAmount = profileSubscriptionAmount.trim();
      if (profileSubscriptionEditable && trimmedAmount) {
        normalizedSubscriptionAmount = Number(trimmedAmount);
        if (!Number.isFinite(normalizedSubscriptionAmount)) {
          setNotice({ tone: "error", text: "Subscription amount must be a number." });
          return;
        }
        if (normalizedSubscriptionAmount < 200) {
          setNotice({ tone: "error", text: "Minimum monthly subscription is 200." });
          return;
        }
      }
    }

    const payload = {
      full_name: profileName,
      avatar_url: profileAvatarUrl,
      address: profileAddress,
      phone_number: profilePhone,
      alt_phone_number: profileAltPhone,
      subscription_amount:
        isSuperAdmin || !profileSubscriptionEditable ? undefined : normalizedSubscriptionAmount,
    };

    const result = await withAuthRequest(
      "update-profile",
      () =>
        apiRequest<MemberDashboard>("/api/auth/update-profile", {
          method: "POST",
          token,
          body: payload,
        }),
      "Profile updated successfully."
    );

    if (!result || !authContext) {
      return;
    }

    setMemberDashboard(result);
    setAuthContext({
      ...authContext,
      profile: result.profile,
    });
    setProfileSubscriptionEditable(false);
  }

  async function grantAdmin() {
    if (!grantEmail.trim()) {
      setNotice({ tone: "error", text: "Grant email is required." });
      return;
    }

    const churchId = grantChurchId.trim();
    if (churchId && !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Selected church is invalid." });
      return;
    }

    const result = await withAuthRequest(
      "grant",
      () =>
        apiRequest<unknown>("/api/admins/grant", {
          method: "POST",
          token,
          body: {
            email: grantEmail.trim(),
            church_id: churchId || undefined,
          },
        }),
      "Admin access granted."
    );

    if (result) {
      setGrantEmail("");
      await loadAdmins();
    }
  }

  async function revokeAdmin() {
    if (!revokeEmail.trim()) {
      setNotice({ tone: "error", text: "Revoke email is required." });
      return;
    }

    const result = await withAuthRequest(
      "revoke",
      () =>
        apiRequest<unknown>("/api/admins/revoke", {
          method: "POST",
          token,
          body: {
            email: revokeEmail.trim(),
          },
        }),
      "Admin access revoked."
    );

    if (result) {
      setRevokeEmail("");
      await loadAdmins();
    }
  }

  async function preRegisterMember() {
    if (!preRegEmail.trim()) {
      setNotice({ tone: "error", text: "Member email is required." });
      return;
    }

    const churchId = preRegChurchId.trim();
    if (churchId && !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Selected church is invalid." });
      return;
    }

    const amountText = preRegAmount.trim();
    let amountValue: number | undefined;
    if (amountText) {
      amountValue = Number(amountText);
      if (!Number.isFinite(amountValue) || amountValue < 0) {
        setNotice({ tone: "error", text: "Subscription amount must be non-negative." });
        return;
      }
    }

    const result = await withAuthRequest(
      "pre-register",
      () =>
        apiRequest<PreRegisterResult>("/api/admins/pre-register-member", {
          method: "POST",
          token,
          body: {
            email: preRegEmail.trim(),
            full_name: preRegName.trim() || undefined,
            membership_id: preRegMembershipId.trim() || undefined,
            address: preRegAddress.trim() || undefined,
            subscription_amount: amountValue,
            church_id: churchId || undefined,
          },
        }),
      "Member pre-registered."
    );

    if (result) {
      setPreRegResult(result);
      setPreRegEmail("");
      setPreRegName("");
      setPreRegMembershipId("");
      setPreRegAddress("");
      setPreRegAmount("");
    }
  }

  async function createChurchRecord() {
    if (!churchCreateName.trim()) {
      setNotice({ tone: "error", text: "Church name is required." });
      return;
    }

    const adminEmails = churchCreateAdmins
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);

    const result = await withAuthRequest(
      "create-church",
      () =>
        apiRequest<{ church: ChurchRow }>("/api/churches/create", {
          method: "POST",
          token,
          body: {
            name: churchCreateName.trim(),
            address: churchCreateAddress.trim() || undefined,
            location: churchCreateLocation.trim() || undefined,
            contact_phone: churchCreatePhone.trim() || undefined,
            admin_emails: adminEmails.length ? adminEmails : undefined,
          },
        }),
      "Church created successfully."
    );

    if (!result) {
      return;
    }

    setChurchCreateName("");
    setChurchCreateAddress("");
    setChurchCreateLocation("");
    setChurchCreatePhone("");
    setChurchCreateAdmins("");
    await loadChurches();
    await loadAdmins();
    if (result.church?.id) {
      setPaymentConfigChurchId(result.church.id);
    }
  }

  async function superSearchMembers() {
    if (!isSuperAdmin) {
      return;
    }

    const churchId = superMemberChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }

    const query = superMemberQuery.trim();
    const rows = await withAuthRequest(
      "super-members-search",
      () =>
        apiRequest<MemberRow[]>(
          `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
          { token }
        ),
      "Member search complete."
    );

    if (!rows) {
      return;
    }

    setSuperMemberResults(rows);
    if (!rows.some((row) => row.id === superMemberSelectedId)) {
      setSuperMemberSelectedId("");
      setSuperMemberDeleteImpact(null);
    }
  }

  async function superFetchMemberDetails(memberId: string) {
    if (!isSuperAdmin) {
      return;
    }

    const churchId = superMemberChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }

    const member = await withAuthRequest(
      "super-member-detail",
      () => apiRequest<MemberRow>(`/api/members/${memberId}?church_id=${encodeURIComponent(churchId)}`, { token }),
      "Member details loaded."
    );

    if (!member) {
      return;
    }

    setSuperMemberSelectedId(member.id);
    setSuperMemberEditName(member.full_name || "");
    setSuperMemberEditStatus(member.verification_status || "pending");
    setSuperMemberResults((current) => {
      const withoutCurrent = current.filter((row) => row.id !== member.id);
      return [member, ...withoutCurrent];
    });
  }

  async function superUpdateMember() {
    if (!isSuperAdmin || !superMemberSelectedId) {
      return;
    }

    const churchId = superMemberChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }

    const updated = await withAuthRequest(
      "super-member-update",
      () =>
        apiRequest<MemberRow>(`/api/members/${superMemberSelectedId}`, {
          method: "PATCH",
          token,
          body: {
            church_id: churchId,
            full_name: superMemberEditName.trim() || undefined,
            verification_status: superMemberEditStatus.trim() || undefined,
          },
        }),
      "Member updated."
    );

    if (!updated) {
      return;
    }

    setSuperMemberResults((current) =>
      current.map((row) => (row.id === updated.id ? updated : row))
    );
  }

  async function superPreviewMemberDelete() {
    if (!isSuperAdmin || !superMemberSelectedId) {
      return;
    }

    const churchId = superMemberChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }

    const impact = await withAuthRequest(
      "super-member-impact",
      () =>
        apiRequest<MemberDeleteImpact>(
          `/api/members/${superMemberSelectedId}/delete-impact?church_id=${encodeURIComponent(churchId)}`,
          { token }
        ),
      "Delete impact loaded."
    );

    if (impact) {
      setSuperMemberDeleteImpact(impact);
    }
  }

  async function superDeleteMember() {
    if (!isSuperAdmin || !superMemberSelectedId) {
      return;
    }

    const churchId = superMemberChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }

    const result = await withAuthRequest(
      "super-member-delete",
      () =>
        apiRequest<{ deleted: true; id: string }>(`/api/members/${superMemberSelectedId}`, {
          method: "DELETE",
          token,
          body: {
            church_id: churchId,
            confirm: true,
          },
        }),
      "Member deleted."
    );

    if (!result) {
      return;
    }

    setSuperMemberResults((current) => current.filter((row) => row.id !== superMemberSelectedId));
    setSuperMemberSelectedId("");
    setSuperMemberEditName("");
    setSuperMemberEditStatus("");
    setSuperMemberDeleteImpact(null);
  }

  async function superSearchChurches() {
    if (!isSuperAdmin) {
      return;
    }

    const rows = await withAuthRequest(
      "super-church-search",
      () =>
        apiRequest<ChurchRow[]>(`/api/churches/search?query=${encodeURIComponent(superChurchQuery.trim())}`, { token }),
      "Church search complete."
    );

    if (!rows) {
      return;
    }

    setSuperChurchResults(rows);
  }

  function superSelectChurch(church: ChurchRow) {
    setSuperChurchSelectedId(church.id);
    setSuperChurchEditName(church.name || "");
    setSuperChurchEditAddress(church.address || "");
    setSuperChurchEditLocation(church.location || "");
    setSuperChurchEditPhone(church.contact_phone || "");
    setSuperChurchDeleteImpact(null);
    setSuperChurchIncome(null);
    loadSuperChurchIncome(church.id);
  }

  async function loadSuperChurchIncome(churchId: string) {
    if (!isSuperAdmin || !churchId) return;
    const summary = await withAuthRequest(
      "super-church-income",
      () => apiRequest<IncomeSummary>(`/api/admins/income?church_id=${encodeURIComponent(churchId)}`, { token }),
      "Church income loaded."
    );
    if (summary) setSuperChurchIncome(summary);
  }

  async function superUpdateChurch() {
    if (!isSuperAdmin || !superChurchSelectedId) {
      return;
    }

    const updated = await withAuthRequest(
      "super-church-update",
      () =>
        apiRequest<ChurchRow>(`/api/churches/id/${superChurchSelectedId}`, {
          method: "PATCH",
          token,
          body: {
            name: superChurchEditName.trim() || undefined,
            address: superChurchEditAddress,
            location: superChurchEditLocation,
            contact_phone: superChurchEditPhone,
          },
        }),
      "Church updated."
    );

    if (!updated) {
      return;
    }

    setSuperChurchResults((current) =>
      current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))
    );
    setChurches((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
  }

  async function superPreviewChurchDelete() {
    if (!isSuperAdmin || !superChurchSelectedId) {
      return;
    }

    const impact = await withAuthRequest(
      "super-church-impact",
      () => apiRequest<ChurchDeleteImpact>(`/api/churches/id/${superChurchSelectedId}/delete-impact`, { token }),
      "Church delete impact loaded."
    );

    if (impact) {
      setSuperChurchDeleteImpact(impact);
    }
  }

  async function superDeleteChurch() {
    if (!isSuperAdmin || !superChurchSelectedId) {
      return;
    }

    const result = await withAuthRequest(
      "super-church-delete",
      () =>
        apiRequest<{ deleted: true; id: string }>(`/api/churches/id/${superChurchSelectedId}?force=true`, {
          method: "DELETE",
          token,
          body: { force: true },
        }),
      "Church deleted."
    );

    if (!result) {
      return;
    }

    setSuperChurchResults((current) => current.filter((row) => row.id !== superChurchSelectedId));
    setChurches((current) => current.filter((row) => row.id !== superChurchSelectedId));
    setSuperChurchSelectedId("");
    setSuperChurchDeleteImpact(null);
    await loadAdmins();
  }

  async function superSearchPastors() {
    if (!isSuperAdmin) {
      return;
    }

    const churchId = superPastorFromChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select source church for pastor operations." });
      return;
    }

    const rows = await withAuthRequest(
      "super-pastor-search",
      () =>
        apiRequest<PastorRow[]>(
          `/api/pastors/list?church_id=${encodeURIComponent(churchId)}&active_only=false`,
          { token }
        ),
      "Pastor search complete."
    );

    if (!rows) {
      return;
    }

    const filtered = superPastorQuery.trim()
      ? rows.filter((row) => {
          const haystack = `${row.full_name} ${row.phone_number} ${row.email || ""}`.toLowerCase();
          return haystack.includes(superPastorQuery.trim().toLowerCase());
        })
      : rows;

    setSuperPastorResults(filtered);
  }

  function superSelectPastor(pastor: PastorRow) {
    setSuperPastorSelectedId(pastor.id);
    setSuperPastorEditName(pastor.full_name || "");
    setSuperPastorEditPhone(pastor.phone_number || "");
    setSuperPastorEditEmail(pastor.email || "");
  }

  async function superUpdatePastor() {
    if (!isSuperAdmin || !superPastorSelectedId) {
      return;
    }

    const churchId = superPastorFromChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select source church for pastor operations." });
      return;
    }

    const updated = await withAuthRequest(
      "super-pastor-update",
      () =>
        apiRequest<PastorRow>(`/api/pastors/${superPastorSelectedId}`, {
          method: "PATCH",
          token,
          body: {
            church_id: churchId,
            full_name: superPastorEditName.trim() || undefined,
            phone_number: superPastorEditPhone.trim() || undefined,
            email: superPastorEditEmail.trim() || undefined,
          },
        }),
      "Pastor updated."
    );

    if (!updated) {
      return;
    }

    setSuperPastorResults((current) => current.map((row) => (row.id === updated.id ? updated : row)));
  }

  async function superTransferPastor() {
    if (!isSuperAdmin || !superPastorSelectedId) {
      return;
    }

    const fromChurchId = superPastorFromChurchId.trim();
    const toChurchId = superPastorTargetChurchId.trim();
    if (!fromChurchId || !toChurchId || !isUuid(fromChurchId) || !isUuid(toChurchId)) {
      setNotice({ tone: "error", text: "Select valid source and target churches for transfer." });
      return;
    }

    const transferred = await withAuthRequest(
      "super-pastor-transfer",
      () =>
        apiRequest<PastorRow>(`/api/pastors/${superPastorSelectedId}/transfer`, {
          method: "POST",
          token,
          body: {
            from_church_id: fromChurchId,
            to_church_id: toChurchId,
          },
        }),
      "Pastor transferred."
    );

    if (!transferred) {
      return;
    }

    setSuperPastorResults((current) => current.filter((row) => row.id !== superPastorSelectedId));
    setSuperPastorSelectedId("");
    setSuperPastorEditName("");
    setSuperPastorEditPhone("");
    setSuperPastorEditEmail("");
    await loadChurches();
  }

  async function superDeletePastor() {
    if (!isSuperAdmin || !superPastorSelectedId) {
      return;
    }

    const churchId = superPastorFromChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select source church for pastor operations." });
      return;
    }

    const result = await withAuthRequest(
      "super-pastor-delete",
      () =>
        apiRequest<{ deleted: true; id: string }>(`/api/pastors/${superPastorSelectedId}`, {
          method: "DELETE",
          token,
          body: { church_id: churchId },
        }),
      "Pastor deleted."
    );

    if (!result) {
      return;
    }

    setSuperPastorResults((current) => current.filter((row) => row.id !== superPastorSelectedId));
    setSuperPastorSelectedId("");
  }

  async function superSearchAdmins() {
    if (!isSuperAdmin) {
      return;
    }

    const churchId = superAdminChurchId.trim();
    const query = superAdminQuery.trim();
    const params = new URLSearchParams();
    if (churchId) {
      params.set("church_id", churchId);
    }
    if (query) {
      params.set("query", query);
    }

    const rows = await withAuthRequest(
      "super-admin-search",
      () => apiRequest<AdminRow[]>(`/api/admins/search?${params.toString()}`, { token }),
      "Admin search complete."
    );

    if (rows) {
      setSuperAdminResults(rows);
    }
  }

  function superSelectAdmin(admin: AdminRow) {
    setSuperAdminSelectedId(admin.id);
    setSuperAdminEditName(admin.full_name || "");
    setSuperAdminTargetChurchId(admin.church_id || "");
  }

  async function superUpdateAdmin() {
    if (!isSuperAdmin || !superAdminSelectedId) {
      return;
    }

    const churchId = superAdminTargetChurchId.trim();
    if (!churchId || !isUuid(churchId)) {
      setNotice({ tone: "error", text: "Select a valid church for admin update." });
      return;
    }

    const updated = await withAuthRequest(
      "super-admin-update",
      () =>
        apiRequest<AdminRow>(`/api/admins/id/${superAdminSelectedId}`, {
          method: "PATCH",
          token,
          body: {
            full_name: superAdminEditName.trim() || undefined,
            church_id: churchId,
          },
        }),
      "Admin updated."
    );

    if (updated) {
      setSuperAdminResults((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    }
  }

  async function superDeleteAdmin() {
    if (!isSuperAdmin || !superAdminSelectedId) {
      return;
    }

    const removed = await withAuthRequest(
      "super-admin-delete",
      () =>
        apiRequest<AdminRow>(`/api/admins/id/${superAdminSelectedId}`, {
          method: "DELETE",
          token,
        }),
      "Admin role removed."
    );

    if (!removed) {
      return;
    }

    setSuperAdminResults((current) => current.filter((row) => row.id !== superAdminSelectedId));
    setSuperAdminSelectedId("");
    await loadAdmins();
  }

  function toggleDueSubscription(subscriptionId: string) {
    setSelectedDueSubscriptionIds((current) => {
      if (current.includes(subscriptionId)) {
        return current.filter((id) => id !== subscriptionId);
      }
      return [...current, subscriptionId];
    });
  }

  async function addFamilyMember() {
    if (isSuperAdmin) {
      setNotice({ tone: "error", text: "Family members can be added only in member workspace." });
      return;
    }

    const fullName = familyMemberName.trim();
    const relation = familyMemberRelation.trim();
    if (!fullName || !relation) {
      setNotice({ tone: "error", text: "Name and relation are required." });
      return;
    }

    const ageValue = familyMemberAge.trim() ? Number(familyMemberAge) : undefined;
    if (ageValue !== undefined && (!Number.isFinite(ageValue) || ageValue < 0)) {
      setNotice({ tone: "error", text: "Age must be a non-negative number." });
      return;
    }

    const subscriptionAmountValue = familyMemberSubscriptionAmount.trim()
      ? Number(familyMemberSubscriptionAmount)
      : undefined;
    if (
      familyMemberWithSubscription &&
      subscriptionAmountValue !== undefined &&
      (!Number.isFinite(subscriptionAmountValue) || subscriptionAmountValue <= 0)
    ) {
      setNotice({ tone: "error", text: "Subscription amount must be greater than 0." });
      return;
    }

    const result = await withAuthRequest(
      "add-family-member",
      () =>
        apiRequest<{ family_member: FamilyMemberRow; subscription: SubscriptionRow | null }>(
          "/api/auth/family-members",
          {
            method: "POST",
            token,
            body: {
              full_name: fullName,
              gender: familyMemberGender.trim() || undefined,
              relation,
              age: ageValue,
              dob: familyMemberDob || undefined,
              add_subscription: familyMemberWithSubscription,
              subscription_amount: subscriptionAmountValue,
              billing_cycle: "monthly",
            },
          }
        ),
      "Family member added successfully."
    );

    if (!result) {
      return;
    }

    setFamilyMemberName("");
    setFamilyMemberGender("");
    setFamilyMemberRelation("");
    setFamilyMemberAge("");
    setFamilyMemberDob("");
    setFamilyMemberWithSubscription(false);
    setFamilyMemberSubscriptionAmount("");
    await refreshMemberDashboard();
  }

  async function donateToChurch() {
    if (!paymentsEnabled) {
      setNotice({ tone: "error", text: "Payments are currently disabled." });
      return;
    }

    if (isSuperAdmin) {
      setNotice({ tone: "error", text: "Donations are not available in super admin workspace." });
      return;
    }

    let memberId = memberDashboard?.member?.id || "";
    if (!memberId) {
      const latestDashboard = await refreshMemberDashboard(true);
      memberId = latestDashboard?.member?.id || "";
    }

    if (!memberId) {
      setNotice({
        tone: "error",
        text: "Member profile is still being set up. Open Profile and save once, then retry.",
      });
      return;
    }

    const amountValue = Number(donationAmount.trim());
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setNotice({ tone: "error", text: "Enter a valid donation amount greater than 0." });
      return;
    }

    setBusyKey("donate");
    try {
      const orderPayload = await apiRequest<{
        order: { id: string; amount: number; currency: string; receipt: string };
        key_id: string;
        member_id: string;
        church_name: string | null;
      }>("/api/payments/donation/order", {
        method: "POST",
        token,
        body: { amount: amountValue },
      });

      const checkoutLoaded = await loadRazorpayCheckoutScript();
      if (!checkoutLoaded) {
        throw new Error("Unable to load Razorpay checkout. Please retry.");
      }

      const RazorpayConstructor = (window as any).Razorpay;
      if (typeof RazorpayConstructor !== "function") {
        throw new Error("Razorpay checkout is unavailable in this browser.");
      }

      await new Promise<void>((resolve, reject) => {
        const razorpay = new RazorpayConstructor({
          key: orderPayload.key_id,
          amount: orderPayload.order.amount,
          currency: orderPayload.order.currency,
          name: orderPayload.church_name || "Church Donation",
          description: "Offering / Donation",
          order_id: orderPayload.order.id,
          prefill: {
            name: authContext?.profile.full_name || "",
            email: userEmail,
          },
          notes: {
            type: "donation",
            member_id: orderPayload.member_id,
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await apiRequest<{ success: true }>("/api/payments/donation/verify", {
                method: "POST",
                token,
                body: {
                  amount: amountValue,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                },
              });

              setDonationAmount("");
              setShowDonateModal(false);
              await refreshMemberDashboard();
              setNotice({ tone: "success", text: "Donation paid successfully. Thank you." });
              resolve();
            } catch (verifyError) {
              reject(verifyError);
            }
          },
          modal: {
            ondismiss: () => reject(new Error("Donation checkout was cancelled.")),
          },
          theme: {
            color: "#2a6f7c",
          },
        });

        razorpay.open();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Donation failed";
      setNotice({ tone: "error", text: message });
    } finally {
      setBusyKey("");
    }
  }

  async function paySubscriptionDue() {
    if (!paymentsEnabled) {
      setNotice({ tone: "error", text: "Payments are currently disabled." });
      return;
    }

    if (isSuperAdmin) {
      setNotice({ tone: "error", text: "Subscription payments are not available in super admin workspace." });
      return;
    }

    if (!hasDueSubscription) {
      setNotice({ tone: "neutral", text: "No dues pending right now." });
      return;
    }

    if (!selectedDueSubscriptionIds.length) {
      setNotice({ tone: "error", text: "Select at least one subscription to pay." });
      return;
    }

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
        body: {
          subscription_ids: selectedDueSubscriptionIds,
        },
      });

      const checkoutLoaded = await loadRazorpayCheckoutScript();
      if (!checkoutLoaded) {
        throw new Error("Unable to load Razorpay checkout. Please retry.");
      }

      const RazorpayConstructor = (window as any).Razorpay;
      if (typeof RazorpayConstructor !== "function") {
        throw new Error("Razorpay checkout is unavailable in this browser.");
      }

      await new Promise<void>((resolve, reject) => {
        const razorpay = new RazorpayConstructor({
          key: orderPayload.key_id,
          amount: orderPayload.order.amount,
          currency: orderPayload.order.currency,
          name: memberDashboard?.church?.name || "SHALOM Subscription",
          description: "Subscription Due Payment",
          order_id: orderPayload.order.id,
          prefill: {
            name: authContext?.profile.full_name || "",
            email: userEmail,
          },
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

              await refreshMemberDashboard();
              setNotice({ tone: "success", text: "Subscription due paid successfully." });
              resolve();
            } catch (verifyError) {
              reject(verifyError);
            }
          },
          modal: {
            ondismiss: () => reject(new Error("Payment checkout was cancelled.")),
          },
          theme: {
            color: "#2a6f7c",
          },
        });

        razorpay.open();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Subscription payment failed";
      setNotice({ tone: "error", text: message });
    } finally {
      setBusyKey("");
    }
  }

  if (!hasSupabaseConfig) {
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <h1>Configuration Required</h1>
          <p>Set frontend environment values for Supabase and reload the app.</p>
          <div className="notice notice-error">VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing.</div>
        </section>
      </div>
    );
  }

  if (loadingSession) {
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <h1>Checking Session</h1>
          <p>Loading authentication state...</p>
        </section>
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route
          path="/signin"
          element={
            <div className="auth-shell">
              <section className="auth-card">
                <img src={shalomLogo} alt="Shalom" className="auth-logo" />
                <h1>Sign In</h1>
                <p>
                  Continue with Google to access your profile and church workspace. Only registered
                  emails are allowed.
                </p>
                {notice.tone === "error" ? (
                  <div className={`notice notice-${notice.tone}`}>{notice.text}</div>
                ) : null}
                <button
                  className="btn btn-primary"
                  onClick={signInWithGoogle}
                  disabled={busyKey === "login"}
                >
                  {busyKey === "login" ? "Redirecting..." : "Sign in with Google"}
                </button>
              </section>
            </div>
          }
        />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }

  if (!authContext) {
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <h1>{bootstrapError ? "Workspace Error" : "Preparing Workspace"}</h1>
          <p>
            {bootstrapError
              ? "We could not finish account setup. Please retry or sign out."
              : "Validating your account and building your workspace..."}
          </p>
          {bootstrapError ? <div className="notice notice-error">{bootstrapError}</div> : null}
          <div className="actions-row">
            <button
              className="btn"
              onClick={() => setBootstrapRetry((value) => value + 1)}
              disabled={busyKey === "bootstrap"}
            >
              {busyKey === "bootstrap" ? "Retrying..." : "Retry"}
            </button>
            <button className="btn btn-primary" onClick={signOut} disabled={busyKey === "logout"}>
              {busyKey === "logout" ? "Signing out..." : "Sign Out"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const memberName = authContext.profile.full_name || userEmail;
  const avatarText = initials(authContext.profile.full_name, userEmail);
  const avatarUrl = authContext.profile.avatar_url || "";

  return (
    <div className={`app-layout ${workspaceToneClass}`}>
      <nav className="sidebar">
        <div className="brand-block">
          <img src={shalomLogo} alt="Shalom" className="nav-logo" />
          <span className="brand-name">Shalom</span>
        </div>
        <nav className="nav-stack">
          <p className="nav-section-label">Main</p>
          <Link className={`nav-link group ${location.pathname === "/dashboard" ? "active" : ""}`} to="/dashboard">
            <span className="nav-icon bg-blue-50 text-blue-600 border-transparent">
              <LayoutDashboard size={18} />
            </span>
            <span>Dashboard</span>
          </Link>

          {!isSuperAdmin ? (
            <Link className={`nav-link group ${location.pathname === "/profile" ? "active" : ""}`} to="/profile">
              <span className="nav-icon bg-blue-50 text-blue-600 border-transparent">
                <UserRound size={18} />
              </span>
              <span>Profile</span>
            </Link>
          ) : null}

          {!isSuperAdmin ? (
            <Link className={`nav-link group ${location.pathname === "/history" ? "active" : ""}`} to="/history">
              <span className="nav-icon bg-emerald-50 text-emerald-600 border-transparent">
                <History size={18} />
              </span>
              <span>History</span>
            </Link>
          ) : null}

          <Link className={`nav-link group ${location.pathname === "/events" ? "active" : ""}`} to="/events">
            <span className="nav-icon bg-amber-50 text-amber-600 border-transparent">
              <CalendarDays size={18} />
            </span>
            <span>Events</span>
          </Link>

          {isAdminUser ? (
            <p className="nav-section-label">{isSuperAdmin ? "Super Admin Tools" : "Admin Section"}</p>
          ) : null}

          {isAdminUser ? (
            <Link
              className={`nav-link group ${location.pathname === "/admin-tools" ? "active" : ""}`}
              to="/admin-tools"
            >
              <span className="nav-icon bg-blue-50 text-blue-600 border-transparent">
                <Shield size={18} />
              </span>
              <span>{isSuperAdmin ? "Super Admin Console" : "Admin Tools"}</span>
            </Link>
          ) : null}

          {isMemberOnlyUser ? <p className="nav-section-label">Member Only</p> : null}
        </nav>
        <button
          className="btn btn-ghost sidebar-signout"
          onClick={() => navigate("/signout")}
          disabled={busyKey === "logout"}
        >
          <span className="inline-flex items-center gap-2">
            <LogOut size={16} />
            {busyKey === "logout" ? "Signing out..." : "Sign Out"}
          </span>
        </button>
      </nav>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="topbar-label">{pageTitle}</p>
            <h1>
              {isSuperAdmin
                ? "SHALOM Super Admin Console"
                : isChurchAdmin
                  ? "SHALOM Church Admin Workspace"
                  : "SHALOM Member Workspace"}
            </h1>
          </div>
          <div className="user-badge">
            {avatarUrl ? (
              <img className="avatar" src={avatarUrl} alt={memberName} />
            ) : (
              <div className="avatar avatar-fallback">{avatarText}</div>
            )}
            <div>
              <strong>{memberName}</strong>
              <span>{isSuperAdmin ? "super_admin" : authContext.profile.role}</span>
            </div>
          </div>
        </header>

        <div className="notice-row">
          <div className={`notice notice-${notice.tone}`}>{notice.text}</div>
          <button className="btn" onClick={loadContext} disabled={busyKey === "context"}>
            {busyKey === "context" ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <Routes>
          <Route
            path="/dashboard"
            element={
              isSuperAdmin ? (
                <section className="page-grid">
                  <article className="panel">
                    <h3>Quick Stats</h3>
                    <div className="stats-grid">
                      <div className="stat">
                        <span>Churches</span>
                        <strong>{churches.length}</strong>
                      </div>
                      <div className="stat">
                        <span>Admins</span>
                        <strong>{isSuperAdmin ? admins.length : "-"}</strong>
                      </div>
                    </div>
                    <div className="actions-row">
                      <button className="btn" onClick={loadChurches} disabled={busyKey === "churches"}>
                        {busyKey === "churches" ? "Loading..." : "Load Churches"}
                      </button>
                      {isSuperAdmin ? (
                        <button className="btn" onClick={loadAdmins} disabled={busyKey === "admins"}>
                          {busyKey === "admins" ? "Loading..." : "Load Admins"}
                        </button>
                      ) : null}
                    </div>
                  </article>

                  <article className="panel">
                    <h3>Growth Metrics</h3>
                    <div style={{ width: '100%', height: 260 }}>
                      <ResponsiveContainer>
                        <AreaChart
                          data={mockGrowthData}
                          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="colorMembers" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorAttendance" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                          />
                          <Area type="monotone" dataKey="attendance" stroke="#10b981" fillOpacity={1} fill="url(#colorAttendance)" />
                          <Area type="monotone" dataKey="members" stroke="#3b82f6" fillOpacity={1} fill="url(#colorMembers)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </article>

                  <article className="panel">
                    <h3>Church Directory</h3>
                    <div className="list-stack">
                      {churches.length === 0 ? (
                        <p className="muted empty-state">No churches loaded yet.</p>
                      ) : (
                        churches.map((church) => (
                          <div key={church.id} className="list-item">
                            <strong>{church.name}</strong>
                            <span>Unique ID: {church.unique_id || church.church_code || "Not generated"}</span>
                            <span>{church.address || church.location || "Address not set"}</span>
                            <span>
                              Members: {church.member_count || 0} | Admins: {church.admin_count || 0} | Pastors: {church.pastor_count || 0}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </article>

                  {isSuperAdmin ? (
                    <article className="panel panel-wide ops-tree">
                      <h3>Admin Directory</h3>
                      <div className="list-stack">
                        {admins.length === 0 ? (
                          <p className="muted empty-state">No admins loaded yet.</p>
                        ) : (
                          admins.map((admin) => (
                            <div key={admin.id} className="list-item">
                              <strong>{admin.full_name || admin.email}</strong>
                              <span>{admin.email}</span>
                              <span>{admin.church_id || "No church"}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                  ) : null}
                </section>
              ) : (
                <section className="page-grid">
                  <article className="panel">
                    <h3>My Church</h3>
                    {memberDashboard?.church ? (
                      <div className="list-item">
                        <strong>{memberDashboard.church.name}</strong>
                        <span>Unique ID: {memberDashboard.church.church_code || "Not set"}</span>
                        <span>{memberDashboard.church.address || "Address not set"}</span>
                        <span>{memberDashboard.church.location || "Location not set"}</span>
                        <span>{memberDashboard.church.contact_phone || "Phone not set"}</span>
                      </div>
                    ) : (
                      <p className="muted empty-state">No church mapped yet.</p>
                    )}
                  </article>

                  {isChurchAdmin ? (
                    <article className="panel">
                      <h3>Live Income</h3>
                      <div className="stats-grid">
                        <div className="stat">
                          <span>Daily</span>
                          <strong>{formatAmount(incomeSummary?.daily_income)}</strong>
                        </div>
                        <div className="stat">
                          <span>Monthly</span>
                          <strong>{formatAmount(incomeSummary?.monthly_income)}</strong>
                        </div>
                        <div className="stat">
                          <span>Yearly</span>
                          <strong>{formatAmount(incomeSummary?.yearly_income)}</strong>
                        </div>
                        <div className="stat">
                          <span>Successful Payments</span>
                          <strong>{incomeSummary?.successful_payments_count || 0}</strong>
                        </div>
                      </div>

                      <div style={{ width: '100%', height: 260, marginTop: '2rem', marginBottom: '1rem' }}>
                        <ResponsiveContainer>
                          <BarChart data={mockIncomeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                            <XAxis dataKey="day" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip 
                              cursor={{ fill: 'rgba(241, 245, 249, 0.5)' }}
                              contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                            />
                            <Bar dataKey="income" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="actions-row">
                        <button className="btn" onClick={loadIncomeSummary} disabled={busyKey === "income"}>
                          {busyKey === "income" ? "Refreshing..." : "Refresh Income"}
                        </button>
                      </div>
                    </article>
                  ) : null}

                  <article className="panel">
                    <h3>Donations</h3>
                    <p className="muted">Open the donation window to make an offering.</p>
                    <div className="actions-row">
                      <button
                        className="btn btn-primary"
                        onClick={() => setShowDonateModal(true)}
                        disabled={!paymentsEnabled || !memberDashboard?.member?.id}
                      >
                        {!paymentsEnabled
                          ? "Donate (Unavailable)"
                          : memberDashboard?.member?.id
                          ? "Donate"
                          : "Donate (Profile Setup)"}
                      </button>
                    </div>
                    {!paymentsEnabled ? (
                      <p className="muted">
                        Payments unavailable{paymentConfigError ? `: ${paymentConfigError}` : "."}
                      </p>
                    ) : !memberDashboard?.member?.id ? (
                      <p className="muted">Complete your member profile setup to enable donations.</p>
                    ) : null}
                  </article>

                  <article className="panel">
                    <h3>Request for Prayer</h3>
                    <div className="list-stack">
                      {pastors.length ? (
                        pastors.map((pastor) => (
                          <label key={pastor.id} className="checkbox-line">
                            <input
                              type="checkbox"
                              checked={selectedPastorIds.includes(pastor.id)}
                              onChange={() => togglePastorSelection(pastor.id)}
                            />
                            {pastor.full_name} | {pastor.phone_number}
                          </label>
                        ))
                      ) : (
                        <p className="muted empty-state">No active pastors configured yet.</p>
                      )}
                    </div>
                    <label>
                      Prayer Details
                      <textarea
                        value={prayerDetails}
                        onChange={(event) => setPrayerDetails(event.target.value)}
                        placeholder="Share your prayer need"
                      />
                    </label>
                    <div className="actions-row">
                      <button
                        className="btn btn-primary"
                        onClick={submitPrayerRequest}
                        disabled={busyKey === "prayer-request" || !pastors.length}
                      >
                        {busyKey === "prayer-request" ? "Sending..." : "Send Request"}
                      </button>
                    </div>
                  </article>

                  <article className="panel">
                    <h3>Live Subscription Status</h3>
                    <div className="stats-grid">
                      <div className="stat">
                        <span>Current Status</span>
                        <strong>{memberDashboard?.tracking?.current_status || "unknown"}</strong>
                      </div>
                      <div className="stat">
                        <span>Next Due Date</span>
                        <strong>{formatDate(memberDashboard?.tracking?.next_due_date)}</strong>
                      </div>
                    </div>
                    <p className="muted">
                      Last event: {formatDate(memberDashboard?.tracking?.latest_event_at)}
                    </p>
                    <div className="notice notice-neutral">
                      Selected Due Amount: <span className="tabular-nums">{selectedDueSubscriptionIds.length ? formatAmount(selectedDueAmount) : "Rs 0.00"}</span>
                    </div>
                    <p className="muted">
                      Total Pending Dues: <span className="tabular-nums">{formatAmount(dueSubscriptions.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</span>
                    </p>
                    <div className="list-stack">
                      {dueSubscriptions.length ? (
                        dueSubscriptions.map((dueItem) => (
                          <label key={dueItem.subscription_id} className="checkbox-line">
                            <input
                              type="checkbox"
                              checked={selectedDueSubscriptionIds.includes(dueItem.subscription_id)}
                              onChange={() => toggleDueSubscription(dueItem.subscription_id)}
                            />
                            {dueItem.person_name} | {formatAmount(dueItem.amount)} | Due {formatDate(dueItem.next_payment_date)}
                          </label>
                        ))
                      ) : (
                        <p className="muted empty-state">No pending dues found.</p>
                      )}
                    </div>
                    <div className="actions-row">
                      <button
                        className="btn btn-primary"
                        onClick={paySubscriptionDue}
                        disabled={!paymentsEnabled || !hasDueSubscription || !selectedDueSubscriptionIds.length || busyKey === "pay-now"}
                      >
                        {busyKey === "pay-now"
                          ? "Processing..."
                          : !paymentsEnabled
                            ? "Pay Now (Unavailable)"
                            : !selectedDueSubscriptionIds.length
                            ? "Pay Now (Select Subscriptions)"
                            : hasDueSubscription
                            ? "Pay Selected"
                            : "Pay Now (Inactive)"}
                      </button>
                    </div>
                    {!paymentsEnabled ? (
                      <p className="muted">
                        Subscription payments unavailable{paymentConfigError ? `: ${paymentConfigError}` : "."}
                      </p>
                    ) : null}
                  </article>

                </section>
              )
            }
          />

          <Route
            path="/profile"
            element={
              <section className="page-grid">
                {/* ── Profile Header Card ── */}
                <article className="panel panel-wide profile-header-card">
                  <div className="profile-header">
                    <div className="profile-avatar-lg">
                      {authContext.profile.avatar_url ? (
                        <img className="avatar avatar-lg" src={authContext.profile.avatar_url} alt={profileName || userEmail} />
                      ) : (
                        <div className="avatar avatar-lg avatar-fallback">{initials(profileName, userEmail)}</div>
                      )}
                    </div>
                    <div className="profile-header-info">
                      <h2>{profileName || userEmail}</h2>
                      <span className="profile-role-badge">
                        {isSuperAdmin ? "Super Admin" : isChurchAdmin ? "Admin" : "Member"}
                      </span>
                      <p className="muted">{authContext.profile.email}</p>
                    </div>
                  </div>
                </article>

                {/* ── Personal Details ── */}
                <article className="panel">
                  <h3>Personal Details</h3>
                  <div className="field-stack">
                    <label>
                      Full Name
                      <input
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="Your full name"
                      />
                    </label>
                    <label>
                      Phone Number
                      <input
                        value={profilePhone}
                        onChange={(e) => setProfilePhone(e.target.value)}
                        placeholder="+91 9XXXXXXXXX"
                      />
                    </label>
                    <label>
                      Alternate Phone
                      <input
                        value={profileAltPhone}
                        onChange={(e) => setProfileAltPhone(e.target.value)}
                        placeholder="Optional alternate number"
                      />
                    </label>
                    <label>
                      Address
                      <textarea
                        value={profileAddress}
                        onChange={(e) => setProfileAddress(e.target.value)}
                        placeholder="Kochi, Kerala"
                      />
                    </label>
                  </div>
                </article>

                {/* ── Subscription ── */}
                <article className="panel">
                  <h3>Subscription</h3>
                  {!isSuperAdmin ? (
                    <div className="field-stack">
                      <div className="actions-row">
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setProfileSubscriptionEditable((c) => !c)}
                        >
                          {profileSubscriptionEditable ? "Lock Subscription" : "Edit Subscription"}
                        </button>
                      </div>
                      <label>
                        Monthly Amount
                        <input
                          type="number"
                          min={200}
                          step="1"
                          value={profileSubscriptionAmount}
                          onChange={(e) => setProfileSubscriptionAmount(e.target.value)}
                          placeholder="Minimum 200"
                          disabled={!profileSubscriptionEditable}
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="muted">Super admins do not have subscriptions.</p>
                  )}
                  <div className="actions-row">
                    <button
                      className="btn btn-primary"
                      onClick={updateProfile}
                      disabled={busyKey === "update-profile"}
                    >
                      {busyKey === "update-profile" ? "Saving..." : "Save Profile"}
                    </button>
                  </div>
                </article>

                {/* ── Family Members ── */}
                {!isSuperAdmin ? (
                  <article className="panel panel-wide">
                    <h3>Family Members</h3>
                    <div className="list-stack">
                      {memberDashboard?.family_members?.length ? (
                        memberDashboard.family_members.map((fm) => (
                          <div key={fm.id} className="list-item">
                            <strong>{fm.full_name}</strong>
                            <span>
                              {fm.relation || "Relation not set"}
                              {fm.gender ? ` | ${fm.gender}` : ""}
                              {fm.age !== null && fm.age !== undefined ? ` | Age ${fm.age}` : ""}
                            </span>
                            <span>DOB: {fm.dob ? formatDate(fm.dob) : "Not set"}</span>
                            <span>Subscription: {fm.has_subscription ? "Enabled" : "Not enabled"}</span>
                          </div>
                        ))
                      ) : (
                        <p className="muted empty-state">No family members added yet.</p>
                      )}
                    </div>

                    <div className="field-stack">
                      <label>Name<input value={familyMemberName} onChange={(e) => setFamilyMemberName(e.target.value)} placeholder="Family member full name" /></label>
                      <label>Gender<input value={familyMemberGender} onChange={(e) => setFamilyMemberGender(e.target.value)} placeholder="Male / Female / Other" /></label>
                      <label>Relation<input value={familyMemberRelation} onChange={(e) => setFamilyMemberRelation(e.target.value)} placeholder="Spouse, Son, Daughter..." /></label>
                      <label>Age<input type="number" min={0} step="1" value={familyMemberAge} onChange={(e) => setFamilyMemberAge(e.target.value)} placeholder="Age" /></label>
                      <label>DOB<input type="date" value={familyMemberDob} onChange={(e) => setFamilyMemberDob(e.target.value)} /></label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={familyMemberWithSubscription} onChange={(e) => setFamilyMemberWithSubscription(e.target.checked)} />
                        Add individual subscription on this family member
                      </label>
                      {familyMemberWithSubscription ? (
                        <label>
                          Subscription Amount
                          <input type="number" min={1} step="1" value={familyMemberSubscriptionAmount} onChange={(e) => setFamilyMemberSubscriptionAmount(e.target.value)} placeholder="If empty, primary member amount is used" />
                        </label>
                      ) : null}
                    </div>

                    <div className="actions-row">
                      <button className="btn" onClick={addFamilyMember} disabled={busyKey === "add-family-member"}>
                        {busyKey === "add-family-member" ? "Adding..." : "+ Add Family Member"}
                      </button>
                    </div>
                  </article>
                ) : null}
              </section>
            }
          />

          <Route
            path="/history"
            element={
              isSuperAdmin ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <section className="page-grid">
                  <article className="panel panel-wide">
                    <h3>Receipts</h3>
                    <div className="list-stack">
                      {sortedReceipts.length ? (
                        sortedReceipts.map((receipt) => (
                          <div key={receipt.id} className="list-item">
                            <strong>{receipt.subscription_id ? "Subscription Receipt" : "Donation Receipt"}</strong>
                            <span>Status: {receipt.payment_status || "pending"}</span>
                            <span className="numeric-value">Amount: {formatAmount(receipt.amount)}</span>
                            <span>Method: {receipt.payment_method || "razorpay"}</span>
                            <span>Transaction: {receipt.transaction_id || "-"}</span>
                            <span className="numeric-meta">Date: {formatDate(receipt.payment_date)}</span>
                            <span>Receipt Number: {receipt.receipt_number || "Will be generated"}</span>
                            <div className="actions-row">
                              <button
                                className="btn"
                                onClick={() =>
                                  setExpandedReceiptId((current) =>
                                    current === receipt.id ? null : receipt.id
                                  )
                                }
                              >
                                {expandedReceiptId === receipt.id ? "Hide Details" : "Receipt Details"}
                              </button>
                              <button
                                className="btn"
                                disabled={busyKey === `download-receipt-${receipt.id}`}
                                onClick={() => downloadReceipt(receipt)}
                              >
                                {busyKey === `download-receipt-${receipt.id}`
                                  ? "Downloading..."
                                  : "Download Receipt"}
                              </button>
                            </div>
                            {expandedReceiptId === receipt.id ? (
                              <div className="receipt-details">
                                <span>Receipt ID: {receipt.id}</span>
                                <span>Receipt Number: {receipt.receipt_number || "Will be generated"}</span>
                                <span>Member ID: {receipt.member_id}</span>
                                <span>Subscription ID: {receipt.subscription_id || "-"}</span>
                                <span className="numeric-meta">Payment Date: {formatDate(receipt.payment_date)}</span>
                              </div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="muted empty-state">No receipts yet.</p>
                      )}
                    </div>
                  </article>

                  <article className="panel panel-wide">
                    <h3>Subscription History</h3>
                    <div className="list-stack">
                      {memberDashboard?.history?.length ? (
                        memberDashboard.history.map((item) => (
                          <div key={`${item.type}-${item.id}`} className="list-item">
                            <strong>
                              {item.type === "payment" ? "Payment" : "Subscription"}: {item.title}
                            </strong>
                            <span>Status: {item.status}</span>
                            <span className="numeric-value">Amount: {formatAmount(item.amount)}</span>
                            <span className="numeric-meta">Date: {formatDate(item.date)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="muted empty-state">No activity yet.</p>
                      )}
                    </div>
                  </article>

                  <article className="panel panel-wide">
                    <h3>Realtime Event Feed</h3>
                    <div className="list-stack">
                      {memberDashboard?.tracking?.events?.length ? (
                        memberDashboard.tracking.events.map((event) => (
                          <div key={event.id} className="list-item">
                            <strong>{toReadableEvent(event.event_type)}</strong>
                            <span>Source: {event.source}</span>
                            <span>
                              Status: {event.status_before || "-"} to {event.status_after || "-"}
                            </span>
                            <span className="numeric-value">Amount: {formatAmount(event.amount)}</span>
                            <span className="numeric-meta">When: {formatDate(event.event_at)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="muted empty-state">No realtime subscription events yet.</p>
                      )}
                    </div>
                  </article>
                </section>
              )
            }
          />

          <Route
            path="/events"
            element={
              <section className="page-grid">
                <article className="panel panel-wide">
                  <h3>Church Events</h3>
                  <div className="actions-row">
                    <button className="btn" onClick={loadEventsAndNotifications} disabled={busyKey === "events" || busyKey === "notifications"}>
                      Refresh Events
                    </button>
                  </div>
                  <div className="list-stack">
                    {events.length ? (
                      events.map((eventItem) => (
                        <div key={eventItem.id} className="list-item">
                          <strong>{eventItem.title}</strong>
                          <span className="prose-block">{eventItem.message}</span>
                          <span className="numeric-meta">Event Date: {formatDate(eventItem.event_date)}</span>
                          <span className="numeric-meta">Posted: {formatDate(eventItem.created_at)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="muted empty-state">No events posted yet.</p>
                    )}
                  </div>
                </article>

                <article className="panel panel-wide">
                  <h3>Notifications</h3>
                  <div className="list-stack">
                    {notifications.length ? (
                      notifications.map((notification) => (
                        <div key={notification.id} className="list-item">
                          <strong>{notification.title}</strong>
                          <span className="prose-block">{notification.message}</span>
                          <span className="numeric-meta">Posted: {formatDate(notification.created_at)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="muted empty-state">No notifications available.</p>
                    )}
                  </div>
                </article>

                {!isSuperAdmin ? (
                  <article className="panel panel-wide">
                    <h3>Request for Prayer</h3>
                    <p className="muted">Select at least one pastor and share your prayer request details.</p>
                    <div className="list-stack">
                      {pastors.length ? (
                        pastors.map((pastor) => (
                          <label key={pastor.id} className="checkbox-line">
                            <input
                              type="checkbox"
                              checked={selectedPastorIds.includes(pastor.id)}
                              onChange={() => togglePastorSelection(pastor.id)}
                            />
                            {pastor.full_name} | {pastor.phone_number} {pastor.email ? `| ${pastor.email}` : ""}
                          </label>
                        ))
                      ) : (
                        <p className="muted empty-state">No active pastors configured for your church.</p>
                      )}
                    </div>
                    <div className="field-stack">
                      <label>
                        Prayer Details
                        <textarea
                          value={prayerDetails}
                          onChange={(event) => setPrayerDetails(event.target.value)}
                          placeholder="Share what you want the pastors to pray for"
                        />
                      </label>
                    </div>
                    <div className="actions-row">
                      <button
                        className="btn btn-primary"
                        onClick={submitPrayerRequest}
                        disabled={busyKey === "prayer-request" || !pastors.length}
                      >
                        {busyKey === "prayer-request" ? "Sending..." : "Send Prayer Request"}
                      </button>
                    </div>
                  </article>
                ) : null}
              </section>
            }
          />

          <Route
            path="/admin-tools"
            element={
              isAdminUser ? (
                <div className="admin-console" onClickCapture={handleAdminToolsActionConfirmCapture}>
                  {/* ── Tree Navigation Sidebar ── */}
                  <nav className="admin-tree-nav">
                    <p className="admin-tree-title">Console</p>

                    {isSuperAdmin ? (
                      <>
                        <p className="admin-tree-group">Operations</p>
                        <button className={`admin-tree-item${activeAdminTab === "members" ? " active" : ""}`} onClick={() => setActiveAdminTab("members")}>
                          <Users size={16} /> <span>Members</span> <ChevronRight size={14} className="admin-tree-arrow" />
                        </button>
                        <button className={`admin-tree-item${activeAdminTab === "churches" ? " active" : ""}`} onClick={() => setActiveAdminTab("churches")}>
                          <Church size={16} /> <span>Churches</span> <ChevronRight size={14} className="admin-tree-arrow" />
                        </button>
                        <button className={`admin-tree-item${activeAdminTab === "pastors" ? " active" : ""}`} onClick={() => setActiveAdminTab("pastors")}>
                          <UserRound size={16} /> <span>Pastors</span> <ChevronRight size={14} className="admin-tree-arrow" />
                        </button>
                        <button className={`admin-tree-item${activeAdminTab === "admins" ? " active" : ""}`} onClick={() => setActiveAdminTab("admins")}>
                          <ShieldCheck size={16} /> <span>Admins</span> <ChevronRight size={14} className="admin-tree-arrow" />
                        </button>

                        <p className="admin-tree-group">Setup</p>
                        <button className={`admin-tree-item${activeAdminTab === "create-church" ? " active" : ""}`} onClick={() => setActiveAdminTab("create-church")}>
                          <Church size={16} /> <span>Create Church</span> <ChevronRight size={14} className="admin-tree-arrow" />
                        </button>
                        <button className={`admin-tree-item${activeAdminTab === "roles" ? " active" : ""}`} onClick={() => setActiveAdminTab("roles")}>
                          <Shield size={16} /> <span>Role Management</span> <ChevronRight size={14} className="admin-tree-arrow" />
                        </button>
                        <button className={`admin-tree-item${activeAdminTab === "payments" ? " active" : ""}`} onClick={() => setActiveAdminTab("payments")}>
                          <CreditCard size={16} /> <span>Payment Gateway</span> <ChevronRight size={14} className="admin-tree-arrow" />
                        </button>
                      </>
                    ) : null}

                    <p className="admin-tree-group">General</p>
                    <button className={`admin-tree-item${activeAdminTab === "pre-register" ? " active" : ""}`} onClick={() => setActiveAdminTab("pre-register")}>
                      <UserPlus size={16} /> <span>Pre-register</span> <ChevronRight size={14} className="admin-tree-arrow" />
                    </button>
                    <button className={`admin-tree-item${activeAdminTab === "events" ? " active" : ""}`} onClick={() => setActiveAdminTab("events")}>
                      <CalendarDays size={16} /> <span>Events & Alerts</span> <ChevronRight size={14} className="admin-tree-arrow" />
                    </button>
                    <button className={`admin-tree-item${activeAdminTab === "activity" ? " active" : ""}`} onClick={() => setActiveAdminTab("activity")}>
                      <Activity size={16} /> <span>Activity Log</span> <ChevronRight size={14} className="admin-tree-arrow" />
                    </button>
                  </nav>

                  {/* ── Content Area ── */}
                  <section className="admin-content">

                    {/* ═══ Member Operations ═══ */}
                    {activeAdminTab === "members" && isSuperAdmin ? (
                      <article className="panel">
                        <h3>Member Operations</h3>
                        <div className="field-stack">
                          <label>
                            Church
                            <select value={superMemberChurchId} onChange={(e) => setSuperMemberChurchId(e.target.value)}>
                              <option value="">Select church</option>
                              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
                            </select>
                          </label>
                          <label>
                            Search Member
                            <input value={superMemberQuery} onChange={(e) => setSuperMemberQuery(e.target.value)} placeholder="Name, email, phone, membership id" />
                          </label>
                          <div className="actions-row">
                            <button className="btn" onClick={superSearchMembers} disabled={busyKey === "super-members-search"}>
                              {busyKey === "super-members-search" ? "Searching..." : "Search Members"}
                            </button>
                          </div>
                          <div className="list-stack">
                            {superMemberResults.length ? (
                              superMemberResults.slice(0, 8).map((m) => (
                                <div key={m.id} className="list-item">
                                  <strong>{m.full_name}</strong>
                                  <span>{m.email}</span>
                                  <span>{m.membership_id || "No membership id"}</span>
                                  <div className="actions-row">
                                    <button className="btn" onClick={() => void superFetchMemberDetails(m.id)}>Fetch Details</button>
                                  </div>
                                </div>
                              ))
                            ) : <p className="muted empty-state">No member search results yet.</p>}
                          </div>
                          {superMemberSelectedId ? (
                            <>
                              <label>Member Name<input value={superMemberEditName} onChange={(e) => setSuperMemberEditName(e.target.value)} placeholder="Member full name" /></label>
                              <label>Verification Status<input value={superMemberEditStatus} onChange={(e) => setSuperMemberEditStatus(e.target.value)} placeholder="pending / verified" /></label>
                              <div className="actions-row">
                                <button className="btn" onClick={superUpdateMember} disabled={busyKey === "super-member-update"}>
                                  {busyKey === "super-member-update" ? "Updating..." : "Update Member"}
                                </button>
                                <button className="btn" onClick={superPreviewMemberDelete} disabled={busyKey === "super-member-impact"}>
                                  {busyKey === "super-member-impact" ? "Loading..." : "Preview Delete Impact"}
                                </button>
                                <button className="btn btn-danger" onClick={superDeleteMember} disabled={busyKey === "super-member-delete"}>
                                  {busyKey === "super-member-delete" ? "Deleting..." : "Delete Member"}
                                </button>
                              </div>
                              {superMemberDeleteImpact ? (
                                <div className="notice notice-error">
                                  Cascading impact: Family {superMemberDeleteImpact.family_members}, Subscriptions {superMemberDeleteImpact.subscriptions}, Payments {superMemberDeleteImpact.payments}
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </article>
                    ) : null}

                    {/* ═══ Church Operations ═══ */}
                    {activeAdminTab === "churches" && isSuperAdmin ? (
                      <article className="panel">
                        <h3>Church Operations</h3>
                        <div className="field-stack">
                          <label>Search Church<input value={superChurchQuery} onChange={(e) => setSuperChurchQuery(e.target.value)} placeholder="Church name, code, location" /></label>
                          <div className="actions-row">
                            <button className="btn" onClick={superSearchChurches} disabled={busyKey === "super-church-search"}>
                              {busyKey === "super-church-search" ? "Searching..." : "Search Churches"}
                            </button>
                          </div>
                          <div className="list-stack">
                            {superChurchResults.length ? (
                              superChurchResults.slice(0, 8).map((c) => (
                                <div key={c.id} className="list-item">
                                  <strong>{c.name}</strong>
                                  <span>{c.unique_id || c.church_code || "No code"}</span>
                                  <span>{c.location || "Location not set"}</span>
                                  <div className="actions-row"><button className="btn" onClick={() => superSelectChurch(c)}>Select Church</button></div>
                                </div>
                              ))
                            ) : <p className="muted empty-state">No church search results yet.</p>}
                          </div>
                          {superChurchSelectedId ? (
                            <>
                              <label>Church Name<input value={superChurchEditName} onChange={(e) => setSuperChurchEditName(e.target.value)} /></label>
                              <label>Address<input value={superChurchEditAddress} onChange={(e) => setSuperChurchEditAddress(e.target.value)} /></label>
                              <label>Location<input value={superChurchEditLocation} onChange={(e) => setSuperChurchEditLocation(e.target.value)} /></label>
                              <label>Contact Phone<input value={superChurchEditPhone} onChange={(e) => setSuperChurchEditPhone(e.target.value)} /></label>
                              <div className="actions-row">
                                <button className="btn" onClick={superUpdateChurch} disabled={busyKey === "super-church-update"}>
                                  {busyKey === "super-church-update" ? "Updating..." : "Update Church"}
                                </button>
                                <button className="btn" onClick={superPreviewChurchDelete} disabled={busyKey === "super-church-impact"}>
                                  {busyKey === "super-church-impact" ? "Loading..." : "Preview Delete Impact"}
                                </button>
                                <button className="btn btn-danger" onClick={superDeleteChurch} disabled={busyKey === "super-church-delete"}>
                                  {busyKey === "super-church-delete" ? "Deleting..." : "Delete Church"}
                                </button>
                              </div>
                              {superChurchDeleteImpact ? (
                                <div className="notice notice-error">
                                  Impact: Users {superChurchDeleteImpact.users}, Members {superChurchDeleteImpact.members}, Pastors {superChurchDeleteImpact.pastors}, Events {superChurchDeleteImpact.church_events}, Notifications {superChurchDeleteImpact.church_notifications}, Prayer Requests {superChurchDeleteImpact.prayer_requests}, Payments {superChurchDeleteImpact.payments}
                                </div>
                              ) : null}

                              {/* ── Church Income Summary ── */}
                              <h3 style={{ marginTop: '1.5rem' }}>Church Income</h3>
                              {superChurchIncome ? (
                                <>
                                  <div className="stats-grid">
                                    <div className="stat"><span>Daily</span><strong>{formatAmount(superChurchIncome.daily_income)}</strong></div>
                                    <div className="stat"><span>Monthly</span><strong>{formatAmount(superChurchIncome.monthly_income)}</strong></div>
                                    <div className="stat"><span>Yearly</span><strong>{formatAmount(superChurchIncome.yearly_income)}</strong></div>
                                    <div className="stat"><span>Successful Payments</span><strong>{superChurchIncome.successful_payments_count || 0}</strong></div>
                                  </div>
                                  <div style={{ width: '100%', height: 260, marginTop: '1rem' }}>
                                    <ResponsiveContainer>
                                      <BarChart data={mockIncomeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ed" opacity={0.5} />
                                        <XAxis dataKey="day" stroke="#86868b" fontSize={12} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#86868b" fontSize={12} tickLine={false} axisLine={false} />
                                        <Tooltip
                                          cursor={{ fill: 'rgba(0, 0, 0, 0.02)' }}
                                          contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e8e8ed', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}
                                        />
                                        <Bar dataKey="income" fill="#0071e3" radius={[4, 4, 0, 0]} />
                                      </BarChart>
                                    </ResponsiveContainer>
                                  </div>
                                </>
                              ) : (
                                <p className="muted">Loading income data...</p>
                              )}
                              <div className="actions-row">
                                <button className="btn" onClick={() => loadSuperChurchIncome(superChurchSelectedId)} disabled={busyKey === "super-church-income"}>
                                  {busyKey === "super-church-income" ? "Refreshing..." : "Refresh Income"}
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </article>
                    ) : null}

                    {/* ═══ Pastor Operations ═══ */}
                    {activeAdminTab === "pastors" ? (
                      <article className="panel">
                        <h3>Pastors</h3>
                        <div className="field-stack">
                          {isSuperAdmin ? (
                            <>
                              <label>
                                Source Church
                                <select value={superPastorFromChurchId} onChange={(e) => setSuperPastorFromChurchId(e.target.value)}>
                                  <option value="">Select church</option>
                                  {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
                                </select>
                              </label>
                              <label>
                                Search Pastor
                                <input value={superPastorQuery} onChange={(e) => setSuperPastorQuery(e.target.value)} placeholder="Name, phone, email" />
                              </label>
                              <div className="actions-row">
                                <button className="btn" onClick={superSearchPastors} disabled={busyKey === "super-pastor-search"}>
                                  {busyKey === "super-pastor-search" ? "Searching..." : "Search Pastors"}
                                </button>
                              </div>
                              <div className="list-stack">
                                {superPastorResults.length ? (
                                  superPastorResults.slice(0, 8).map((p) => (
                                    <div key={p.id} className="list-item">
                                      <strong>{p.full_name}</strong>
                                      <span>{p.phone_number}</span>
                                      <span>{p.email || "No email"}</span>
                                      <div className="actions-row"><button className="btn" onClick={() => superSelectPastor(p)}>Select Pastor</button></div>
                                    </div>
                                  ))
                                ) : <p className="muted empty-state">No pastor search results yet.</p>}
                              </div>
                              {superPastorSelectedId ? (
                                <>
                                  <label>Pastor Name<input value={superPastorEditName} onChange={(e) => setSuperPastorEditName(e.target.value)} /></label>
                                  <label>Pastor Phone<input value={superPastorEditPhone} onChange={(e) => setSuperPastorEditPhone(e.target.value)} /></label>
                                  <label>Pastor Email<input value={superPastorEditEmail} onChange={(e) => setSuperPastorEditEmail(e.target.value)} /></label>
                                  <label>
                                    Transfer To Church
                                    <select value={superPastorTargetChurchId} onChange={(e) => setSuperPastorTargetChurchId(e.target.value)}>
                                      <option value="">Select target church</option>
                                      {churches.filter((c) => c.id !== superPastorFromChurchId).map((c) => (
                                        <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>
                                      ))}
                                    </select>
                                  </label>
                                  <div className="actions-row">
                                    <button className="btn" onClick={superUpdatePastor} disabled={busyKey === "super-pastor-update"}>
                                      {busyKey === "super-pastor-update" ? "Updating..." : "Update Pastor"}
                                    </button>
                                    <button className="btn" onClick={superTransferPastor} disabled={busyKey === "super-pastor-transfer"}>
                                      {busyKey === "super-pastor-transfer" ? "Transferring..." : "Transfer Pastor"}
                                    </button>
                                    <button className="btn btn-danger" onClick={superDeletePastor} disabled={busyKey === "super-pastor-delete"}>
                                      {busyKey === "super-pastor-delete" ? "Deleting..." : "Delete Pastor"}
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </>
                          ) : null}

                          {/* Shared pastor add form (admin + super admin) */}
                          <label>
                            Church *
                            <select
                              value={isSuperAdmin ? pastorChurchId : authContext?.auth.church_id || ""}
                              onChange={(e) => { if (isSuperAdmin) setPastorChurchId(e.target.value); }}
                              disabled={!isSuperAdmin}
                            >
                              {isSuperAdmin ? <option value="">Select church</option> : null}
                              {(isSuperAdmin ? churches : churches.slice(0, 1)).map((c) => (
                                <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>
                              ))}
                              {!isSuperAdmin && !churches.length && authContext?.auth.church_id ? (
                                <option value={authContext.auth.church_id}>Current Church</option>
                              ) : null}
                            </select>
                          </label>
                          {isSuperAdmin ? (
                            <label>
                              Transfer Target Church
                              <select value={pastorTransferChurchId} onChange={(e) => setPastorTransferChurchId(e.target.value)}>
                                <option value="">Select target church</option>
                                {churches.filter((c) => c.id !== pastorChurchId).map((c) => (
                                  <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          <label>Name<input value={pastorName} onChange={(e) => setPastorName(e.target.value)} placeholder="Pastor name" /></label>
                          <label>Phone Number<input value={pastorPhone} onChange={(e) => setPastorPhone(e.target.value)} placeholder="+91..." /></label>
                          <label>Email<input value={pastorEmail} onChange={(e) => setPastorEmail(e.target.value)} placeholder="pastor@church.com" /></label>
                          <label>Details<textarea value={pastorDetails} onChange={(e) => setPastorDetails(e.target.value)} placeholder="Ministry details" /></label>
                        </div>
                        <div className="actions-row">
                          <button className="btn btn-primary" onClick={createPastorRecord} disabled={busyKey === "create-pastor"}>
                            {busyKey === "create-pastor" ? "Adding..." : "Add Pastor"}
                          </button>
                          <button className="btn" onClick={loadPastors} disabled={busyKey === "pastors"}>
                            {busyKey === "pastors" ? "Refreshing..." : "Refresh Pastors"}
                          </button>
                        </div>
                        <div className="list-stack">
                          {pastors.length ? (
                            pastors.slice(0, 6).map((p) => (
                              <div key={p.id} className="list-item">
                                <strong>{p.full_name}</strong>
                                <span>{p.phone_number}</span>
                                <span>{p.email || "No email"}</span>
                                <div className="actions-row">
                                  {isSuperAdmin ? (
                                    <button className="btn" onClick={() => void transferPastorRecord(p.id)} disabled={busyKey === "transfer-pastor" || !pastorTransferChurchId}>
                                      {busyKey === "transfer-pastor" ? "Transferring..." : "Transfer Pastor"}
                                    </button>
                                  ) : null}
                                  <button className="btn btn-danger" onClick={() => void deletePastorRecord(p.id)} disabled={busyKey === "delete-pastor"}>
                                    {busyKey === "delete-pastor" ? "Deleting..." : "Delete Pastor"}
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : <p className="muted empty-state">No pastors configured yet.</p>}
                        </div>
                      </article>
                    ) : null}

                    {/* ═══ Admin Operations ═══ */}
                    {activeAdminTab === "admins" && isSuperAdmin ? (
                      <article className="panel">
                        <h3>Admin Operations</h3>
                        <div className="field-stack">
                          <label>
                            Church Filter
                            <select value={superAdminChurchId} onChange={(e) => setSuperAdminChurchId(e.target.value)}>
                              <option value="">All churches</option>
                              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
                            </select>
                          </label>
                          <label>Search Admin<input value={superAdminQuery} onChange={(e) => setSuperAdminQuery(e.target.value)} placeholder="Name or email" /></label>
                          <div className="actions-row">
                            <button className="btn" onClick={superSearchAdmins} disabled={busyKey === "super-admin-search"}>
                              {busyKey === "super-admin-search" ? "Searching..." : "Search Admins"}
                            </button>
                          </div>
                          <div className="list-stack">
                            {superAdminResults.length ? (
                              superAdminResults.slice(0, 8).map((a) => (
                                <div key={a.id} className="list-item">
                                  <strong>{a.full_name || a.email}</strong>
                                  <span>{a.email}</span>
                                  <span>{a.church_id || "No church"}</span>
                                  <div className="actions-row"><button className="btn" onClick={() => superSelectAdmin(a)}>Select Admin</button></div>
                                </div>
                              ))
                            ) : <p className="muted empty-state">No admin search results yet.</p>}
                          </div>
                          {superAdminSelectedId ? (
                            <>
                              <label>Admin Name<input value={superAdminEditName} onChange={(e) => setSuperAdminEditName(e.target.value)} /></label>
                              <label>
                                Assign Church
                                <select value={superAdminTargetChurchId} onChange={(e) => setSuperAdminTargetChurchId(e.target.value)}>
                                  <option value="">Select church</option>
                                  {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
                                </select>
                              </label>
                              <div className="actions-row">
                                <button className="btn" onClick={superUpdateAdmin} disabled={busyKey === "super-admin-update"}>
                                  {busyKey === "super-admin-update" ? "Updating..." : "Update Admin"}
                                </button>
                                <button className="btn btn-danger" onClick={superDeleteAdmin} disabled={busyKey === "super-admin-delete"}>
                                  {busyKey === "super-admin-delete" ? "Removing..." : "Remove Admin Role"}
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </article>
                    ) : null}

                    {/* ═══ Pre-register Member ═══ */}
                    {activeAdminTab === "pre-register" ? (
                      <article className="panel">
                        <h3>Pre-register Member</h3>
                        <p className="muted">Create member access by email with optional profile details.</p>
                        <div className="field-stack">
                          <label>Member Email<input value={preRegEmail} onChange={(e) => setPreRegEmail(e.target.value)} placeholder="member@church.com" /></label>
                          <label>Full Name<input value={preRegName} onChange={(e) => setPreRegName(e.target.value)} placeholder="Member Name" /></label>
                          <label>Membership ID<input value={preRegMembershipId} onChange={(e) => setPreRegMembershipId(e.target.value)} placeholder="M-1003" /></label>
                          <label>Address<input value={preRegAddress} onChange={(e) => setPreRegAddress(e.target.value)} placeholder="Kochi" /></label>
                          <label>Subscription Amount<input value={preRegAmount} onChange={(e) => setPreRegAmount(e.target.value)} placeholder="500" /></label>
                          {isSuperAdmin ? (
                            <label>
                              Church
                              <select value={preRegChurchId} onChange={(e) => setPreRegChurchId(e.target.value)}>
                                <option value="">Use your own church</option>
                                {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
                              </select>
                            </label>
                          ) : null}
                        </div>
                        <button className="btn btn-primary" onClick={preRegisterMember} disabled={busyKey === "pre-register"}>
                          {busyKey === "pre-register" ? "Saving..." : "Pre-register"}
                        </button>
                      </article>
                    ) : null}

                    {/* ═══ Role Management ═══ */}
                    {activeAdminTab === "roles" && isSuperAdmin ? (
                      <article className="panel">
                        <h3>Role Management</h3>
                        <div className="field-stack">
                          <label>Grant Email<input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} placeholder="new-admin@church.com" /></label>
                          <label>
                            Grant Church
                            <select value={grantChurchId} onChange={(e) => setGrantChurchId(e.target.value)}>
                              <option value="">Use current church</option>
                              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
                            </select>
                          </label>
                          <div className="actions-row">
                            <button className="btn btn-primary" onClick={grantAdmin} disabled={busyKey === "grant"}>
                              {busyKey === "grant" ? "Granting..." : "Grant Admin"}
                            </button>
                          </div>
                          <label>Revoke Email<input value={revokeEmail} onChange={(e) => setRevokeEmail(e.target.value)} placeholder="remove-admin@church.com" /></label>
                          <button className="btn btn-danger" onClick={revokeAdmin} disabled={busyKey === "revoke"}>
                            {busyKey === "revoke" ? "Revoking..." : "Revoke Admin"}
                          </button>
                        </div>
                      </article>
                    ) : null}

                    {/* ═══ Create Church ═══ */}
                    {activeAdminTab === "create-church" && isSuperAdmin ? (
                      <article className="panel">
                        <h3>Create Church</h3>
                        <p className="muted">New churches get a generated 6-digit unique ID.</p>
                        <div className="field-stack">
                          <label>Church Name<input value={churchCreateName} onChange={(e) => setChurchCreateName(e.target.value)} placeholder="Shalom City Church" /></label>
                          <label>Address<input value={churchCreateAddress} onChange={(e) => setChurchCreateAddress(e.target.value)} placeholder="Church address" /></label>
                          <label>Location<input value={churchCreateLocation} onChange={(e) => setChurchCreateLocation(e.target.value)} placeholder="Kochi" /></label>
                          <label>Contact Phone<input value={churchCreatePhone} onChange={(e) => setChurchCreatePhone(e.target.value)} placeholder="+91..." /></label>
                          <label>Dedicated Admin Emails<input value={churchCreateAdmins} onChange={(e) => setChurchCreateAdmins(e.target.value)} placeholder="admin1@mail.com, admin2@mail.com" /></label>
                        </div>
                        <button className="btn btn-primary" onClick={createChurchRecord} disabled={busyKey === "create-church"}>
                          {busyKey === "create-church" ? "Creating..." : "Create Church"}
                        </button>
                      </article>
                    ) : null}

                    {/* ═══ Payment Gateway ═══ */}
                    {activeAdminTab === "payments" && isSuperAdmin ? (
                      <article className="panel">
                        <h3>Church Payment Gateway</h3>
                        <p className="muted">Configure Razorpay credentials per church.</p>
                        <div className="field-stack">
                          <label>
                            Church
                            <select value={paymentConfigChurchId} onChange={(e) => setPaymentConfigChurchId(e.target.value)}>
                              <option value="">Select church</option>
                              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
                            </select>
                          </label>
                          <label className="checkbox-line">
                            <input type="checkbox" checked={churchPaymentEnabled} onChange={(e) => setChurchPaymentEnabled(e.target.checked)} />
                            Enable payments for this church
                          </label>
                          <label>Razorpay Key ID<input value={churchPaymentKeyId} onChange={(e) => setChurchPaymentKeyId(e.target.value)} placeholder="rzp_live_..." /></label>
                          <label>Razorpay Key Secret<input type="password" value={churchPaymentKeySecret} onChange={(e) => setChurchPaymentKeySecret(e.target.value)} placeholder={churchPaymentHasSecret ? "Secret saved (enter only to rotate)" : "Paste key secret"} /></label>
                        </div>
                        <div className="actions-row">
                          <button className="btn" onClick={() => void loadChurchPaymentSettings()} disabled={busyKey === "church-payment-config"}>
                            {busyKey === "church-payment-config" ? "Loading..." : "Load Config"}
                          </button>
                          <button className="btn btn-primary" onClick={saveChurchPaymentSettings} disabled={busyKey === "save-church-payment-config" || !churchPaymentSchemaReady}>
                            {busyKey === "save-church-payment-config" ? "Saving..." : "Save Payment Config"}
                          </button>
                        </div>
                        {!churchPaymentSchemaReady ? <p className="muted">Payment schema missing. Run db/shalom_expansion_migration.sql first.</p> : null}
                      </article>
                    ) : null}

                    {/* ═══ Events & Notifications ═══ */}
                    {activeAdminTab === "events" ? (
                      <article className="panel">
                        <h3>Events & Notifications</h3>
                        <div className="field-stack">
                          <label>Event Title<input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} placeholder="Sunday Service" /></label>
                          <label>Event Message<textarea value={eventMessage} onChange={(e) => setEventMessage(e.target.value)} placeholder="Event details" /></label>
                          <label>Event Date<input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
                        </div>
                        <div className="actions-row">
                          <button className="btn btn-primary" onClick={postEvent} disabled={busyKey === "post-event"}>
                            {busyKey === "post-event" ? "Posting..." : "Post Event"}
                          </button>
                        </div>
                        <div className="field-stack" style={{ marginTop: "1.5rem" }}>
                          <label>Notification Title<input value={notificationTitle} onChange={(e) => setNotificationTitle(e.target.value)} placeholder="Important Notice" /></label>
                          <label>Notification Message<textarea value={notificationMessage} onChange={(e) => setNotificationMessage(e.target.value)} placeholder="Notification details" /></label>
                        </div>
                        <button className="btn btn-primary" onClick={postNotification} disabled={busyKey === "post-notification"}>
                          {busyKey === "post-notification" ? "Posting..." : "Post Notification"}
                        </button>
                      </article>
                    ) : null}

                    {/* ═══ Activity Log ═══ */}
                    {activeAdminTab === "activity" ? (
                      <article className="panel">
                        <h3>Activity Console</h3>
                        {preRegResult ? <pre>{JSON.stringify(preRegResult, null, 2)}</pre> : <p className="muted empty-state">No pre-registration activity yet.</p>}
                      </article>
                    ) : null}

                  </section>
                </div>
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />

          <Route path="/signout" element={<SignOutPage onSignOut={signOut} busy={busyKey === "logout"} />} />

          <Route path="/signin" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>

        {showOperationConfirmModal ? (
          <section
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Operation confirmation"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeOperationConfirmDialog();
              }
            }}
          >
            <article className="modal-card">
              <div className="modal-header">
                <h3>{operationConfirmTitle || "Confirm Operation"}</h3>
                <button className="btn" onClick={closeOperationConfirmDialog} disabled={busyKey === "operation-confirm"}>
                  Close
                </button>
              </div>

              <p className="muted">{operationConfirmDescription || "Please verify this operation before continuing."}</p>

              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={operationConfirmChecked}
                  onChange={(event) => setOperationConfirmChecked(event.target.checked)}
                />
                I understand this operation and want to continue.
              </label>

              <label>
                Type {operationConfirmKeyword} to proceed
                <input
                  value={operationConfirmInput}
                  onChange={(event) => setOperationConfirmInput(event.target.value)}
                  placeholder={operationConfirmKeyword}
                />
              </label>

              <div className="actions-row">
                <button
                  className="btn btn-primary"
                  onClick={executeOperationConfirmDialog}
                  disabled={
                    busyKey === "operation-confirm" ||
                    !operationConfirmChecked ||
                    operationConfirmInput.trim().toUpperCase() !== operationConfirmKeyword
                  }
                >
                  {busyKey === "operation-confirm" ? "Verifying..." : "Verify And Execute"}
                </button>
              </div>
            </article>
          </section>
        ) : null}

        {!isSuperAdmin && showDonateModal ? (
          <section
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Donation window"
            onClick={(event) => {
              if (event.target === event.currentTarget && busyKey !== "donate") {
                setShowDonateModal(false);
              }
            }}
          >
            <article className="modal-card">
              <div className="modal-header">
                <h3>Donate to Church</h3>
                <button
                  className="btn"
                  onClick={() => setShowDonateModal(false)}
                  disabled={busyKey === "donate"}
                >
                  Close
                </button>
              </div>

              <div className="field-stack">
                <label>
                  Donation Amount
                  <input
                    type="number"
                    min={1}
                    step="1"
                    value={donationAmount}
                    onChange={(event) => setDonationAmount(event.target.value)}
                    placeholder="Enter amount"
                  />
                </label>
              </div>

              <div className="actions-row">
                <button
                  className="btn btn-primary"
                  onClick={donateToChurch}
                  disabled={busyKey === "donate" || !paymentsEnabled || !memberDashboard?.member?.id}
                >
                  {busyKey === "donate" ? "Processing..." : "Donate Now"}
                </button>
              </div>
            </article>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;
