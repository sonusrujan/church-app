import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";
import { recordSubscriptionEvent } from "./subscriptionTrackingService";

interface CreatedSubscriptionRow {
  id: string;
  member_id: string;
  plan_name: string;
  amount: number | string;
  billing_cycle: string;
  start_date: string;
  next_payment_date: string;
  status: string;
}

export interface CreateSubscriptionInput {
  member_id: string;
  plan_name: string;
  amount: number;
  billing_cycle: "monthly" | "yearly";
  start_date: string;
  next_payment_date: string;
  status?: "active" | "paused" | "cancelled" | "overdue";
}

export async function createSubscription(input: CreateSubscriptionInput) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .insert([
      {
        member_id: input.member_id,
        plan_name: input.plan_name,
        amount: input.amount,
        billing_cycle: input.billing_cycle,
        start_date: input.start_date,
        next_payment_date: input.next_payment_date,
        status: input.status || "active",
      },
    ])
    .select("id, member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status")
    .single<CreatedSubscriptionRow>();

  if (error) {
    logger.error({ err: error }, "createSubscription failed");
    throw error;
  }

  if (!data) {
    throw new Error("Subscription created but no row returned");
  }

  try {
    await recordSubscriptionEvent({
      member_id: input.member_id,
      subscription_id: data.id,
      event_type: "subscription_created",
      status_after: data.status || input.status || "active",
      amount: Number(data.amount ?? input.amount),
      source: "admin",
      metadata: {
        plan_name: data.plan_name,
        billing_cycle: data.billing_cycle,
        start_date: data.start_date,
        next_payment_date: data.next_payment_date,
      },
    });
  } catch (eventErr) {
    logger.warn({ err: eventErr, subscriptionId: data.id }, "createSubscription event insert failed");
  }

  return data;
}

export async function getMemberSubscriptions(member_id: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("member_id", member_id);

  if (error) {
    logger.error({ err: error }, "getMemberSubscriptions failed");
    throw error;
  }
  return data;
}
