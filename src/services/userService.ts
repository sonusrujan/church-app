import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";
import {
  listMemberSubscriptionEvents,
  recordSubscriptionEvent,
  type SubscriptionEventRow,
} from "./subscriptionTrackingService";
import { buildPaymentReceiptDownloadPath } from "./receiptService";

export interface SyncUserProfileInput {
  id: string;
  email: string;
  full_name?: string;
  church_id?: string;
  avatar_url?: string;
  role: "admin" | "member";
}

export interface UpdateUserProfileInput {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  address?: string;
  phone_number?: string;
  alt_phone_number?: string;
  subscription_amount?: number;
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

function isSubscriptionDue(subscription: SubscriptionRow) {
  const status = (subscription.status || "").toLowerCase();
  if (status === "cancelled" || status === "paused") {
    return false;
  }
  if (status === "overdue") {
    return true;
  }

  const dueDate = new Date(subscription.next_payment_date);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  return dueDate.getTime() <= Date.now();
}

function isMissingFamilyMemberIdColumnError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes("subscriptions.family_member_id") &&
    normalized.includes("does not exist")
  );
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

async function listMemberSubscriptions(memberId: string | null | undefined) {
  if (!memberId) {
    return { data: [] as SubscriptionRow[], error: null as any };
  }

  const withFamilyColumn = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, member_id, family_member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status"
    )
    .eq("member_id", memberId)
    .order("start_date", { ascending: false });

  if (!withFamilyColumn.error) {
    return {
      data: (withFamilyColumn.data || []) as SubscriptionRow[],
      error: null as any,
    };
  }

  if (!isMissingFamilyMemberIdColumnError(withFamilyColumn.error)) {
    return { data: [] as SubscriptionRow[], error: withFamilyColumn.error };
  }

  const withoutFamilyColumn = await supabaseAdmin
    .from("subscriptions")
    .select("id, member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status")
    .eq("member_id", memberId)
    .order("start_date", { ascending: false });

  if (withoutFamilyColumn.error) {
    return { data: [] as SubscriptionRow[], error: withoutFamilyColumn.error };
  }

  const normalized = (withoutFamilyColumn.data || []).map((row) => ({
    ...(row as Omit<SubscriptionRow, "family_member_id">),
    family_member_id: null,
  })) as SubscriptionRow[];

  return { data: normalized, error: null as any };
}

async function listMemberPayments(memberId: string | null | undefined) {
  if (!memberId) {
    return { data: [] as PaymentRow[], error: null as any };
  }

  const withReceiptColumns = await supabaseAdmin
    .from("payments")
    .select(
      "id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date, receipt_number"
    )
    .eq("member_id", memberId)
    .order("payment_date", { ascending: false });

  if (!withReceiptColumns.error) {
    const normalized = ((withReceiptColumns.data || []) as Array<Omit<PaymentRow, "receipt_download_path">>).map(
      (row) => ({
        ...row,
        receipt_download_path: buildPaymentReceiptDownloadPath(row.id),
      })
    );

    return {
      data: normalized,
      error: null as any,
    };
  }

  if (!isMissingReceiptMetadataColumnError(withReceiptColumns.error)) {
    return { data: [] as PaymentRow[], error: withReceiptColumns.error };
  }

  const legacyPayments = await supabaseAdmin
    .from("payments")
    .select(
      "id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date"
    )
    .eq("member_id", memberId)
    .order("payment_date", { ascending: false });

  if (legacyPayments.error) {
    return { data: [] as PaymentRow[], error: legacyPayments.error };
  }

  const normalized = (legacyPayments.data || []).map((row) => {
    const payment = row as Omit<PaymentRow, "receipt_number" | "receipt_download_path">;
    return {
      ...payment,
      receipt_number: null,
      receipt_download_path: buildPaymentReceiptDownloadPath(payment.id),
    };
  }) as PaymentRow[];

  return {
    data: normalized,
    error: null as any,
  };
}

export async function getRegisteredUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, auth_user_id, email, full_name, avatar_url, role, church_id")
    .ilike("email", normalizedEmail)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    logger.error({ err: error, email: normalizedEmail }, "getRegisteredUserByEmail failed");
    throw error;
  }

  return (data?.[0] as UserProfileRow | undefined) || null;
}

export async function getRegisteredUserContext(authUserId: string, authEmail: string) {
  const { data: byAuthIdRows, error: byAuthIdError } = await supabaseAdmin
    .from("users")
    .select("id, auth_user_id, email, full_name, avatar_url, role, church_id")
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

  const byEmail = await getRegisteredUserByEmail(authEmail);
  if (!byEmail) {
    return null;
  }

  if (!byEmail.auth_user_id) {
    const { data: linked, error: linkError } = await supabaseAdmin
      .from("users")
      .update({ auth_user_id: authUserId })
      .eq("id", byEmail.id)
      .select("id, auth_user_id, email, full_name, avatar_url, role, church_id")
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
  const existing = await getRegisteredUserContext(input.id, input.email);
  if (!existing) {
    throw new Error("This email is not registered");
  }

  const payload = {
    email: normalizeEmail(input.email),
    full_name: input.full_name || existing.full_name || null,
    avatar_url: input.avatar_url !== undefined ? input.avatar_url : existing.avatar_url,
    role: existing.role === "admin" ? "admin" : input.role,
    church_id: input.church_id || existing.church_id || null,
  };

  const { data, error } = await supabaseAdmin
    .from("users")
    .update(payload)
    .eq("id", existing.id)
    .select("id, auth_user_id, email, full_name, avatar_url, role, church_id")
    .single<UserProfileRow>();

  if (error) {
    logger.error({ err: error, userId: input.id }, "syncUserProfile update failed");
    throw error;
  }

  const authResult = await supabaseAdmin.auth.admin.getUserById(input.id);
  if (!authResult.error && authResult.data?.user) {
    const currentMeta = authResult.data.user.user_metadata || {};
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(input.id, {
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
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, auth_user_id, email, full_name, avatar_url, role, church_id")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, userId }, "getUserProfileById failed");
    throw error;
  }

  return data;
}

export async function getMemberDashboardByEmail(email: string) {
  const profile = await getRegisteredUserByEmail(email);
  if (!profile) {
    return null;
  }

  const churchPromise = profile.church_id
    ? supabaseAdmin
        .from("churches")
        .select("id, church_code, name, address, location, contact_phone, created_at")
        .eq("id", profile.church_id)
        .maybeSingle<ChurchRow>()
    : Promise.resolve({ data: null, error: null } as { data: ChurchRow | null; error: any });

  const byUserMember = await supabaseAdmin
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at"
    )
    .eq("user_id", profile.id)
    .maybeSingle<MemberRow>();

  if (byUserMember.error) {
    logger.error({ err: byUserMember.error, userId: profile.id }, "dashboard member by user_id failed");
    throw byUserMember.error;
  }

  let member = byUserMember.data;
  if (!member) {
    const byEmailMember = await supabaseAdmin
      .from("members")
      .select(
        "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at"
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

  if (!member && profile.church_id) {
    const { data: createdMember, error: createMemberError } = await supabaseAdmin
      .from("members")
      .insert([
        {
          user_id: profile.id,
          full_name: profile.full_name || profile.email,
          email: profile.email,
          phone_number: null,
          alt_phone_number: null,
          church_id: profile.church_id || null,
          verification_status: "pending",
        },
      ])
      .select(
        "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at"
      )
      .single<MemberRow>();

    if (createMemberError) {
      logger.error(
        { err: createMemberError, email: profile.email, userId: profile.id },
        "dashboard member auto-create failed"
      );
      throw createMemberError;
    }

    member = createdMember;
  }

  const [{ data: church, error: churchError }, subscriptionsResult, paymentsResult, subscriptionEvents, familyMembersResult] = await Promise.all([
    churchPromise,
    listMemberSubscriptions(member?.id),
    listMemberPayments(member?.id),
    member ? listMemberSubscriptionEvents(member.id, 30) : Promise.resolve([] as SubscriptionEventRow[]),
    member
      ? supabaseAdmin
          .from("family_members")
          .select("id, member_id, full_name, gender, relation, age, dob, has_subscription, created_at")
          .eq("member_id", member.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null } as { data: FamilyMemberRow[]; error: any }),
  ]);

  if (churchError) {
    logger.error({ err: churchError, churchId: profile.church_id }, "dashboard church query failed");
    throw churchError;
  }
  if (subscriptionsResult.error) {
    logger.error({ err: subscriptionsResult.error, memberId: member?.id }, "dashboard subscriptions query failed");
    throw subscriptionsResult.error;
  }
  if (paymentsResult.error) {
    logger.error({ err: paymentsResult.error, memberId: member?.id }, "dashboard payments query failed");
    throw paymentsResult.error;
  }
  if (familyMembersResult.error) {
    logger.error({ err: familyMembersResult.error, memberId: member?.id }, "dashboard family members query failed");
    throw familyMembersResult.error;
  }

  const familyMembers = (familyMembersResult.data || []) as FamilyMemberRow[];
  const familyNameById = new Map<string, string>();
  for (const familyMember of familyMembers) {
    familyNameById.set(familyMember.id, familyMember.full_name);
  }

  const primaryPersonName = profile.full_name || member?.full_name || profile.email;
  const subscriptions = (subscriptionsResult.data || []).map((subscription) => ({
    ...subscription,
    person_name: subscription.family_member_id
      ? familyNameById.get(subscription.family_member_id) || subscription.plan_name
      : primaryPersonName,
  }));
  const receipts = paymentsResult.data || [];
  const trackingEvents = subscriptionEvents || [];

  const dueSubscriptions: DueSubscriptionRow[] = subscriptions
    .filter((subscription) => isSubscriptionDue(subscription))
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
      title: receipt.transaction_id || "Manual receipt",
      status: receipt.payment_status || "unknown",
      amount: toAmount(receipt.amount),
      date: receipt.payment_date,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const currentSubscriptionStatus = deriveSubscriptionStatus(subscriptions);
  const latestSubscription = subscriptions[0] || null;

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
  };
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

  const { data: familyMember, error: familyMemberError } = await supabaseAdmin
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
    .select("id, member_id, full_name, gender, relation, age, dob, has_subscription, created_at")
    .single<FamilyMemberRow>();

  if (familyMemberError) {
    logger.error({ err: familyMemberError, email: input.email }, "addFamilyMemberForCurrentUser insert failed");
    throw familyMemberError;
  }

  let subscription: SubscriptionRow | null = null;
  if (wantsSubscription) {
    const startDate = new Date();
    const nextDate = new Date(startDate);
    if (billingCycle === "yearly") {
      nextDate.setFullYear(nextDate.getFullYear() + 1);
    } else {
      nextDate.setMonth(nextDate.getMonth() + 1);
    }

    const createdWithFamilyColumn = await supabaseAdmin
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
          status: "active",
        },
      ])
      .select(
        "id, member_id, family_member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status"
      )
      .single<SubscriptionRow>();

    let createdSubscription: SubscriptionRow | null = null;
    if (!createdWithFamilyColumn.error) {
      createdSubscription = createdWithFamilyColumn.data;
    } else if (isMissingFamilyMemberIdColumnError(createdWithFamilyColumn.error)) {
      const createdWithoutFamilyColumn = await supabaseAdmin
        .from("subscriptions")
        .insert([
          {
            member_id: dashboard.member.id,
            plan_name: `${fullName} Individual Subscription`,
            amount: resolvedSubscriptionAmount,
            billing_cycle: billingCycle,
            start_date: startDate.toISOString().slice(0, 10),
            next_payment_date: nextDate.toISOString().slice(0, 10),
            status: "active",
          },
        ])
        .select("id, member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status")
        .single<Omit<SubscriptionRow, "family_member_id">>();

      if (createdWithoutFamilyColumn.error) {
        logger.error(
          { err: createdWithoutFamilyColumn.error, familyMemberId: familyMember.id },
          "addFamilyMemberForCurrentUser subscription insert fallback failed"
        );
        throw createdWithoutFamilyColumn.error;
      }

      createdSubscription = {
        ...createdWithoutFamilyColumn.data,
        family_member_id: null,
      } as SubscriptionRow;
    } else {
      logger.error(
        { err: createdWithFamilyColumn.error, familyMemberId: familyMember.id },
        "addFamilyMemberForCurrentUser subscription insert failed"
      );
      throw createdWithFamilyColumn.error;
    }

    subscription = {
      ...createdSubscription,
      person_name: familyMember.full_name,
    };

    try {
      await recordSubscriptionEvent({
        member_id: dashboard.member.id,
        subscription_id: createdSubscription.id,
        event_type: "subscription_created",
        status_after: createdSubscription.status,
        amount: Number(createdSubscription.amount),
        source: "member",
        metadata: {
          family_member_id: familyMember.id,
          person_name: familyMember.full_name,
          billing_cycle: createdSubscription.billing_cycle,
        },
      });
    } catch (eventErr) {
      logger.warn(
        { err: eventErr, subscriptionId: createdSubscription.id },
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
  const existing = await getRegisteredUserContext(input.id, input.email);
  if (!existing) {
    throw new Error("This email is not registered");
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

  let profile = existing;
  if (Object.keys(userPatch).length > 0) {
    const { data: updatedProfile, error: updateProfileError } = await supabaseAdmin
      .from("users")
      .update(userPatch)
      .eq("id", existing.id)
      .select("id, auth_user_id, email, full_name, avatar_url, role, church_id")
      .single<UserProfileRow>();

    if (updateProfileError) {
      logger.error({ err: updateProfileError, userId: existing.id }, "updateCurrentUserProfile users update failed");
      throw updateProfileError;
    }

    profile = updatedProfile;
  }

  const { data: existingMember, error: findMemberError } = await supabaseAdmin
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, church_id, created_at"
    )
    .eq("user_id", existing.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (findMemberError) {
    logger.error({ err: findMemberError, userId: existing.id }, "updateCurrentUserProfile member lookup failed");
    throw findMemberError;
  }

  const memberRow = (existingMember?.[0] as MemberRow | undefined) || null;
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
      memberPatch.phone_number = input.phone_number.trim() || null;
    }
    if (typeof input.alt_phone_number === "string") {
      memberPatch.alt_phone_number = input.alt_phone_number.trim() || null;
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
      const { error: updateMemberError } = await supabaseAdmin
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
  }

  const authResult = await supabaseAdmin.auth.admin.getUserById(input.id);
  if (!authResult.error && authResult.data?.user) {
    const currentMeta = authResult.data.user.user_metadata || {};
    const { error: updateMetaError } = await supabaseAdmin.auth.admin.updateUserById(input.id, {
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
