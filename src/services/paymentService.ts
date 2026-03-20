import Razorpay from "razorpay";
import { supabaseAdmin } from "./supabaseClient";
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

const razorpayClients = new Map<string, Razorpay>();

function getRazorpayClient(credentials: RazorpayCredentials) {
  if (!credentials.key_id || !credentials.key_secret) {
    throw new Error("Razorpay credentials are missing for this church");
  }

  const cached = razorpayClients.get(credentials.key_id);
  if (cached) {
    return cached;
  }

  const client = new Razorpay({
    key_id: credentials.key_id,
    key_secret: credentials.key_secret,
  });

  razorpayClients.set(credentials.key_id, client);
  return client;
}

export async function createPaymentOrder(
  amount: number,
  currency = "INR",
  receipt = "church_receipt",
  credentials: RazorpayCredentials
) {
  const client = getRazorpayClient(credentials);
  const options = {
    amount: Math.round(amount * 100),
    currency,
    receipt,
    payment_capture: 1,
  };
  const order = await client.orders.create(options);
  return order;
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

  return generated_signature === signature;
}

export interface CreatePaymentInput {
  member_id: string;
  subscription_id?: string | null;
  amount: number;
  payment_method?: string | null;
  transaction_id?: string | null;
  payment_status: string;
  payment_date: string;
  receipt_number?: string | null;
  receipt_generated_at?: string | null;
}

function isMissingReceiptMetadataColumnError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  const normalized = message.toLowerCase();
  return (
    (normalized.includes("receipt_number") && normalized.includes("does not exist")) ||
    (normalized.includes("receipt_generated_at") && normalized.includes("does not exist"))
  );
}

export async function storePayment(input: CreatePaymentInput) {
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
    amount: input.amount,
    payment_method: input.payment_method || null,
    transaction_id: input.transaction_id || null,
    payment_status: input.payment_status,
    payment_date: paymentDate,
    receipt_number: receiptNumber,
    receipt_generated_at: receiptGeneratedAt,
  };

  const { data, error } = await supabaseAdmin
    .from("payments")
    .insert([payload])
    .select("id, receipt_number")
    .single<StoredPaymentRow>();

  if (error && isMissingReceiptMetadataColumnError(error)) {
    const legacyPayload = {
      member_id: input.member_id,
      subscription_id: input.subscription_id || null,
      amount: input.amount,
      payment_method: input.payment_method || null,
      transaction_id: input.transaction_id || null,
      payment_status: input.payment_status,
      payment_date: paymentDate,
    };

    const { data: legacyData, error: legacyError } = await supabaseAdmin
      .from("payments")
      .insert([legacyPayload])
      .select("id")
      .single<{ id: string }>();

    if (legacyError) {
      logger.error({ err: legacyError }, "storePayment failed (legacy fallback)");
      throw legacyError;
    }

    if (!legacyData) {
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
          receipt_number: receiptNumber,
        },
      });
    } catch (eventErr) {
      logger.warn({ err: eventErr, paymentId: legacyData.id }, "storePayment event insert failed");
    }

    return {
      id: legacyData.id,
      receipt_number: null,
    } as StoredPaymentRow;
  }

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
