import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";

function toAmount(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isSameUtcDay(date: Date, reference: Date) {
  return (
    date.getUTCFullYear() === reference.getUTCFullYear() &&
    date.getUTCMonth() === reference.getUTCMonth() &&
    date.getUTCDate() === reference.getUTCDate()
  );
}

function isSameUtcMonth(date: Date, reference: Date) {
  return (
    date.getUTCFullYear() === reference.getUTCFullYear() &&
    date.getUTCMonth() === reference.getUTCMonth()
  );
}

function isSameUtcYear(date: Date, reference: Date) {
  return date.getUTCFullYear() === reference.getUTCFullYear();
}

export async function getChurchIncomeSummary(churchId: string) {
  const { data: members, error: membersError } = await supabaseAdmin
    .from("members")
    .select("id")
    .eq("church_id", churchId);

  if (membersError) {
    logger.error({ err: membersError, churchId }, "getChurchIncomeSummary members lookup failed");
    throw membersError;
  }

  const memberIds = (members || []).map((member: { id: string }) => member.id);
  if (!memberIds.length) {
    return {
      daily_income: 0,
      monthly_income: 0,
      yearly_income: 0,
      successful_payments_count: 0,
    };
  }

  const { data: payments, error: paymentsError } = await supabaseAdmin
    .from("payments")
    .select("amount, payment_date, payment_status")
    .in("member_id", memberIds)
    .order("payment_date", { ascending: false });

  if (paymentsError) {
    logger.error({ err: paymentsError, churchId }, "getChurchIncomeSummary payments lookup failed");
    throw paymentsError;
  }

  const now = new Date();
  let dailyIncome = 0;
  let monthlyIncome = 0;
  let yearlyIncome = 0;
  let successfulCount = 0;

  for (const payment of payments || []) {
    const status = String(payment.payment_status || "").toLowerCase();
    if (status !== "success") {
      continue;
    }

    successfulCount += 1;
    const amount = toAmount(payment.amount);
    const paymentDate = new Date(payment.payment_date);

    if (Number.isNaN(paymentDate.getTime())) {
      continue;
    }

    if (isSameUtcYear(paymentDate, now)) {
      yearlyIncome += amount;
    }

    if (isSameUtcMonth(paymentDate, now)) {
      monthlyIncome += amount;
    }

    if (isSameUtcDay(paymentDate, now)) {
      dailyIncome += amount;
    }
  }

  return {
    daily_income: Number(dailyIncome.toFixed(2)),
    monthly_income: Number(monthlyIncome.toFixed(2)),
    yearly_income: Number(yearlyIncome.toFixed(2)),
    successful_payments_count: successfulCount,
  };
}
