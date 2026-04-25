export type ProfileRow = {
  id: string;
  email: string;
  phone_number?: string | null;
  full_name: string | null;
  avatar_url?: string | null;
  role: string;
  church_id: string | null;
};

export type AdminRow = ProfileRow;

export type ChurchRow = {
  id: string;
  church_code?: string | null;
  unique_id?: string;
  name: string;
  address?: string | null;
  location: string | null;
  contact_phone?: string | null;
  logo_url?: string | null;
  admin_count?: number;
  member_count?: number;
  pastor_count?: number;
};

export type NoticeTone = "neutral" | "success" | "error";
export type Notice = { tone: NoticeTone; text: string };

export type AuthContextData = {
  auth: {
    id: string;
    email: string;
    phone: string;
    role: string;
    church_id: string;
  };
  profile: ProfileRow;
  is_super_admin: boolean;
};

export type MemberRow = {
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
  gender: string | null;
  dob: string | null;
};

export type SubscriptionRow = {
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

export type FamilyMemberRow = {
  id: string;
  member_id: string;
  full_name: string;
  gender: string | null;
  relation: string | null;
  age: number | null;
  dob: string | null;
  has_subscription: boolean;
  linked_to_member_id: string | null;
  created_at: string;
};

export type DueSubscriptionRow = {
  subscription_id: string;
  family_member_id: string | null;
  person_name: string;
  amount: number;
  billing_cycle: string;
  next_payment_date: string;
  status: string;
};

export type ReceiptRow = {
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
  payment_category?: string | null;
  person_name?: string | null;
};

export type HistoryRow = {
  id: string;
  type: "subscription" | "payment";
  title: string;
  status: string;
  amount: number;
  date: string;
};

export type SubscriptionEventRow = {
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

export type MemberDashboard = {
  profile: ProfileRow;
  church: {
    id: string;
    church_code?: string | null;
    name: string;
    address?: string | null;
    location: string | null;
    contact_phone: string | null;
    logo_url?: string | null;
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
  church_subscription?: {
    amount: number | string;
    billing_cycle: string;
    status: string;
    next_payment_date: string | null;
    start_date: string | null;
  } | null;
  church_saas_settings?: {
    member_subscription_enabled: boolean;
    church_subscription_enabled: boolean;
    church_subscription_amount: number;
    service_enabled: boolean;
  } | null;
  _warnings?: string[];
};

export type PreRegisterResult = {
  user: AdminRow;
  member: MemberRow;
};

export type PaymentConfigResponse = {
  payments_enabled: boolean;
  key_id: string;
  source?: string;
  reason?: string;
};

export type ChurchPaymentSettings = {
  church_id: string;
  payments_enabled: boolean;
  key_id: string;
  has_key_secret: boolean;
  schema_ready: boolean;
};

export type WeeklyIncomeEntry = {
  day: string;
  income: number;
};

export type IncomeSummary = {
  church_id: string;
  daily_income: number;
  monthly_income: number;
  yearly_income: number;
  successful_payments_count: number;
  weekly_income_breakdown?: WeeklyIncomeEntry[];
};

export type MonthlyTrendEntry = {
  month: string;
  income: number;
};

export type IncomeBucket = {
  daily: number;
  monthly: number;
  yearly: number;
  count: number;
  weekly: WeeklyIncomeEntry[];
  monthly_trend: MonthlyTrendEntry[];
};

export type IncomeDetail = {
  church_id: string;
  subscription_income: IncomeBucket;
  donation_income: IncomeBucket;
  total_income: { daily: number; monthly: number; yearly: number; count: number };
};

export type PastorRow = {
  id: string;
  church_id: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  details: string | null;
  is_active: boolean;
};

export type EventRow = {
  id: string;
  church_id: string;
  title: string;
  message: string;
  event_date: string | null;
  image_url: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  church_id: string;
  title: string;
  message: string;
  image_url: string | null;
  created_at: string;
};

export type MemberDeleteImpact = {
  family_members: number;
  subscriptions: number;
  payments: number;
};

export type ChurchDeleteImpact = {
  users: number;
  members: number;
  pastors: number;
  church_events: number;
  church_notifications: number;
  prayer_requests: number;
  payments: number;
};

// ── Leadership Hierarchy Types ──

export type LeadershipRoleRow = {
  id: string;
  name: string;
  hierarchy_level: number;
  is_pastor_role: boolean;
  description: string | null;
};

export type ChurchLeadershipRow = {
  id: string;
  church_id: string;
  role_id: string;
  member_id: string | null;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  photo_url: string | null;
  bio: string | null;
  is_active: boolean;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
  role_name?: string;
  hierarchy_level?: number;
  is_pastor_role?: boolean;
  custom_role_name?: string;
  custom_hierarchy_level?: number;
};

export type AdminTabKey =
  | "members"
  | "churches"
  | "pastors"
  | "admins"
  | "pre-register"
  | "roles"
  | "create-church"
  | "payments"
  | "events"
  | "activity"
  | "membership-requests"
  | "family-requests"
  | "cancellation-requests"
  | "trial"
  | "export"
  | "audit-log"
  | "manual-payment"
  | "refunds"
  | "subscriptions"
  | "payment-history"
  | "bulk-import"
  | "restore"
  | "scheduled-reports"
  | "income-dashboard"
  | "leadership"
  | "saas-subscriptions"
  | "saas-settings"
  | "platform-razorpay"
  | "refund-requests"
  | "create-subscription"
  | "diocese"
  | "ad-banners"
  | "church-logo"
  | "special-dates"
  | "announcements"
  | "push-notifications"
  | "donation-funds";

// ── Diocese types ──

export type DioceseRow = {
  id: string;
  name: string;
  logo_url?: string | null;
  banner_url?: string | null;
  logo_urls?: string[];
  created_by?: string;
  created_at: string;
  updated_at: string;
  church_count?: number;
};

export type DioceseChurchRow = {
  id: string;
  diocese_id: string;
  church_id: string;
  added_at: string;
  church_name?: string;
  church_code?: string;
  church_location?: string;
};

export type DioceseLeaderRow = {
  id: string;
  diocese_id: string;
  role: string;
  full_name: string;
  phone_number?: string;
  email?: string;
  bio?: string;
  photo_url?: string;
  is_active: boolean;
  assigned_by?: string;
  created_at: string;
  updated_at: string;
};

// ── Ad Banner types ──

export type AdBannerRow = {
  id: string;
  scope: "diocese" | "church";
  scope_id: string;
  image_url: string;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  media_type: "image" | "video" | "gif";
  position: "top" | "bottom";
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// ── SaaS types ──

export type ChurchSaaSSettings = {
  church_id: string;
  member_subscription_enabled: boolean;
  church_subscription_enabled: boolean;
  church_subscription_amount: number;
  platform_fee_enabled: boolean;
  platform_fee_percentage: number;
  service_enabled: boolean;
};

export type ChurchSubscriptionRow = {
  id: string;
  church_id: string;
  amount: number;
  billing_cycle: "monthly" | "yearly";
  status: "active" | "inactive" | "overdue" | "cancelled";
  start_date: string;
  next_payment_date: string;
  last_payment_date: string | null;
  inactive_since: string | null;
  created_at: string;
};

export type ChurchSubscriptionSummary = {
  church_id: string;
  church_name: string;
  status: string;
  amount: number;
  next_payment_date: string | null;
  inactive_days: number | null;
};

export type SuperAdminRevenue = {
  church_subscription_revenue: number;
  platform_fee_revenue: number;
  total_revenue: number;
  active_church_subscriptions: number;
  inactive_church_subscriptions: number;
};

export type RefundRequestRow = {
  id: string;
  payment_id: string;
  member_id: string;
  church_id: string;
  transaction_id: string | null;
  amount: number;
  reason: string | null;
  status: "pending" | "forwarded" | "approved" | "denied" | "processed";
  forwarded_by: string | null;
  forwarded_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  member?: { full_name: string; email: string; phone_number?: string | null };
  payment?: { amount: number; payment_method: string; payment_date: string; receipt_number: string | null };
};

// ── Request types ──

export type MembershipRequestRow = {
  id: string;
  church_id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  address: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type CancellationRequestRow = {
  id: string;
  subscription_id: string;
  member_id: string;
  church_id: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  subscription?: SubscriptionRow;
  member?: { full_name: string; email: string; phone_number?: string | null };
};

export type AuditLogRow = {
  id: string;
  user_id: string | null;
  church_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
};

export type TrialStatus = {
  church_id: string;
  trial_ends_at: string | null;
  trial_granted_by: string | null;
  is_active: boolean;
  days_remaining: number;
};

// ── Payment History ──

export type PaymentHistoryRow = {
  id: string;
  member_id: string;
  subscription_id: string | null;
  amount: number | string;
  payment_method: string | null;
  transaction_id: string | null;
  payment_status: string | null;
  payment_date: string;
  receipt_number: string | null;
  payment_category?: string | null;
};

// ── Scheduled Reports ──

export type ScheduledReportRow = {
  id: string;
  church_id: string;
  report_type: string;
  frequency: string;
  recipient_emails: string[];
  recipient_phones?: string[];
  enabled: boolean;
  last_sent_at: string | null;
  created_at: string;
};

// ── Utility helpers ──

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string) {
  return UUID_REGEX.test(value);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(value: string) {
  return EMAIL_REGEX.test(value);
}

/** Validates Indian phone numbers: +91XXXXXXXXXX or 10-digit starting with 6-9 */
const INDIAN_PHONE_REGEX = /^(?:\+91)?[6-9]\d{9}$/;
export function isValidIndianPhone(value: string) {
  const cleaned = value.replace(/[\s\-()]/g, "");
  return INDIAN_PHONE_REGEX.test(cleaned);
}

/**
 * Strip any leading +91 / 91 and non-digit chars, return bare 10-digit number.
 * Used for display inside inputs that already show the +91 prefix.
 */
export function stripIndianPrefix(value: string): string {
  let d = value.replace(/[\s\-()]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.startsWith("91") && d.length > 10) d = d.slice(2);
  return d;
}

/**
 * Normalise any phone input into +91XXXXXXXXXX format.
 * Strips leading +91/91 if present, then re-prepends +91.
 */
export function normalizeIndianPhone(value: string): string {
  const digits = stripIndianPrefix(value).replace(/\D/g, "");
  if (!digits) return "";
  return `+91${digits}`;
}

export function formatDate(value?: string | null, includeTime = true) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (!includeTime) return date.toLocaleDateString("en-IN", { dateStyle: "medium" });
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function formatAmount(value?: number | string | null) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "Rs 0.00";
  return `Rs ${amount.toFixed(2)}`;
}

export function initials(fullName: string | null | undefined, emailOrPhone: string) {
  const source = (fullName || emailOrPhone).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function toReadableEvent(eventType: string) {
  return eventType
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  manual_cash: "Cash (Manual)",
  manual_bank_transfer: "Bank Transfer (Manual)",
  manual_upi_manual: "UPI (Manual)",
  manual_cheque: "Cheque (Manual)",
  manual_other: "Other (Manual)",
  razorpay: "Razorpay",
  upi: "UPI",
};

export function humanizePaymentMethod(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_METHOD_LABELS[method] || toReadableEvent(method);
}

export function isManualPayment(method: string | null | undefined): boolean {
  return !!method && method.startsWith("manual_");
}

export function loadRazorpayCheckoutScript() {
  if ((window as any).Razorpay) return Promise.resolve(true);
  const existing = document.querySelector('script[src*="checkout.razorpay.com"]');
  if (existing) existing.remove();
  return new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export const emptyWeeklyIncome: WeeklyIncomeEntry[] = [
  { day: "Sun", income: 0 },
  { day: "Mon", income: 0 },
  { day: "Tue", income: 0 },
  { day: "Wed", income: 0 },
  { day: "Thu", income: 0 },
  { day: "Fri", income: 0 },
  { day: "Sat", income: 0 },
];

export const emptyMonthlyTrend: MonthlyTrendEntry[] = [];
