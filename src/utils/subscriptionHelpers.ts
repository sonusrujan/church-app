/**
 * Pure helper functions for subscription payment logic.
 * Extracted from paymentRoutes for testability.
 */

export function computeNextDueDate(previousDueDate: string, billingCycle: string): string {
  const base = new Date(previousDueDate);
  if (Number.isNaN(base.getTime())) {
    // Fallback: next month's 5th (UTC)
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    return formatUTCDate(y, m + 1, 5);
  }

  const normalizedCycle = (billingCycle || "monthly").toLowerCase();

  // Use UTC midnight today as the comparison point to avoid IST/UTC drift.
  // All due dates are stored as date-only strings (YYYY-MM-DD), so comparing
  // in UTC is correct regardless of the server's timezone.
  const todayUTC = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  );

  // Advance from the base date by one cycle at a time until we're in the future
  let y = base.getUTCFullYear();
  let m = base.getUTCMonth();

  if (normalizedCycle === "yearly") {
    y += 1;
    // Keep advancing by year until we're past today
    while (Date.UTC(y, m, 5) <= todayUTC) {
      y += 1;
    }
    return formatUTCDate(y, m, 5);
  }

  // Monthly: advance month-by-month until the 5th is in the future
  m += 1;
  while (Date.UTC(y, m, 5) <= todayUTC) {
    m += 1;
  }
  return formatUTCDate(y, m, 5);
}

/** Build a YYYY-MM-DD string using UTC to avoid timezone drift */
function formatUTCDate(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return d.toISOString().slice(0, 10);
}

export type SubscriptionStatus = string;

export interface DueCheckSubscription {
  status: SubscriptionStatus;
  next_payment_date: string;
}

export function isDueSubscription(subscription: DueCheckSubscription, now = new Date()): boolean {
  const status = (subscription.status || "").toLowerCase();
  if (status === "cancelled" || status === "paused") {
    return false;
  }

  if (status === "overdue" || status === "pending_first_payment") {
    return true;
  }

  const nextDue = new Date(subscription.next_payment_date);
  if (Number.isNaN(nextDue.getTime())) {
    return false;
  }

  return nextDue.getTime() <= now.getTime();
}

export function normalizeSelectedSubscriptionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}
