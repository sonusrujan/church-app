/**
 * Razorpay Routes Service — handles linked account CRUD, transfer creation,
 * and settlement tracking. All operations are super-admin only at the route level.
 */
import Razorpay from "razorpay";
import { db, rawQuery } from "./dbClient";
import { logger } from "../utils/logger";
import { getEffectivePaymentConfig } from "./churchPaymentService";

// ─── Types ───────────────────────────────────────────────

export type LinkedAccount = {
  id: string;
  church_id: string;
  razorpay_account_id: string;
  account_status: string;
  business_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc_code: string | null;
  legal_business_name: string | null;
  legal_info: Record<string, unknown>;
  onboarded_by: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentTransfer = {
  id: string;
  payment_id: string;
  church_id: string;
  linked_account_id: string;
  razorpay_transfer_id: string | null;
  transfer_amount: number;
  platform_fee_amount: number;
  transfer_status: string;
  razorpay_order_id: string | null;
  settled_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

type CreateLinkedAccountInput = {
  church_id: string;
  email: string;
  phone: string;
  legal_business_name: string;
  business_type: string;
  contact_name: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_ifsc_code: string;
  onboarded_by: string;
};

// ─── Helpers ─────────────────────────────────────────────

async function getPlatformRazorpayClient(): Promise<Razorpay> {
  // Use the global/platform Razorpay credentials (not church-level)
  const config = await getEffectivePaymentConfig(null);
  if (!config.payments_enabled || !config.key_id || !config.key_secret) {
    throw new Error("Platform Razorpay credentials are not configured");
  }
  return new Razorpay({ key_id: config.key_id, key_secret: config.key_secret });
}

// ─── Linked Account Operations ───────────────────────────

/**
 * Create a Razorpay linked account (Route account) for a church.
 * This calls the Razorpay Account API to onboard a sub-merchant.
 */
export async function createLinkedAccount(input: CreateLinkedAccountInput): Promise<LinkedAccount> {
  // Check if church already has a linked account
  const { data: existing } = await db
    .from("church_linked_accounts")
    .select("id, razorpay_account_id, account_status")
    .eq("church_id", input.church_id)
    .maybeSingle<LinkedAccount>();

  if (existing) {
    throw new Error(`Church already has a linked account (${existing.account_status})`);
  }

  const client = await getPlatformRazorpayClient();

  // Create the account on Razorpay using their Account API v2
  const accountPayload = {
    email: input.email,
    phone: input.phone,
    type: "route",
    legal_business_name: input.legal_business_name,
    business_type: input.business_type || "not_yet_categorised",
    contact_name: input.contact_name,
    legal_info: {
      pan: "", // Will be filled during KYC
    },
    notes: {
      church_id: input.church_id,
      platform: "shalom",
    },
  };

  let razorpayAccount: any;
  try {
    razorpayAccount = await (client as any).accounts.create(accountPayload);
  } catch (err: any) {
    logger.error({ err, churchId: input.church_id }, "Razorpay account creation failed");
    const msg = err?.error?.description || err?.message || "Failed to create linked account on Razorpay";
    throw new Error(msg);
  }

  const accountId = razorpayAccount.id;

  // Store in our DB
  const { data: row, error } = await db
    .from("church_linked_accounts")
    .insert([{
      church_id: input.church_id,
      razorpay_account_id: accountId,
      account_status: razorpayAccount.status || "created",
      business_name: input.legal_business_name,
      contact_name: input.contact_name,
      email: input.email,
      phone: input.phone,
      bank_account_name: input.bank_account_name,
      bank_account_number: maskAccountNumber(input.bank_account_number),
      bank_ifsc_code: input.bank_ifsc_code,
      legal_business_name: input.legal_business_name,
      onboarded_by: input.onboarded_by,
    }])
    .select("*")
    .single<LinkedAccount>();

  if (error) {
    logger.error({ err: error }, "Failed to store linked account in DB");
    throw error;
  }

  // Update churches table
  await db
    .from("churches")
    .update({
      razorpay_linked_account_id: accountId,
      routes_enabled: true,
    })
    .eq("id", input.church_id);

  // Now add the bank account to the linked account via stakeholder + bank account APIs
  try {
    // Create product configuration request (for route settlements)
    await (client as any).accounts.requestProductConfiguration(accountId, {
      product_name: "route",
      tnc_accepted: true,
    });
  } catch (productErr: any) {
    logger.warn({ err: productErr, accountId }, "Product config request failed, manual activation may be needed");
  }

  logger.info({ churchId: input.church_id, accountId }, "Razorpay linked account created");
  return row!;
}

/**
 * Fetch all linked accounts (for super admin overview).
 */
export async function listLinkedAccounts(): Promise<(LinkedAccount & { church_name?: string })[]> {
  const { rows } = await rawQuery<LinkedAccount & { church_name: string }>(
    `SELECT la.*, c.name AS church_name
     FROM church_linked_accounts la
     JOIN churches c ON c.id = la.church_id
     ORDER BY la.created_at DESC`,
  );
  return rows;
}

/**
 * Fetch linked account for a specific church.
 */
export async function getLinkedAccountByChurch(churchId: string): Promise<LinkedAccount | null> {
  const { data } = await db
    .from("church_linked_accounts")
    .select("*")
    .eq("church_id", churchId)
    .maybeSingle<LinkedAccount>();
  return data;
}

/**
 * Sync linked account status with Razorpay.
 */
export async function syncLinkedAccountStatus(churchId: string): Promise<LinkedAccount | null> {
  const account = await getLinkedAccountByChurch(churchId);
  if (!account) return null;

  const client = await getPlatformRazorpayClient();

  try {
    const rzpAccount = await (client as any).accounts.fetch(account.razorpay_account_id);
    const newStatus = rzpAccount.status || account.account_status;

    if (newStatus !== account.account_status) {
      await db
        .from("church_linked_accounts")
        .update({
          account_status: newStatus,
          activated_at: newStatus === "activated" ? new Date().toISOString() : account.activated_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);

      // If activated, make sure routes_enabled is true on the church
      if (newStatus === "activated") {
        await db.from("churches").update({ routes_enabled: true }).eq("id", churchId);
      }
    }

    return { ...account, account_status: newStatus };
  } catch (err: any) {
    logger.warn({ err, churchId }, "Failed to sync linked account status");
    return account;
  }
}

// ─── Transfer Operations ─────────────────────────────────

/**
 * Build the Razorpay transfers array for order creation.
 * Returns null if the church doesn't have Routes enabled.
 */
export async function buildOrderTransfers(
  churchId: string,
  baseAmount: number,
  platformFee: number,
): Promise<{ transfers: Array<{ account: string; amount: number; currency: string; notes: Record<string, string> }> } | null> {
  // Check if church has an active linked account
  const { data: church } = await db
    .from("churches")
    .select("routes_enabled, razorpay_linked_account_id")
    .eq("id", churchId)
    .maybeSingle<{ routes_enabled: boolean; razorpay_linked_account_id: string | null }>();

  if (!church?.routes_enabled || !church.razorpay_linked_account_id) {
    return null;
  }

  // Verify the linked account is activated
  const { data: linkedAccount } = await db
    .from("church_linked_accounts")
    .select("account_status")
    .eq("church_id", churchId)
    .maybeSingle<{ account_status: string }>();

  if (!linkedAccount || linkedAccount.account_status !== "activated") {
    logger.warn({ churchId }, "Routes enabled but linked account not activated, skipping transfer");
    return null;
  }

  // Church gets the base amount (total minus platform fee), in paise
  const churchAmountPaise = Math.round(baseAmount * 100);

  return {
    transfers: [{
      account: church.razorpay_linked_account_id,
      amount: churchAmountPaise,
      currency: "INR",
      notes: {
        church_id: churchId,
        base_amount: String(baseAmount),
        platform_fee: String(platformFee),
      },
    }],
  };
}

/**
 * Record a transfer in our DB after a payment is verified.
 */
export async function recordPaymentTransfer(input: {
  payment_id: string;
  church_id: string;
  linked_account_id: string;
  razorpay_transfer_id?: string;
  transfer_amount: number;
  platform_fee_amount: number;
  razorpay_order_id?: string;
  transfer_status?: string;
}): Promise<void> {
  const { error } = await db
    .from("payment_transfers")
    .insert([{
      payment_id: input.payment_id,
      church_id: input.church_id,
      linked_account_id: input.linked_account_id,
      razorpay_transfer_id: input.razorpay_transfer_id || null,
      transfer_amount: input.transfer_amount,
      platform_fee_amount: input.platform_fee_amount,
      razorpay_order_id: input.razorpay_order_id || null,
      transfer_status: input.transfer_status || "created",
    }]);

  if (error) {
    logger.error({ err: error, paymentId: input.payment_id }, "Failed to record payment transfer");
    // Don't throw — transfer tracking failure shouldn't block the payment
  }

  // Update the payment's transfer_status column
  await db
    .from("payments")
    .update({ transfer_status: input.transfer_status || "created" })
    .eq("id", input.payment_id);
}

/**
 * Fetch transfers for a specific payment.
 */
export async function getTransfersByPayment(paymentId: string): Promise<PaymentTransfer[]> {
  const { data, error } = await db
    .from("payment_transfers")
    .select("*")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.warn({ err: error, paymentId }, "Failed to fetch payment transfers");
    return [];
  }
  return (data || []) as PaymentTransfer[];
}

/**
 * List all transfers with church names (super admin dashboard).
 */
export async function listAllTransfers(opts: {
  limit?: number;
  offset?: number;
  church_id?: string;
  status?: string;
}): Promise<{ transfers: Array<PaymentTransfer & { church_name: string }>; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.church_id) {
    params.push(opts.church_id);
    conditions.push(`pt.church_id = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    conditions.push(`pt.transfer_status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit || 20, 1), 100);
  const offset = Math.max(opts.offset || 0, 0);

  const countResult = await rawQuery<{ count: string }>(
    `SELECT count(*)::text FROM payment_transfers pt ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const dataParams = [...params, limit, offset];
  const { rows } = await rawQuery<PaymentTransfer & { church_name: string }>(
    `SELECT pt.*, c.name AS church_name
     FROM payment_transfers pt
     JOIN churches c ON c.id = pt.church_id
     ${where}
     ORDER BY pt.created_at DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
  );

  return { transfers: rows, total };
}

/**
 * Get transfer summary stats for super admin dashboard.
 */
export async function getTransferSummary(): Promise<{
  total_transfers: number;
  total_transferred: number;
  total_platform_fees: number;
  pending_count: number;
  settled_count: number;
  failed_count: number;
}> {
  const { rows } = await rawQuery<{
    total_transfers: string;
    total_transferred: string;
    total_platform_fees: string;
    pending_count: string;
    settled_count: string;
    failed_count: string;
  }>(
    `SELECT
       count(*)::text AS total_transfers,
       COALESCE(sum(transfer_amount), 0)::text AS total_transferred,
       COALESCE(sum(platform_fee_amount), 0)::text AS total_platform_fees,
       count(*) FILTER (WHERE transfer_status IN ('created', 'pending'))::text AS pending_count,
       count(*) FILTER (WHERE transfer_status = 'settled')::text AS settled_count,
       count(*) FILTER (WHERE transfer_status = 'failed')::text AS failed_count
     FROM payment_transfers`,
  );

  const r = rows[0];
  return {
    total_transfers: Number(r?.total_transfers || 0),
    total_transferred: Number(r?.total_transferred || 0),
    total_platform_fees: Number(r?.total_platform_fees || 0),
    pending_count: Number(r?.pending_count || 0),
    settled_count: Number(r?.settled_count || 0),
    failed_count: Number(r?.failed_count || 0),
  };
}

/**
 * Handle Razorpay transfer webhook events.
 *
 * Bug fix: records may have been inserted with razorpay_transfer_id = NULL
 * (the ID isn't available at order-creation time — only Razorpay knows it after
 * the transfer fires). Primary match is by transfer ID; fallback is by
 * razorpay_order_id using the transfer entity's `source` field (order_xxx).
 * The transfer ID is backfilled on the fallback path so future webhooks match directly.
 */
export async function handleTransferWebhook(_event: string, payload: any): Promise<void> {
  const transferData = payload?.transfer?.entity;
  if (!transferData?.id) return;

  const transferId = transferData.id;
  const status = transferData.status; // processed, settled, failed, reversed

  const statusMap: Record<string, string> = {
    processed: "processed",
    settled: "settled",
    failed: "failed",
    reversed: "reversed",
  };

  const mappedStatus = statusMap[status];
  if (!mappedStatus) return;

  // Primary: match by razorpay_transfer_id (set on subsequent webhooks after backfill)
  let { rows } = await rawQuery<{ id: string; payment_id: string }>(
    `UPDATE payment_transfers
     SET transfer_status = $1,
         razorpay_transfer_id = $3,
         settled_at = CASE WHEN $1 = 'settled' THEN now() ELSE settled_at END,
         failure_reason = $2,
         updated_at = now()
     WHERE razorpay_transfer_id = $3
     RETURNING id, payment_id`,
    [mappedStatus, transferData.failure_reason || null, transferId],
  );

  // Fallback: match by order_id when transfer_id was NULL at record-creation time.
  // transferData.source is the Razorpay order ID (format: order_xxx) that originated the transfer.
  if (rows.length === 0 && transferData.source) {
    const fallback = await rawQuery<{ id: string; payment_id: string }>(
      `UPDATE payment_transfers
       SET transfer_status = $1,
           razorpay_transfer_id = $3,
           settled_at = CASE WHEN $1 = 'settled' THEN now() ELSE settled_at END,
           failure_reason = $2,
           updated_at = now()
       WHERE razorpay_order_id = $4
         AND razorpay_transfer_id IS NULL
       RETURNING id, payment_id`,
      [mappedStatus, transferData.failure_reason || null, transferId, transferData.source],
    );
    rows = fallback.rows;
    if (rows.length > 0) {
      logger.info({ transferId, orderId: transferData.source }, "Transfer webhook matched via order_id fallback — transfer ID backfilled");
    }
  }

  if (rows.length === 0) {
    logger.warn({ transferId, source: transferData.source, status: mappedStatus }, "Transfer webhook: no matching payment_transfers row found");
    return;
  }

  // Update the payment's transfer_status
  await db
    .from("payments")
    .update({ transfer_status: mappedStatus })
    .eq("id", rows[0].payment_id);

  // Log settlement details
  if (mappedStatus === "settled" && transferData.settlement_id) {
    await db
      .from("transfer_settlement_log")
      .insert([{
        transfer_id: rows[0].id,
        razorpay_settlement_id: transferData.settlement_id,
        amount: Number(transferData.amount || 0) / 100,
        utr: transferData.utr || null,
      }]);
  }

  logger.info({ transferId, status: mappedStatus }, "Transfer webhook processed");
}

// ─── Utilities ───────────────────────────────────────────

function maskAccountNumber(num: string): string {
  if (!num || num.length < 4) return "****";
  return "****" + num.slice(-4);
}
