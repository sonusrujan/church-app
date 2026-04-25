import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { computeNextDueDate, isDueSubscription } from "../utils/subscriptionHelpers";
import { normalizeIndianPhone } from "../utils/phone";

import {
  listMemberSubscriptionEvents,
  recordSubscriptionEvent,
  type SubscriptionEventRow,
} from "./subscriptionTrackingService";
import { createSubscription } from "./subscriptionService";
import { buildPaymentReceiptDownloadPath } from "./receiptService";
import { getChurchSubscription, getChurchSaaSSettings } from "./churchSubscriptionService";

export interface SyncUserProfileInput {
  id: string;
  email: string;
  phone_number?: string;
  full_name?: string;
  church_id?: string;
  avatar_url?: string;
  role: "admin" | "member";
}

export interface UpdateUserProfileInput {
  id: string;
  email: string;
  auth_phone?: string;
  phone_number?: string;
  full_name?: string;
  avatar_url?: string;
  address?: string;
  alt_phone_number?: string;
  subscription_amount?: number;
  preferred_language?: string;
  dark_mode?: boolean;
  gender?: string;
  dob?: string;
}

export interface AddFamilyMemberInput {
  email: string;
  full_name: string;
  gender?: string;
  relation?: string;
  age?: number;
  dob?: string;
  add_subscription?: boolean;
  subscription_amount?: number;
  billing_cycle?: "monthly" | "yearly";
}

export interface UserProfileRow {
  id: string;
  auth_user_id: string | null;
  email: string;
  phone_number: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  church_id: string | null;
}

interface ChurchRow {
  id: string;
  church_code: string | null;
  name: string;
  address: string | null;
  location: string | null;
  contact_phone: string | null;
  created_at: string;
}

interface MemberRow {
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
}

interface SubscriptionRow {
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
}

interface FamilyMemberRow {
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
}

interface DueSubscriptionRow {
  subscription_id: string;
  family_member_id: string | null;
  person_name: string;
  amount: number;
  billing_cycle: string;
  next_payment_date: string;
  status: string;
}

interface PaymentRow {
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
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toAmount(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function deriveSubscriptionStatus(subscriptions: SubscriptionRow[]) {
  if (!subscriptions.length) {
    return "unsubscribed";
  }

  const latest = subscriptions[0];
  const normalizedStatus = (latest.status || "unknown").toLowerCase();
  if (normalizedStatus !== "active") {
    return normalizedStatus;
  }

  const dueDate = new Date(latest.next_payment_date);
  if (!Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now()) {
    return "overdue";
  }

  return normalizedStatus;
}

// Removed local isSubscriptionDue — use isDueSubscription from subscriptionHelpers

async function listMemberSubscriptions(memberId: string | null | undefined) {
  if (!memberId) {
    return { data: [] as SubscriptionRow[], error: null as any };
  }

  // Direct subscriptions
  const result = await db
    .from("subscriptions")
    .select(
      "id, member_id, family_member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status"
    )
    .eq("member_id", memberId)
    .order("start_date", { ascending: false });

  const directSubs = (result.data || []) as SubscriptionRow[];

  // Also check if this member is a linked family member and include those subscriptions
  const { data: familyLink } = await db
    .from("family_members")
    .select("id, member_id")
    .eq("linked_to_member_id", memberId)
    .maybeSingle<{ id: string; member_id: string }>();

  if (familyLink) {
    const { data: familySubs } = await db
      .from("subscriptions")
      .select(
        "id, member_id, family_member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status"
      )
      .eq("family_member_id", familyLink.id);

    if (familySubs?.length) {
      const existingIds = new Set(directSubs.map((s) => s.id));
      for (const fs of familySubs) {
        if (!existingIds.has(fs.id)) {
          directSubs.push(fs as SubscriptionRow);
        }
      }
    }
  }

  return {
    data: directSubs,
    error: result.error,
  };
}

async function listMemberPayments(memberId: string | null | undefined) {
  if (!memberId) {
    return { data: [] as PaymentRow[], error: null as any };
  }

  // 1. Direct payments for this member
  const result = await db
    .from("payments")
    .select(
      "id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date, receipt_number, payment_category"
    )
    .eq("member_id", memberId)
    .order("payment_date", { ascending: false });

  const directPayments = (result.data || []) as Array<Omit<PaymentRow, "receipt_download_path">>;
  const seenIds = new Set(directPayments.map((p) => p.id));

  // 2. Payments linked to subscriptions owned by this member (family member payments)
  //    These are payments where subscription.member_id = this member (the head)
  //    but payment.member_id may be a different member (the family member).
  const { data: ownedSubs } = await db
    .from("subscriptions")
    .select("id")
    .eq("member_id", memberId)
    .not("family_member_id", "is", null);

  if (ownedSubs?.length) {
    const subIds = ownedSubs.map((s: any) => s.id);
    const { data: familyPayments } = await db
      .from("payments")
      .select(
        "id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date, receipt_number, payment_category"
      )
      .in("subscription_id", subIds)
      .order("payment_date", { ascending: false });

    for (const fp of familyPayments || []) {
      if (!seenIds.has(fp.id)) {
        directPayments.push(fp as any);
        seenIds.add(fp.id);
      }
    }
  }

  // 3. Also check payments where member is a family member of this head
  //    (payments recorded directly against a linked family member's member_id)
  const { data: familyMembers } = await db
    .from("family_members")
    .select("linked_to_member_id")
    .eq("member_id", memberId)
    .not("linked_to_member_id", "is", null);

  if (familyMembers?.length) {
    const linkedMemberIds = familyMembers
      .map((fm: any) => fm.linked_to_member_id)
      .filter(Boolean) as string[];

    if (linkedMemberIds.length) {
      const { data: linkedPayments } = await db
        .from("payments")
        .select(
          "id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date, receipt_number, payment_category"
        )
        .in("member_id", linkedMemberIds)
        .order("payment_date", { ascending: false });

      for (const lp of linkedPayments || []) {
        if (!seenIds.has(lp.id)) {
          directPayments.push(lp as any);
          seenIds.add(lp.id);
        }
      }
    }
  }

  // 4. Payments for subscriptions where this member IS a dependent (family member)
  //    e.g. head paid for this member's family subscription
  const { data: asDependentLinks } = await db
    .from("family_members")
    .select("id")
    .eq("linked_to_member_id", memberId);

  if (asDependentLinks?.length) {
    const fmIds = asDependentLinks.map((fm: any) => fm.id) as string[];
    const { data: depSubs } = await db
      .from("subscriptions")
      .select("id")
      .in("family_member_id", fmIds);

    if (depSubs?.length) {
      const depSubIds = depSubs.map((s: any) => s.id) as string[];
      const { data: depPayments } = await db
        .from("payments")
        .select(
          "id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date, receipt_number, payment_category"
        )
        .in("subscription_id", depSubIds)
        .order("payment_date", { ascending: false });

      for (const dp of depPayments || []) {
        if (!seenIds.has(dp.id)) {
          directPayments.push(dp as any);
          seenIds.add(dp.id);
        }
      }
    }
  }

  // Sort all combined payments by date descending
  directPayments.sort((a, b) =>
    new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
  );

  const normalized = directPayments.map((row) => ({
    ...row,
    receipt_download_path: buildPaymentReceiptDownloadPath(row.id),
  }));

  return {
    data: normalized,
    error: result.error,
  };
}

export async function getRegisteredUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const { data, error } = await db
    .from("users")
    .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
    .ilike("email", normalizedEmail)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    logger.error({ err: error, email: normalizedEmail }, "getRegisteredUserByEmail failed");
    throw error;
  }

  return (data?.[0] as UserProfileRow | undefined) || null;
}

export async function getRegisteredUserByPhone(phone: string) {
  if (!phone) return null;
  const normalized = normalizeIndianPhone(phone);
  if (!normalized) return null;
  const { data, error } = await db
    .from("users")
    .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
    .eq("phone_number", normalized)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    logger.error({ err: error, phone }, "getRegisteredUserByPhone failed");
    throw error;
  }

  return (data?.[0] as UserProfileRow | undefined) || null;
}

export async function getRegisteredUserContext(authUserId: string, authEmail: string, authPhone?: string) {
  const { data: byAuthIdRows, error: byAuthIdError } = await db
    .from("users")
    .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
    .eq("auth_user_id", authUserId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (byAuthIdError) {
    logger.error(
      { err: byAuthIdError, authUserId },
      "getRegisteredUserContext by auth_user_id failed"
    );
    throw byAuthIdError;
  }

  const byAuthId = (byAuthIdRows?.[0] as UserProfileRow | undefined) || null;

  if (byAuthId) {
    return byAuthId;
  }

  // Try phone lookup first (primary identifier for OTP auth)
  if (authPhone) {
    const byPhone = await getRegisteredUserByPhone(authPhone);
    if (byPhone) {
      if (!byPhone.auth_user_id) {
        const { data: linked, error: linkError } = await db
          .from("users")
          .update({ auth_user_id: authUserId })
          .eq("id", byPhone.id)
          .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
          .single<UserProfileRow>();

        if (linkError) {
          logger.error(
            { err: linkError, authUserId, phone: authPhone },
            "getRegisteredUserContext failed to link auth_user_id via phone"
          );
          throw linkError;
        }

        return linked;
      }
      return byPhone;
    }
  }

  // Fallback to email lookup
  const byEmail = await getRegisteredUserByEmail(authEmail);
  if (!byEmail) {
    return null;
  }

  if (!byEmail.auth_user_id) {
    const { data: linked, error: linkError } = await db
      .from("users")
      .update({ auth_user_id: authUserId })
      .eq("id", byEmail.id)
      .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
      .single<UserProfileRow>();

    if (linkError) {
      logger.error(
        { err: linkError, authUserId, email: authEmail },
        "getRegisteredUserContext failed to link auth_user_id"
      );
      throw linkError;
    }

    return linked;
  }

  return byEmail;
}

export async function syncUserProfile(input: SyncUserProfileInput) {
  const existing = await getRegisteredUserContext(input.id, input.email, input.phone_number);
  if (!existing) {
    throw new Error("This account is not registered");
  }

  const payload: Record<string, unknown> = {
    email: normalizeEmail(input.email),
    full_name: input.full_name || existing.full_name || null,
    avatar_url: input.avatar_url !== undefined ? input.avatar_url : existing.avatar_url,
    role: existing.role === "admin" ? "admin" : input.role,
    church_id: input.church_id || existing.church_id || null,
  };
  if (input.phone_number && !existing.phone_number) {
    payload.phone_number = input.phone_number;
  }

  const { data, error } = await db
    .from("users")
    .update(payload)
    .eq("id", existing.id)
    .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
    .single<UserProfileRow>();

  if (error) {
    logger.error({ err: error, userId: input.id }, "syncUserProfile update failed");
    throw error;
  }

  const authResult = await db.auth.admin.getUserById(input.id);
  if (!authResult.error && authResult.data?.user) {
    const currentMeta = authResult.data.user.user_metadata || {};
    const { error: updateError } = await db.auth.admin.updateUserById(input.id, {
      user_metadata: {
        ...currentMeta,
        role: data.role,
        church_id: payload.church_id || "",
      },
    });

    if (updateError) {
      logger.warn({ err: updateError, userId: input.id }, "syncUserProfile metadata sync failed");
    }
  }

  return data;
}

export async function getUserProfileById(userId: string) {
  const { data, error } = await db
    .from("users")
    .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, userId }, "getUserProfileById failed");
    throw error;
  }

  return data;
}

export async function getMemberDashboardByEmail(email: string, phone?: string) {
  let profile = await getRegisteredUserByEmail(email);
  if (!profile && phone) {
    profile = await getRegisteredUserByPhone(phone);
  }
  if (!profile) {
    return null;
  }

  const churchPromise = profile.church_id
    ? db
        .from("churches")
        .select("id, church_code, name, address, location, contact_phone, logo_url, created_at")
        .eq("id", profile.church_id)
        .maybeSingle<ChurchRow>()
    : Promise.resolve({ data: null, error: null } as { data: ChurchRow | null; error: any });

  const byUserMember = await db
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at, gender, dob"
    )
    .eq("user_id", profile.id)
    .maybeSingle<MemberRow>();

  if (byUserMember.error) {
    logger.error({ err: byUserMember.error, userId: profile.id }, "dashboard member by user_id failed");
    throw byUserMember.error;
  }

  let member = byUserMember.data;
  if (!member) {
    const byEmailMember = await db
      .from("members")
      .select(
        "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at, gender, dob"
      )
      .ilike("email", profile.email)
      .maybeSingle<MemberRow>();

    if (byEmailMember.error) {
      logger.error(
        { err: byEmailMember.error, email: profile.email },
        "dashboard member by email failed"
      );
      throw byEmailMember.error;
    }

    member = byEmailMember.data;
  }

  // Step 3: Try phone lookup on members table
  if (!member && phone) {
    const normalizedPhone = normalizeIndianPhone(phone);
    if (normalizedPhone) {
      const { data: byPhoneMember } = await db
        .from("members")
        .select(
          "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at, gender, dob"
        )
        .eq("phone_number", normalizedPhone)
        .maybeSingle<MemberRow>();

      if (byPhoneMember) {
        member = byPhoneMember;
        // Link the member to this user if not already linked
        if (!byPhoneMember.user_id && profile) {
          await db.from("members").update({ user_id: profile.id }).eq("id", byPhoneMember.id);
          member = { ...byPhoneMember, user_id: profile.id };
        }
      }
    }
  }

  // Sync user profile FROM member data when user is missing church_id or full_name
  if (member) {
    const profileUpdates: Record<string, any> = {};
    if (!profile.church_id && member.church_id) {
      profileUpdates.church_id = member.church_id;
    }
    if (!profile.full_name && member.full_name) {
      profileUpdates.full_name = member.full_name;
    }
    if ((!profile.email || profile.email === "") && member.email) {
      profileUpdates.email = member.email;
    }
    if ((!profile.phone_number || profile.phone_number === "") && member.phone_number) {
      profileUpdates.phone_number = member.phone_number;
    }
    if (Object.keys(profileUpdates).length > 0) {
      const { data: updatedProfile } = await db
        .from("users")
        .update(profileUpdates)
        .eq("id", profile.id)
        .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
        .single<UserProfileRow>();
      if (updatedProfile) {
        profile = updatedProfile;
        logger.info({ userId: updatedProfile.id, updates: Object.keys(profileUpdates) }, "Synced user profile from member data");
      }
    }
  }

  // profile is guaranteed non-null at this point (we returned early if it was null)
  // Re-assert after possible reassignment for TypeScript narrowing
  if (!profile) return null;

  // Re-resolve church now that profile.church_id may have been updated
  const churchPromiseFinal = profile.church_id
    ? db
        .from("churches")
        .select("id, church_code, name, address, location, contact_phone, logo_url, created_at")
        .eq("id", profile.church_id)
        .maybeSingle<ChurchRow>()
    : Promise.resolve({ data: null, error: null } as { data: ChurchRow | null; error: any });

  // Sync member church_id if it drifted from the user's profile
  if (member && profile.church_id && member.church_id !== profile.church_id) {
    const { data: updatedMember, error: syncErr } = await db
      .from("members")
      .update({ church_id: profile.church_id })
      .eq("id", member.id)
      .select(
        "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at, gender, dob"
      )
      .single<MemberRow>();
    if (syncErr) {
      logger.warn({ err: syncErr, memberId: member.id }, "member church_id sync failed");
    } else if (updatedMember) {
      member = updatedMember;
    }
  }

  // No member record found — do NOT auto-create one.
  // Only pre-registered members (added by admin) should have member records.
  if (!member) {
    logger.warn({ userId: profile.id, phone, email: profile.email }, "User has no member record — returning null dashboard");
    return null;
  }

  const [{ data: church, error: churchError }, subscriptionsResult, paymentsResult, subscriptionEvents, familyMembersResult] = await Promise.all([
    churchPromiseFinal,
    listMemberSubscriptions(member?.id),
    listMemberPayments(member?.id),
    member ? listMemberSubscriptionEvents(member.id, 30) : Promise.resolve([] as SubscriptionEventRow[]),
    member
      ? db
          .from("family_members")
          .select("id, member_id, full_name, gender, relation, age, dob, has_subscription, linked_to_member_id, created_at")
          .eq("member_id", member.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null } as { data: FamilyMemberRow[]; error: any }),
  ]);

  const _warnings: string[] = [];

  // Dashboard is read-only — no auto-subscription creation.
  // Subscriptions are created explicitly via admin pre-register or profile save.
  let subscriptions_data = subscriptionsResult.data || [];

  // Self-heal: fix subscriptions wrongly marked "active" that were never paid
  if (member && !subscriptionsResult.error && !paymentsResult.error) {
    const payments = paymentsResult.data || [];
    const successfulPaymentSubIds = new Set(
      payments
        .filter((p) => (p.payment_status || "").toLowerCase() === "success" && p.subscription_id)
        .map((p) => p.subscription_id)
    );
    const wronglyActive = subscriptions_data.filter(
      (s) => s.status === "active" && !successfulPaymentSubIds.has(s.id)
    );
    if (wronglyActive.length > 0) {
      const wrongIds = wronglyActive.map((s) => s.id);
      const { data: updated } = await db
        .from("subscriptions")
        .update({ status: "overdue" })
        .in("id", wrongIds)
        .eq("status", "active")
        .select("id");
      const updatedIds = new Set((updated || []).map((u: any) => u.id));
      for (const sub of wronglyActive) {
        if (updatedIds.has(sub.id)) {
          sub.status = "overdue";
          logger.info({ subscriptionId: sub.id, memberId: member.id }, "Self-healed wrongly active subscription to overdue");
        }
      }
    }

    // Self-heal: advance next_payment_date for active subscriptions that were paid but still have a past due date
    const now = new Date();
    const paidButPastDue = subscriptions_data.filter(
      (s) =>
        s.status === "active" &&
        successfulPaymentSubIds.has(s.id) &&
        new Date(s.next_payment_date).getTime() <= now.getTime()
    );
    for (const sub of paidButPastDue) {
      const advanced = computeNextDueDate(sub.next_payment_date, sub.billing_cycle);
      await db
        .from("subscriptions")
        .update({ next_payment_date: advanced })
        .eq("id", sub.id);
      sub.next_payment_date = advanced;
      logger.info({ subscriptionId: sub.id, memberId: member.id, newDate: advanced }, "Self-healed past-due active subscription date");
    }
  }

  if (churchError) {
    logger.error({ err: churchError, churchId: profile.church_id }, "dashboard church query failed");
    _warnings.push("Church details could not be loaded.");
  }
  if (subscriptionsResult.error) {
    logger.error({ err: subscriptionsResult.error, memberId: member?.id }, "dashboard subscriptions query failed");
    _warnings.push("Subscriptions could not be loaded.");
  }
  if (paymentsResult.error) {
    logger.error({ err: paymentsResult.error, memberId: member?.id }, "dashboard payments query failed");
    _warnings.push("Payment history could not be loaded.");
  }
  if (familyMembersResult.error) {
    logger.error({ err: familyMembersResult.error, memberId: member?.id }, "dashboard family members query failed");
    _warnings.push("Family members could not be loaded.");
  }

  const familyMembers = (familyMembersResult.data || []) as FamilyMemberRow[];
  const familyNameById = new Map<string, string>();
  for (const familyMember of familyMembers) {
    familyNameById.set(familyMember.id, familyMember.full_name);
  }

  const primaryPersonName = profile.full_name || member?.full_name || profile.email;
  const subscriptions = subscriptions_data.map((subscription) => ({
    ...subscription,
    person_name: subscription.family_member_id
      ? familyNameById.get(subscription.family_member_id) || subscription.plan_name
      : primaryPersonName,
  }));
  const receipts = (paymentsResult.data || []).map((payment) => {
    // Enrich receipts with person_name from the linked subscription (for family member payments)
    if (payment.subscription_id) {
      const linkedSub = subscriptions.find((s) => s.id === payment.subscription_id);
      if (linkedSub) {
        return { ...payment, person_name: linkedSub.person_name || primaryPersonName };
      }
    }
    // For payments whose member_id differs from the head, try to find the family member name
    if (member && payment.member_id !== member.id) {
      for (const fm of familyMembers) {
        if (fm.linked_to_member_id === payment.member_id) {
          return { ...payment, person_name: fm.full_name };
        }
      }
    }
    return { ...payment, person_name: primaryPersonName };
  });
  const trackingEvents = subscriptionEvents || [];

  const dueSubscriptions: DueSubscriptionRow[] = subscriptions
    .filter((subscription) => isDueSubscription(subscription))
    .map((subscription) => ({
      subscription_id: subscription.id,
      family_member_id: subscription.family_member_id || null,
      person_name: subscription.person_name || primaryPersonName,
      amount: toAmount(subscription.amount),
      billing_cycle: subscription.billing_cycle,
      next_payment_date: subscription.next_payment_date,
      status: subscription.status,
    }))
    .sort(
      (a, b) =>
        new Date(a.next_payment_date).getTime() -
        new Date(b.next_payment_date).getTime()
    );

  const successfulPayments = receipts.filter(
    (payment) => (payment.payment_status || "").toLowerCase() === "success"
  );
  const totalPaid = successfulPayments.reduce(
    (sum, payment) => sum + toAmount(payment.amount),
    0
  );

  const history = [
    ...subscriptions.map((subscription) => ({
      id: subscription.id,
      type: "subscription" as const,
      title: `${subscription.plan_name} (${subscription.person_name || primaryPersonName})`,
      status: subscription.status,
      amount: toAmount(subscription.amount),
      date: subscription.start_date,
    })),
    ...receipts.map((receipt) => ({
      id: receipt.id,
      type: "payment" as const,
      title: receipt.person_name && receipt.person_name !== primaryPersonName
        ? `${receipt.transaction_id || "Manual receipt"} (${receipt.person_name})`
        : receipt.transaction_id || "Manual receipt",
      status: receipt.payment_status || "unknown",
      amount: toAmount(receipt.amount),
      date: receipt.payment_date,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const currentSubscriptionStatus = deriveSubscriptionStatus(subscriptions);
  const latestSubscription = subscriptions[0] || null;

  // Fetch church SaaS subscription and settings for admins
  let churchSubscription: { amount: number | string; billing_cycle: string; status: string; next_payment_date: string | null; start_date: string | null } | null = null;
  let churchSaaSSettings: { member_subscription_enabled: boolean; church_subscription_enabled: boolean; church_subscription_amount: number; service_enabled: boolean } | null = null;
  if (profile.role === "admin" && profile.church_id) {
    try {
      const [cs, settings] = await Promise.all([
        getChurchSubscription(profile.church_id),
        getChurchSaaSSettings(profile.church_id),
      ]);
      if (cs) {
        churchSubscription = {
          amount: cs.amount,
          billing_cycle: cs.billing_cycle,
          status: cs.status,
          next_payment_date: cs.next_payment_date,
          start_date: cs.start_date,
        };
      }
      churchSaaSSettings = {
        member_subscription_enabled: settings.member_subscription_enabled,
        church_subscription_enabled: settings.church_subscription_enabled,
        church_subscription_amount: settings.church_subscription_amount,
        service_enabled: settings.service_enabled,
      };
    } catch (e) {
      logger.warn({ err: e, churchId: profile.church_id }, "Failed to fetch church SaaS data for admin dashboard");
    }
  }

  return {
    profile,
    church: church || null,
    member: member || null,
    family_members: familyMembers,
    subscriptions,
    due_subscriptions: dueSubscriptions,
    receipts,
    donations: {
      total_paid: totalPaid,
      successful_count: successfulPayments.length,
      last_payment_date: successfulPayments[0]?.payment_date || null,
    },
    history,
    tracking: {
      current_status: currentSubscriptionStatus,
      next_due_date: latestSubscription?.next_payment_date || null,
      latest_event_at: trackingEvents[0]?.event_at || null,
      events: trackingEvents,
    },
    church_subscription: churchSubscription,
    church_saas_settings: churchSaaSSettings,
    _warnings,
  };
}

export interface UpdateFamilyMemberInput {
  email: string;
  family_member_id: string;
  full_name?: string;
  gender?: string;
  relation?: string;
  age?: number;
  dob?: string;
}

export async function updateFamilyMember(input: UpdateFamilyMemberInput) {
  const dashboard = await getMemberDashboardByEmail(input.email);
  if (!dashboard?.member) {
    throw new Error("Member profile not found");
  }

  const patch: Record<string, unknown> = {};
  if (typeof input.full_name === "string" && input.full_name.trim()) {
    patch.full_name = input.full_name.trim();
  }
  if (typeof input.gender === "string") {
    patch.gender = input.gender.trim() || null;
  }
  if (typeof input.relation === "string") {
    patch.relation = input.relation.trim() || null;
  }
  if (typeof input.age === "number" && Number.isFinite(input.age)) {
    if (input.age < 0 || input.age > 150) {
      throw new Error("age must be between 0 and 150");
    }
    patch.age = Math.trunc(input.age);
  }
  if (typeof input.dob === "string") {
    const trimmedDob = input.dob.trim() || null;
    if (trimmedDob) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDob)) {
        throw new Error("dob must be a valid YYYY-MM-DD date");
      }
      if (new Date(trimmedDob) > new Date()) {
        throw new Error("dob cannot be in the future");
      }
    }
    patch.dob = trimmedDob;
  }

  if (!Object.keys(patch).length) {
    throw new Error("No fields provided to update");
  }

  const { data, error } = await db
    .from("family_members")
    .update(patch)
    .eq("id", input.family_member_id)
    .eq("member_id", dashboard.member.id)
    .select("id, member_id, full_name, gender, relation, age, dob, has_subscription, linked_to_member_id, created_at")
    .single<FamilyMemberRow>();

  if (error) {
    logger.error({ err: error, familyMemberId: input.family_member_id }, "updateFamilyMember failed");
    throw error;
  }

  return data;
}

export async function deleteFamilyMember(email: string, familyMemberId: string) {
  const dashboard = await getMemberDashboardByEmail(email);
  if (!dashboard?.member) {
    throw new Error("Member profile not found");
  }

  // Delete associated subscriptions first
  await db
    .from("subscriptions")
    .delete()
    .eq("member_id", dashboard.member.id)
    .eq("family_member_id", familyMemberId);

  const { error } = await db
    .from("family_members")
    .delete()
    .eq("id", familyMemberId)
    .eq("member_id", dashboard.member.id);

  if (error) {
    logger.error({ err: error, familyMemberId }, "deleteFamilyMember failed");
    throw error;
  }

  return { success: true };
}

export async function addFamilyMemberForCurrentUser(input: AddFamilyMemberInput) {
  const dashboard = await getMemberDashboardByEmail(input.email);
  if (!dashboard?.member) {
    throw new Error("Member profile not found");
  }

  const fullName = input.full_name.trim();
  if (!fullName) {
    throw new Error("full_name is required");
  }

  const age =
    typeof input.age === "number" && Number.isFinite(input.age)
      ? Math.trunc(input.age)
      : null;
  if (age !== null && (age < 0 || age > 120)) {
    throw new Error("age must be between 0 and 120");
  }

  const normalizedDob = typeof input.dob === "string" && input.dob.trim() ? input.dob.trim() : null;
  if (normalizedDob) {
    const dobDate = new Date(normalizedDob);
    if (Number.isNaN(dobDate.getTime())) {
      throw new Error("dob must be a valid date");
    }
  }

  const wantsSubscription = Boolean(input.add_subscription);
  const billingCycle = input.billing_cycle === "yearly" ? "yearly" : "monthly";
  let resolvedSubscriptionAmount: number | null = null;
  if (wantsSubscription) {
    const fallbackAmount = Number(dashboard.member.subscription_amount ?? 0);
    const candidateAmount =
      typeof input.subscription_amount === "number" && Number.isFinite(input.subscription_amount)
        ? input.subscription_amount
        : fallbackAmount;

    if (!Number.isFinite(candidateAmount) || candidateAmount <= 0) {
      throw new Error("subscription_amount must be greater than 0");
    }

    resolvedSubscriptionAmount = candidateAmount;
  }

  const { data: familyMember, error: familyMemberError } = await db
    .from("family_members")
    .insert([
      {
        member_id: dashboard.member.id,
        full_name: fullName,
        gender: typeof input.gender === "string" ? input.gender.trim() || null : null,
        relation: typeof input.relation === "string" ? input.relation.trim() || null : null,
        age,
        dob: normalizedDob,
        has_subscription: wantsSubscription,
      },
    ])
    .select("id, member_id, full_name, gender, relation, age, dob, has_subscription, linked_to_member_id, created_at")
    .single<FamilyMemberRow>();

  if (familyMemberError) {
    logger.error({ err: familyMemberError, email: input.email }, "addFamilyMemberForCurrentUser insert failed");
    throw familyMemberError;
  }

  let subscription: SubscriptionRow | null = null;
  if (wantsSubscription) {
    // Church subscriptions always start on the 5th of the month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const startDate = now.getDate() <= 5
      ? new Date(year, month, 5)
      : new Date(year, month + 1, 5);
    const nextDate = billingCycle === "yearly"
      ? new Date(startDate.getFullYear() + 1, startDate.getMonth(), 5)
      : new Date(startDate.getFullYear(), startDate.getMonth() + 1, 5);

    const { data: createdSubscription, error: subError } = await db
      .from("subscriptions")
      .insert([
        {
          member_id: dashboard.member.id,
          family_member_id: familyMember.id,
          plan_name: `${fullName} Individual Subscription`,
          amount: resolvedSubscriptionAmount,
          billing_cycle: billingCycle,
          start_date: startDate.toISOString().slice(0, 10),
          next_payment_date: nextDate.toISOString().slice(0, 10),
          status: "pending_first_payment",
        },
      ])
      .select(
        "id, member_id, family_member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status"
      )
      .single<SubscriptionRow>();

    if (subError) {
      logger.error(
        { err: subError, familyMemberId: familyMember.id },
        "addFamilyMemberForCurrentUser subscription insert failed"
      );
      throw subError;
    }

    subscription = {
      ...createdSubscription!,
      person_name: familyMember.full_name,
    } as any;

    try {
      await recordSubscriptionEvent({
        member_id: dashboard.member.id,
        subscription_id: createdSubscription!.id,
        event_type: "subscription_created",
        status_after: createdSubscription!.status,
        amount: Number(createdSubscription!.amount),
        source: "member",
        metadata: {
          family_member_id: familyMember.id,
          person_name: familyMember.full_name,
          billing_cycle: createdSubscription!.billing_cycle,
        },
      });
    } catch (eventErr) {
      logger.warn(
        { err: eventErr, subscriptionId: createdSubscription!.id },
        "addFamilyMemberForCurrentUser event insert failed"
      );
    }
  }

  return {
    family_member: familyMember,
    subscription,
  };
}

export async function updateCurrentUserProfile(input: UpdateUserProfileInput) {
  const existing = await getRegisteredUserContext(input.id, input.email, input.auth_phone);
  if (!existing) {
    throw new Error("This account is not registered");
  }

  if (
    typeof input.subscription_amount === "number" &&
    (!Number.isFinite(input.subscription_amount) || input.subscription_amount < 200)
  ) {
    throw new Error("Minimum monthly subscription is 200");
  }

  const userPatch: Record<string, unknown> = {};
  if (typeof input.full_name === "string") {
    userPatch.full_name = input.full_name.trim() || null;
  }
  if (typeof input.avatar_url === "string") {
    userPatch.avatar_url = input.avatar_url.trim() || null;
  }
  if (typeof input.preferred_language === "string") {
    userPatch.preferred_language = input.preferred_language;
  }
  if (typeof input.dark_mode === "boolean") {
    userPatch.dark_mode = input.dark_mode;
  }

  let profile = existing;
  if (Object.keys(userPatch).length > 0) {
    const { data: updatedProfile, error: updateProfileError } = await db
      .from("users")
      .update(userPatch)
      .eq("id", existing.id)
      .select("id, auth_user_id, email, phone_number, full_name, avatar_url, role, church_id")
      .single<UserProfileRow>();

    if (updateProfileError) {
      logger.error({ err: updateProfileError, userId: existing.id }, "updateCurrentUserProfile users update failed");
      throw updateProfileError;
    }

    profile = updatedProfile;
  }

  const { data: existingMember, error: findMemberError } = await db
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at, gender, dob"
    )
    .eq("user_id", existing.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (findMemberError) {
    logger.error({ err: findMemberError, userId: existing.id }, "updateCurrentUserProfile member lookup failed");
    throw findMemberError;
  }

  let memberRow = (existingMember?.[0] as MemberRow | undefined) || null;

  // Fallback: find member by phone or email if user_id link doesn't exist yet
  if (!memberRow && input.auth_phone) {
    const normalizedPhoneLookup = normalizeIndianPhone(input.auth_phone);
    if (normalizedPhoneLookup) {
      const { data: byPhone } = await db
        .from("members")
        .select("id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at, gender, dob")
        .eq("phone_number", normalizedPhoneLookup)
        .order("created_at", { ascending: true })
        .limit(1);
      if (byPhone?.[0]) {
        memberRow = byPhone[0] as MemberRow;
        // Link member to user
        if (!memberRow.user_id) {
          await db.from("members").update({ user_id: existing.id }).eq("id", memberRow.id);
          memberRow = { ...memberRow, user_id: existing.id };
        }
      }
    }
  }
  if (!memberRow && input.email) {
    const { data: byEmail } = await db
      .from("members")
      .select("id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at, gender, dob")
      .ilike("email", input.email)
      .order("created_at", { ascending: true })
      .limit(1);
    if (byEmail?.[0]) {
      memberRow = byEmail[0] as MemberRow;
      if (!memberRow.user_id) {
        await db.from("members").update({ user_id: existing.id }).eq("id", memberRow.id);
        memberRow = { ...memberRow, user_id: existing.id };
      }
    }
  }
  if (memberRow) {
    const memberPatch: Record<string, unknown> = {};
    let previousSubscriptionAmount: number | null = null;
    let nextSubscriptionAmount: number | null = null;

    if (typeof input.full_name === "string") {
      memberPatch.full_name = input.full_name.trim() || memberRow.full_name;
    }
    if (typeof input.address === "string") {
      memberPatch.address = input.address.trim() || null;
    }
    if (typeof input.phone_number === "string") {
      memberPatch.phone_number = input.phone_number.trim() ? normalizeIndianPhone(input.phone_number) : null;
    }
    if (typeof input.alt_phone_number === "string") {
      memberPatch.alt_phone_number = input.alt_phone_number.trim() ? normalizeIndianPhone(input.alt_phone_number) : null;
    }
    if (typeof input.gender === "string") {
      memberPatch.gender = input.gender.trim() || null;
    }
    if (typeof input.dob === "string") {
      memberPatch.dob = input.dob.trim() || null;
    }
    if (typeof input.subscription_amount === "number") {
      const currentAmount = toAmount(memberRow.subscription_amount);
      if (Math.abs(currentAmount - input.subscription_amount) > 0.0001) {
        memberPatch.subscription_amount = input.subscription_amount;
        previousSubscriptionAmount = currentAmount;
        nextSubscriptionAmount = input.subscription_amount;
      }
    }

    if (Object.keys(memberPatch).length > 0) {
      const { error: updateMemberError } = await db
        .from("members")
        .update(memberPatch)
        .eq("id", memberRow.id);

      if (updateMemberError) {
        logger.error({ err: updateMemberError, memberId: memberRow.id }, "updateCurrentUserProfile member update failed");
        throw updateMemberError;
      }
    }

    if (previousSubscriptionAmount !== null && nextSubscriptionAmount !== null) {
      try {
        await recordSubscriptionEvent({
          member_id: memberRow.id,
          event_type: "subscription_amount_updated",
          amount: nextSubscriptionAmount,
          source: "member",
          metadata: {
            previous_amount: previousSubscriptionAmount,
            updated_amount: nextSubscriptionAmount,
          },
        });
      } catch (eventErr) {
        logger.warn(
          { err: eventErr, memberId: memberRow.id },
          "updateCurrentUserProfile subscription amount event insert failed"
        );
      }
    }

    // Auto-create or update subscription when amount is set
    const effectiveAmount = nextSubscriptionAmount ?? toAmount(memberRow.subscription_amount);
    if (effectiveAmount && effectiveAmount >= 200) {
      try {
        // Use advisory-style lock check to prevent race conditions
        const { data: existingSubs } = await db
          .from("subscriptions")
          .select("id, status, amount, next_payment_date")
          .eq("member_id", memberRow.id)
          .is("family_member_id", null)
          .in("status", ["active", "overdue", "pending_first_payment"])
          .order("start_date", { ascending: false })
          .limit(1);

        if (!existingSubs || existingSubs.length === 0) {
          // No active subscription — create one starting on the 5th
          const now = new Date();
          const year = now.getFullYear();
          const month = now.getMonth();
          const startDate = now.getDate() <= 5
            ? new Date(year, month, 5)
            : new Date(year, month + 1, 5);
          await createSubscription({
            member_id: memberRow.id,
            plan_name: memberRow.full_name || input.full_name || "Monthly Subscription",
            amount: effectiveAmount,
            billing_cycle: "monthly",
            start_date: startDate.toISOString().slice(0, 10),
            next_payment_date: startDate.toISOString().slice(0, 10),
          });
          logger.info({ memberId: memberRow.id, amount: effectiveAmount }, "Created subscription from profile save");
        } else if (nextSubscriptionAmount) {
          // Existing active/overdue subscription — handle amount change only if amount was explicitly changed
          const sub = existingSubs[0] as { id: string; status: string; amount: number | string; next_payment_date: string };
          const oldAmount = Number(sub.amount);
          const newAmount = nextSubscriptionAmount;

          if (Math.abs(oldAmount - newAmount) > 0.0001) {
            const nextDue = new Date(sub.next_payment_date);
            const now = new Date();
            const alreadyPaidThisCycle = nextDue.getTime() > now.getTime() && sub.status === "active";

            if (alreadyPaidThisCycle && newAmount > oldAmount) {
              // Already paid this cycle at the old amount — create or update adjustment for the difference
              const difference = newAmount - oldAmount;
              const adjustmentDueDate = now.toISOString().slice(0, 10);

              // Consolidate: if unpaid adjustment already exists, update it instead of creating another
              const { data: existingAdj } = await db
                .from("subscriptions")
                .select("id, amount")
                .eq("member_id", memberRow.id)
                .is("family_member_id", null)
                .like("plan_name", "%Adjustment%")
                .in("status", ["overdue", "pending_first_payment"])
                .limit(1);

              if (existingAdj && existingAdj.length > 0) {
                await db.from("subscriptions")
                  .update({ amount: difference, next_payment_date: adjustmentDueDate })
                  .eq("id", existingAdj[0].id);
                logger.info({ memberId: memberRow.id, difference, adjustmentId: existingAdj[0].id }, "Updated existing adjustment subscription");
              } else {
                await db.from("subscriptions").insert([{
                  member_id: memberRow.id,
                  plan_name: `${memberRow.full_name || "Subscription"} – Adjustment`,
                  amount: difference,
                  billing_cycle: "monthly",
                  start_date: adjustmentDueDate,
                  next_payment_date: adjustmentDueDate,
                  status: "pending_first_payment",
                }]);
                logger.info({ memberId: memberRow.id, difference, subscriptionId: sub.id }, "Created adjustment subscription for amount increase");
              }
            }

            // Update the main subscription amount for future cycles
            await db
              .from("subscriptions")
              .update({ amount: newAmount })
              .eq("id", sub.id);
            logger.info({ memberId: memberRow.id, subscriptionId: sub.id, oldAmount, newAmount }, "Updated subscription amount from profile save");

            try {
              await recordSubscriptionEvent({
                member_id: memberRow.id,
                subscription_id: sub.id,
                event_type: "subscription_amount_updated",
                amount: newAmount,
                source: "member",
                metadata: {
                  previous_amount: oldAmount,
                  updated_amount: newAmount,
                  adjustment_created: alreadyPaidThisCycle && newAmount > oldAmount,
                },
              });
            } catch {
              // Non-blocking
            }
          }
        }
      } catch (subErr) {
        logger.warn({ err: subErr, memberId: memberRow.id }, "Auto-subscription creation/update failed");
      }
    }
  }

  const authResult = await db.auth.admin.getUserById(input.id);
  if (!authResult.error && authResult.data?.user) {
    const currentMeta = authResult.data.user.user_metadata || {};
    const { error: updateMetaError } = await db.auth.admin.updateUserById(input.id, {
      user_metadata: {
        ...currentMeta,
        full_name: profile.full_name || "",
        avatar_url: profile.avatar_url || "",
      },
    });

    if (updateMetaError) {
      logger.warn({ err: updateMetaError, userId: input.id }, "updateCurrentUserProfile metadata sync failed");
    }
  }

  return getMemberDashboardByEmail(input.email);
}

/**
 * Join a church by 8-digit code. Matches the authenticated user's email or
 * phone against the church's `members` table. If a match is found, creates
 * or links the `users` row and wires up the member record.
 *
 * Returns `{ user_id, church_id, church_name }` on success.
 */
export async function joinChurchByCode(
  authUserId: string,
  authEmail: string,
  authPhone: string | undefined,
  churchCode: string,
): Promise<{ user_id: string; church_id: string; church_name: string }> {
  // 1. Resolve church code → church
  const { data: churches, error: churchErr } = await db
    .from("churches")
    .select("id, name")
    .eq("church_code", churchCode)
    .limit(1);

  if (churchErr) {
    logger.error({ err: churchErr, churchCode }, "joinChurchByCode: church lookup failed");
    throw churchErr;
  }

  const church = churches?.[0] as { id: string; name: string } | undefined;
  if (!church) {
    throw new Error("Church not found. Please verify the 8-digit code and try again.");
  }

  // 2. Look for a member record matching email or phone in this church
  const emailLower = (authEmail || "").trim().toLowerCase();
  const phoneTrimmed = (authPhone || "").trim();

  type MemberRow = { id: string; user_id: string | null; full_name: string };
  let member: MemberRow | null = null;

  if (emailLower) {
    const { data: byEmail } = await db
      .from("members")
      .select("id, user_id, full_name")
      .eq("church_id", church.id)
      .ilike("email", emailLower)
      .is("deleted_at", null)
      .limit(1);
    member = (byEmail?.[0] as MemberRow | undefined) ?? null;
  }

  if (!member && phoneTrimmed) {
    const { data: byPhone } = await db
      .from("members")
      .select("id, user_id, full_name")
      .eq("church_id", church.id)
      .eq("phone_number", phoneTrimmed)
      .is("deleted_at", null)
      .limit(1);
    member = (byPhone?.[0] as MemberRow | undefined) ?? null;
  }

  if (!member) {
    throw new Error(
      "No matching member record found in this church. Please contact your church administrator to pre-register your account.",
    );
  }
  const matchedMember: MemberRow = member;

  // 3. Ensure a users row exists and is linked
  let userId: string;

  // Check if user already has a users row (by auth_user_id)
  const { data: existingUsers } = await db
    .from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .limit(1);

  const existingUser = existingUsers?.[0] as { id: string } | undefined;

  if (existingUser) {
    // User exists — update church_id
    await db
      .from("users")
      .update({ church_id: church.id })
      .eq("id", existingUser.id);
    userId = existingUser.id;
  } else if (matchedMember.user_id) {
    // Member already linked to a users row — set auth_user_id on it
    await db
      .from("users")
      .update({ auth_user_id: authUserId, church_id: church.id })
      .eq("id", matchedMember.user_id);
    userId = matchedMember.user_id;
  } else {
    // Create a new users row
    const { data: newUser, error: createErr } = await db
      .from("users")
      .insert({
        auth_user_id: authUserId,
        email: emailLower || authPhone || "",
        full_name: matchedMember.full_name || "",
        phone_number: phoneTrimmed || null,
        role: "member",
        church_id: church.id,
      })
      .select("id")
      .single<{ id: string }>();

    if (createErr) {
      logger.error({ err: createErr, authUserId, churchCode }, "joinChurchByCode: create user failed");
      throw new Error("Failed to create user account. Please try again.");
    }
    userId = newUser.id;
  }

  // 4. Link member record to the users row + verify
  await db
    .from("members")
    .update({ user_id: userId, verification_status: "verified" })
    .eq("id", matchedMember.id);

  return { user_id: userId, church_id: church.id, church_name: church.name };
}
