import { APP_NAME } from "../config";
import { db } from "./dbClient";
import { queueNotification } from "./notificationService";
import { sendEmail } from "./mailerService";

type PaymentSideEffectInput = {
  payment_ids: string[];
  razorpay_payment_id: string;
};

type RefundSideEffectInput = {
  payment_id: string;
  razorpay_payment_id: string;
  razorpay_refund_id: string;
  refund_amount: number;
};

type PaymentRow = {
  id: string;
  member_id: string | null;
  church_id: string | null;
  amount: number | string;
  payment_category: string | null;
};

type MemberRow = {
  user_id: string | null;
  church_id: string | null;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
};

async function getPayments(paymentIds: string[]) {
  if (!paymentIds.length) return [];
  const { data, error } = await db
    .from("payments")
    .select("id, member_id, church_id, amount, payment_category")
    .in("id", paymentIds);
  if (error) throw error;
  return (data || []) as PaymentRow[];
}

async function getMember(memberId: string) {
  const { data, error } = await db
    .from("members")
    .select("user_id, church_id, full_name, email, phone_number")
    .eq("id", memberId)
    .maybeSingle<MemberRow>();
  if (error) throw error;
  return data || null;
}

async function getChurchName(churchId: string | null | undefined) {
  if (!churchId) return "Your Church";
  const { data } = await db.from("churches").select("name").eq("id", churchId).maybeSingle<{ name: string | null }>();
  return data?.name || "Your Church";
}

export async function processPaymentCapturedSideEffects(input: PaymentSideEffectInput) {
  const payments = await getPayments(input.payment_ids);
  for (const payment of payments) {
    if (!payment.member_id) continue;
    const member = await getMember(payment.member_id);
    if (!member) continue;
    const churchId = member.church_id || payment.church_id;
    const amount = Number(payment.amount) || 0;
    const category = payment.payment_category || "subscription";

    if (member.user_id && churchId) {
      await queueNotification({
        church_id: churchId,
        recipient_user_id: member.user_id,
        channel: "push",
        notification_type: "payment_success",
        subject: "Payment Successful",
        body: `Your payment of Rs ${amount} (${category}) has been confirmed.`,
      });
    }

    if (member.email) {
      const churchName = await getChurchName(churchId);
      const memberName = member.full_name || "Member";
      await sendEmail({
        to: member.email,
        subject: `Payment Confirmation - Rs ${amount} (${category})`,
        text: `Dear ${memberName},\n\nYour payment of Rs ${amount} for ${category} at ${churchName} has been successfully processed.\n\nTransaction ID: ${input.razorpay_payment_id}\nAmount: Rs ${amount}\nCategory: ${category}\nDate: ${new Date().toLocaleDateString("en-IN")}\n\nThank you for your contribution.\n\n${churchName}`,
      });
    }
  }
}

export async function processPaymentFailedSideEffects(input: PaymentSideEffectInput) {
  const payments = await getPayments(input.payment_ids);
  for (const payment of payments) {
    if (!payment.member_id) continue;
    const member = await getMember(payment.member_id);
    if (!member) continue;
    const churchId = member.church_id || payment.church_id;
    if (!churchId) continue;
    const amount = Number(payment.amount) || 0;

    if (member.user_id) {
      await queueNotification({
        church_id: churchId,
        recipient_user_id: member.user_id,
        channel: "push",
        notification_type: "payment_failed",
        subject: "Payment Failed",
        body: `Your payment of Rs ${amount} could not be processed. Please try again.`,
        metadata: { url: "/donate" },
      });
    }

    if (member.phone_number) {
      await queueNotification({
        church_id: churchId,
        recipient_phone: member.phone_number,
        channel: "sms",
        notification_type: "payment_failed",
        body: `Your payment of Rs ${amount} failed. Please retry at your earliest convenience. - ${APP_NAME}`,
      });
    }
  }
}

export async function processRefundProcessedSideEffects(input: RefundSideEffectInput) {
  const { data: payment, error } = await db
    .from("payments")
    .select("id, member_id, church_id")
    .eq("id", input.payment_id)
    .maybeSingle<{ id: string; member_id: string | null; church_id: string | null }>();
  if (error) throw error;
  if (!payment?.member_id || !payment.church_id) return;

  const member = await getMember(payment.member_id);
  if (!member) return;
  const refundAmount = Number(input.refund_amount || 0).toFixed(2);

  if (member.user_id) {
    await queueNotification({
      church_id: payment.church_id,
      recipient_user_id: member.user_id,
      channel: "push",
      notification_type: "refund_processed",
      subject: "Refund Processed",
      body: `A refund of Rs ${refundAmount} has been processed to your original payment method.`,
    });
  }

  if (member.email) {
    await sendEmail({
      to: member.email,
      subject: `Refund Confirmation - Rs ${refundAmount}`,
      text: `Dear ${member.full_name || "Member"},\n\nA refund of Rs ${refundAmount} has been processed for your payment.\n\nRefund ID: ${input.razorpay_refund_id}\nOriginal Payment: ${input.razorpay_payment_id}\n\nThe amount should appear in your account within 5-7 business days.`,
    });
  }
}
