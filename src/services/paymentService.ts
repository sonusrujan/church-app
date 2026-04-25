import Razorpay from "razorpay";
import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { recordSubscriptionEvent } from "./subscriptionTrackingService";
import { createReceiptNumber } from "./receiptService";

interface StoredPaymentRow {
  id: string;
  receipt_number: string | null;
}

type RazorpayCredentials = {
  key_id: string;
  key_secret: string;
};

// HIGH-05: LRU cache for Razorpay clients with max 100 entries
const MAX_RAZORPAY_CLIENTS = 100;
const razorpayClients = new Map<string, Razorpay>();

function getRazorpayClient(credentials: RazorpayCredentials) {
  if (!credentials.key_id || !credentials.key_secret) {
    throw new Error("Razorpay credentials are missing for this church");
  }

  const cached = razorpayClients.get(credentials.key_id);
  if (cached) {
    // Move to end (most recently used)
    razorpayClients.delete(credentials.key_id);
    razorpayClients.set(credentials.key_id, cached);
    return cached;
  }

  try {
    const client = new Razorpay({
      key_id: credentials.key_id,
      key_secret: credentials.key_secret,
    });
    // Evict oldest if at capacity
    if (razorpayClients.size >= MAX_RAZORPAY_CLIENTS) {
      const oldest = razorpayClients.keys().next().value;
      if (oldest) razorpayClients.delete(oldest);
    }
    razorpayClients.set(credentials.key_id, client);
    return client;
  } catch (err) {
    logger.error({ err }, "Failed to initialize Razorpay SDK");
    throw new Error("Payment gateway initialization failed. Please contact support.");
  }
}

export async function createPaymentOrder(
  amount: number,
  currency = "INR",
  receipt = "church_receipt",
  credentials: RazorpayCredentials,
  notes?: Record<string, string>,
  transfers?: Array<{ account: string; amount: number; currency: string; notes?: Record<string, string> }>,
) {
  const client = getRazorpayClient(credentials);
  const options: Record<string, unknown> = {
    amount: Math.round(amount * 100),
    currency,
    receipt,
    payment_capture: 1,
  };
  if (notes) options.notes = notes;
  if (transfers && transfers.length > 0) options.transfers = transfers;
  const order = await client.orders.create(options as any);
  return order;
}

export async function fetchRazorpayOrder(
  orderId: string,
  credentials: RazorpayCredentials
): Promise<{ amount: number; amount_paid: number; status: string; notes?: Record<string, string> }> {
  const client = getRazorpayClient(credentials);
  const order = await client.orders.fetch(orderId);
  return {
    amount: Number(order.amount) / 100,
    amount_paid: Number(order.amount_paid) / 100,
    status: String(order.status),
    notes: (order as any).notes || undefined,
  };
}

export async function verifyPayment(
  signature: string,
  order_id: string,
  payment_id: string,
  credentials: RazorpayCredentials
) {
  if (!credentials.key_secret) {
    throw new Error("Razorpay key_secret is missing for this church");
  }

  const crypto = await import("crypto");
  const generated_signature = crypto
    .createHmac("sha256", credentials.key_secret)
    .update(`${order_id}|${payment_id}`)
    .digest("hex");

  // LOW-06: Pad to same length before timingSafeEqual to avoid timing leak on length
  const genBuf = Buffer.from(generated_signature, "hex");
  const sigBuf = Buffer.from(signature, "hex");

  if (genBuf.length !== sigBuf.length) {
    // Compare against expected to prevent timing info on length mismatch
    crypto.timingSafeEqual(genBuf, genBuf);
    return false;
  }

  return crypto.timingSafeEqual(genBuf, sigBuf);
}

export interface CreatePaymentInput {
  member_id: string;
  subscription_id?: string | null;
  church_id?: string | null;
  amount: number;
  payment_method?: string | null;
  transaction_id?: string | null;
  payment_status: string;
  payment_date: string;
  receipt_number?: string | null;
  receipt_generated_at?: string | null;
  fund_name?: string | null;
}

export async function storePayment(input: CreatePaymentInput) {
  // Idempotency: if a payment with the same transaction_id + subscription_id already exists, return it.
  // For multi-subscription payments the same razorpay_payment_id is used across subscriptions,
  // so subscription_id is part of the key to avoid blocking the 2nd+ payment.
  if (input.transaction_id) {
    let query = db
      .from("payments")
      .select("id, receipt_number")
      .eq("transaction_id", input.transaction_id)
      .eq("member_id", input.member_id);

    if (input.subscription_id) {
      query = query.eq("subscription_id", input.subscription_id);
    } else {
      query = query.is("subscription_id", null);
    }

    const { data: existing } = await query.maybeSingle<StoredPaymentRow>();

    if (existing) {
      logger.info({ transactionId: input.transaction_id, paymentId: existing.id }, "Duplicate payment detected, returning existing record");
      return existing;
    }
  }

  const paymentDate = input.payment_date || new Date().toISOString();
  const receiptNumber =
    input.receipt_number ||
    createReceiptNumber({
      member_id: input.member_id,
      payment_date: paymentDate,
      transaction_id: input.transaction_id,
    });
  const receiptGeneratedAt = input.receipt_generated_at || new Date().toISOString();

  const payload = {
    member_id: input.member_id,
    subscription_id: input.subscription_id || null,
    church_id: input.church_id || null,
    amount: input.amount,
    payment_method: input.payment_method || null,
    transaction_id: input.transaction_id || null,
    payment_status: input.payment_status,
    payment_date: paymentDate,
    receipt_number: receiptNumber,
    receipt_generated_at: receiptGeneratedAt,
    fund_name: input.fund_name || null,
  };

  const { data, error } = await db
    .from("payments")
    .insert([payload])
    .select("id, receipt_number")
    .single<StoredPaymentRow>();

  if (error) {
    logger.error({ err: error }, "storePayment failed");
    throw error;
  }

  if (!data) {
    throw new Error("Payment stored but no row returned");
  }

  try {
    await recordSubscriptionEvent({
      member_id: input.member_id,
      subscription_id: input.subscription_id || null,
      event_type: "payment_recorded",
      status_after: input.payment_status,
      amount: Number(input.amount),
      source: "payment_gateway",
      metadata: {
        payment_method: input.payment_method || null,
        transaction_id: input.transaction_id || null,
        payment_date: paymentDate,
        receipt_number: data.receipt_number || receiptNumber,
      },
    });
  } catch (eventErr) {
    logger.warn({ err: eventErr, paymentId: data.id }, "storePayment event insert failed");
  }

  return data;
}
