import { db } from "./dbClient";
import { logger } from "../utils/logger";

// ── Types ──

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
  updated_at: string;
};

export type ChurchSubscriptionPaymentRow = {
  id: string;
  church_subscription_id: string;
  church_id: string;
  amount: number;
  payment_method: string | null;
  transaction_id: string | null;
  payment_status: "success" | "failed" | "pending";
  payment_date: string;
  note: string | null;
  created_at: string;
};

export type PlatformFeeRow = {
  id: string;
  payment_id: string | null;
  church_id: string;
  member_id: string | null;
  base_amount: number;
  fee_percentage: number;
  fee_amount: number;
  collected_at: string;
};

export type ChurchSaaSSettings = {
  church_id: string;
  member_subscription_enabled: boolean;
  church_subscription_enabled: boolean;
  church_subscription_amount: number;
  platform_fee_enabled: boolean;
  platform_fee_percentage: number;
  service_enabled: boolean;
};

export type ChurchSubscriptionSummary = {
  church_id: string;
  church_name: string;
  status: string;
  amount: number;
  next_payment_date: string | null;
  inactive_days: number | null;
};

// ── SaaS Settings ──

export async function getChurchSaaSSettings(churchId: string): Promise<ChurchSaaSSettings> {
  const { data, error } = await db
    .from("churches")
    .select("id, member_subscription_enabled, church_subscription_enabled, church_subscription_amount, platform_fee_enabled, platform_fee_percentage, service_enabled")
    .eq("id", churchId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, churchId }, "getChurchSaaSSettings failed");
    throw error;
  }
  if (!data) throw new Error("Church not found");

  return {
    church_id: data.id,
    member_subscription_enabled: data.member_subscription_enabled ?? true,
    church_subscription_enabled: data.church_subscription_enabled ?? false,
    church_subscription_amount: Number(data.church_subscription_amount ?? 0),
    platform_fee_enabled: data.platform_fee_enabled ?? false,
    platform_fee_percentage: Number(data.platform_fee_percentage ?? 2),
    service_enabled: data.service_enabled ?? true,
  };
}

export async function updateChurchSaaSSettings(churchId: string, settings: Partial<{
  member_subscription_enabled: boolean;
  church_subscription_enabled: boolean;
  church_subscription_amount: number;
  platform_fee_enabled: boolean;
  platform_fee_percentage: number;
  service_enabled: boolean;
}>): Promise<ChurchSaaSSettings> {
  const patch: Record<string, unknown> = {};

  if (typeof settings.member_subscription_enabled === "boolean") {
    patch.member_subscription_enabled = settings.member_subscription_enabled;
  }
  if (typeof settings.church_subscription_enabled === "boolean") {
    patch.church_subscription_enabled = settings.church_subscription_enabled;
  }
  if (typeof settings.church_subscription_amount === "number" && settings.church_subscription_amount >= 0) {
    patch.church_subscription_amount = settings.church_subscription_amount;
  }
  if (typeof settings.platform_fee_enabled === "boolean") {
    patch.platform_fee_enabled = settings.platform_fee_enabled;
  }
  if (typeof settings.platform_fee_percentage === "number" && settings.platform_fee_percentage >= 0 && settings.platform_fee_percentage <= 10) {
    patch.platform_fee_percentage = settings.platform_fee_percentage;
  } else if (typeof settings.platform_fee_percentage === "number") {
    throw new Error("Platform fee percentage must be between 0 and 10");
  }
  if (typeof settings.service_enabled === "boolean") {
    patch.service_enabled = settings.service_enabled;
  }

  if (Object.keys(patch).length === 0) throw new Error("No valid settings provided");

  const { data, error } = await db
    .from("churches")
    .update(patch)
    .eq("id", churchId)
    .select("id, member_subscription_enabled, church_subscription_enabled, church_subscription_amount, platform_fee_enabled, platform_fee_percentage, service_enabled")
    .single();

  if (error) {
    logger.error({ err: error, churchId }, "updateChurchSaaSSettings failed");
    throw error;
  }

  return {
    church_id: data.id,
    member_subscription_enabled: data.member_subscription_enabled ?? true,
    church_subscription_enabled: data.church_subscription_enabled ?? false,
    church_subscription_amount: Number(data.church_subscription_amount ?? 0),
    platform_fee_enabled: data.platform_fee_enabled ?? false,
    platform_fee_percentage: Number(data.platform_fee_percentage ?? 2),
    service_enabled: data.service_enabled ?? true,
  };
}

// ── Church Subscriptions ──

export async function createChurchSubscription(input: {
  church_id: string;
  amount: number;
  billing_cycle?: "monthly" | "yearly";
}): Promise<ChurchSubscriptionRow> {
  const now = new Date();
  const nextPayment = new Date(now);
  if (input.billing_cycle === "yearly") {
    nextPayment.setFullYear(nextPayment.getFullYear() + 1);
  } else {
    nextPayment.setMonth(nextPayment.getMonth() + 1);
  }

  const { data, error } = await db
    .from("church_subscriptions")
    .insert({
      church_id: input.church_id,
      amount: input.amount,
      billing_cycle: input.billing_cycle || "monthly",
      status: "active",
      start_date: now.toISOString().split("T")[0],
      next_payment_date: nextPayment.toISOString().split("T")[0],
    })
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, "createChurchSubscription failed");
    throw error;
  }
  return data as ChurchSubscriptionRow;
}

export async function getChurchSubscription(churchId: string): Promise<ChurchSubscriptionRow | null> {
  const { data, error } = await db
    .from("church_subscriptions")
    .select("*")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, churchId }, "getChurchSubscription failed");
    throw error;
  }
  return data as ChurchSubscriptionRow | null;
}

export async function updateChurchSubscriptionStatus(
  subscriptionId: string,
  status: "active" | "inactive" | "overdue" | "cancelled",
): Promise<ChurchSubscriptionRow> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "inactive") {
    patch.inactive_since = new Date().toISOString().split("T")[0];
  }
  if (status === "active") {
    patch.inactive_since = null;
  }

  const { data, error } = await db
    .from("church_subscriptions")
    .update(patch)
    .eq("id", subscriptionId)
    .select()
    .single();

  if (error) {
    logger.error({ err: error, subscriptionId }, "updateChurchSubscriptionStatus failed");
    throw error;
  }
  return data as ChurchSubscriptionRow;
}

// ── Church Subscription Status Overview ──

export async function listChurchSubscriptionStatuses(filter?: "active" | "inactive"): Promise<ChurchSubscriptionSummary[]> {
  let query = db
    .from("church_subscriptions")
    .select("id, church_id, amount, status, next_payment_date, inactive_since, churches(name)")
    .order("created_at", { ascending: false });

  if (filter === "active") {
    query = query.eq("status", "active");
  } else if (filter === "inactive") {
    query = query.in("status", ["inactive", "overdue", "cancelled"]);
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error }, "listChurchSubscriptionStatuses failed");
    throw error;
  }

  return (data || []).map((row: any) => {
    let inactiveDays: number | null = null;
    if (row.inactive_since) {
      const diff = Date.now() - new Date(row.inactive_since).getTime();
      inactiveDays = Math.floor(diff / (1000 * 60 * 60 * 24));
    }
    return {
      church_id: row.church_id,
      church_name: row.churches?.name || "Unknown",
      status: row.status,
      amount: Number(row.amount),
      next_payment_date: row.next_payment_date,
      inactive_days: inactiveDays,
    };
  });
}

// ── Church Subscription Payments ──

export async function recordChurchSubscriptionPayment(input: {
  church_subscription_id: string;
  church_id: string;
  amount: number;
  payment_method?: string;
  transaction_id?: string;
  note?: string;
}): Promise<ChurchSubscriptionPaymentRow> {
  // HIGH-07: Use a transaction to atomically record payment + update subscription
  const { getClient } = await import("./dbClient");
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // Insert payment record
    const insertResult = await client.query(
      `INSERT INTO church_subscription_payments (church_subscription_id, church_id, amount, payment_method, transaction_id, payment_status, payment_date, note)
       VALUES ($1, $2, $3, $4, $5, 'success', $6, $7)
       RETURNING *`,
      [
        input.church_subscription_id,
        input.church_id,
        input.amount,
        input.payment_method || "manual",
        input.transaction_id || null,
        new Date().toISOString(),
        input.note || null,
      ]
    );
    const data = insertResult.rows[0] as ChurchSubscriptionPaymentRow;

    // Fetch billing cycle then update subscription
    const subResult = await client.query(
      `SELECT billing_cycle FROM church_subscriptions WHERE id = $1`,
      [input.church_subscription_id]
    );
    if (subResult.rows[0]) {
      const nextDate = new Date();
      if (subResult.rows[0].billing_cycle === "yearly") {
        nextDate.setFullYear(nextDate.getFullYear() + 1);
      } else {
        nextDate.setMonth(nextDate.getMonth() + 1);
      }
      await client.query(
        `UPDATE church_subscriptions SET status = 'active', inactive_since = NULL,
         last_payment_date = $1, next_payment_date = $2, updated_at = $3
         WHERE id = $4`,
        [
          new Date().toISOString().split("T")[0],
          nextDate.toISOString().split("T")[0],
          new Date().toISOString(),
          input.church_subscription_id,
        ]
      );
    }

    await client.query("COMMIT");
    return data;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "recordChurchSubscriptionPayment failed");
    throw err;
  } finally {
    client.release();
  }
}

export async function getChurchSubscriptionPayments(churchId: string, limit = 50): Promise<ChurchSubscriptionPaymentRow[]> {
  const { data, error } = await db
    .from("church_subscription_payments")
    .select("*")
    .eq("church_id", churchId)
    .order("payment_date", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ err: error, churchId }, "getChurchSubscriptionPayments failed");
    throw error;
  }
  return (data || []) as ChurchSubscriptionPaymentRow[];
}

// ── Platform Fee ──

export async function recordPlatformFee(input: {
  payment_id: string;
  church_id: string;
  member_id: string;
  base_amount: number;
  fee_percentage: number;
}): Promise<PlatformFeeRow> {
  const feeAmount = Number(((input.base_amount * input.fee_percentage) / 100).toFixed(2));

  const { data, error } = await db
    .from("platform_fee_collections")
    .insert({
      payment_id: input.payment_id,
      church_id: input.church_id,
      member_id: input.member_id,
      base_amount: input.base_amount,
      fee_percentage: input.fee_percentage,
      fee_amount: feeAmount,
    })
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, "recordPlatformFee failed");
    throw error;
  }
  return data as PlatformFeeRow;
}

export async function getPlatformFeeSummary(): Promise<{
  total_fees_collected: number;
  this_month: number;
  fee_count: number;
}> {
  const { data, error } = await db
    .from("platform_fee_collections")
    .select("fee_amount, collected_at");

  if (error) {
    logger.error({ err: error }, "getPlatformFeeSummary failed");
    throw error;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let total = 0;
  let thisMonth = 0;

  for (const row of data || []) {
    const amount = Number(row.fee_amount);
    total += amount;
    if (new Date(row.collected_at) >= monthStart) {
      thisMonth += amount;
    }
  }

  return {
    total_fees_collected: Number(total.toFixed(2)),
    this_month: Number(thisMonth.toFixed(2)),
    fee_count: (data || []).length,
  };
}

// ── Super Admin Revenue Summary ──

export async function getSuperAdminRevenue(): Promise<{
  church_subscription_revenue: number;
  platform_fee_revenue: number;
  total_revenue: number;
  active_church_subscriptions: number;
  inactive_church_subscriptions: number;
}> {
  // Church subscription payments total
  const { data: subPayments } = await db
    .from("church_subscription_payments")
    .select("amount")
    .eq("payment_status", "success");

  const subRevenue = (subPayments || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0);

  // Platform fee total
  const { data: fees } = await db
    .from("platform_fee_collections")
    .select("fee_amount");

  const feeRevenue = (fees || []).reduce((sum: number, r: any) => sum + Number(r.fee_amount), 0);

  // Subscription status counts
  const { data: activeSubs } = await db
    .from("church_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  const { data: inactiveSubs } = await db
    .from("church_subscriptions")
    .select("id", { count: "exact", head: true })
    .in("status", ["inactive", "overdue", "cancelled"]);

  return {
    church_subscription_revenue: Number(subRevenue.toFixed(2)),
    platform_fee_revenue: Number(feeRevenue.toFixed(2)),
    total_revenue: Number((subRevenue + feeRevenue).toFixed(2)),
    active_church_subscriptions: (activeSubs as any)?.length ?? 0,
    inactive_church_subscriptions: (inactiveSubs as any)?.length ?? 0,
  };
}
