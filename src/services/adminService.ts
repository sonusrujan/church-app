import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_PHONES } from "../config";
import { revokeAllRefreshTokens } from "./refreshTokenService";
import { invalidateRoleCache } from "../middleware/requireAuth";
import { normalizeIndianPhone } from "../utils/phone";
import { initializeMonthlyDuesForPreRegister } from "./subscriptionMonthlyDuesService";

type UserRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  phone_number?: string | null;
  full_name?: string | null;
  role: "admin" | "member";
  church_id: string | null;
};

export interface UpdateAdminInput {
  full_name?: string;
  church_id?: string;
}

type MemberRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone_number?: string | null;
  address: string | null;
  membership_id: string | null;
  subscription_amount: number | string | null;
  verification_status: string | null;
  church_id: string;
};

export interface PreRegisterMemberInput {
  email?: string;
  phone_number?: string;
  church_id: string;
  full_name?: string;
  membership_id?: string;
  address?: string;
  subscription_amount?: number;
  occupation?: string;
  confirmation_taken?: boolean;
  age?: number;
  pending_months?: string[];
  no_pending_payments?: boolean;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const superAdminEmailSet = new Set(SUPER_ADMIN_EMAILS.map((email) => normalizeEmail(email)));
const superAdminPhoneSet = new Set(SUPER_ADMIN_PHONES.map((p) => normalizeIndianPhone(p) || p.trim()));

/**
 * Look up a user by phone number.
 * SH-004: When callerChurchId is provided, verifies the user belongs to that church.
 */
async function getUserRowByIdentifier(identifier: string, callerChurchId?: string): Promise<UserRow | null> {
  const trimmed = identifier.trim();

  // Phone number lookup
  if (/^\+?\d{7,15}$/.test(trimmed.replace(/\s/g, ""))) {
    const { data: byPhone, error: phoneErr } = await db
      .from("users")
      .select("id, auth_user_id, email, phone_number, role, church_id")
      .eq("phone_number", trimmed)
      .order("created_at", { ascending: true })
      .limit(1);
    if (phoneErr) {
      logger.error({ err: phoneErr, phone: trimmed }, "getUserRowByIdentifier phone lookup failed");
      throw phoneErr;
    }
    if (byPhone && byPhone.length > 0) {
      const user = (byPhone as UserRow[])[0];
      // SH-004: Reject if user belongs to a different church
      if (callerChurchId && user.church_id && user.church_id !== callerChurchId) {
        return null;
      }
      return user;
    }
  }

  return null;
}

/** @deprecated Use getUserRowByIdentifier instead */
async function getUserRowByEmail(email: string): Promise<UserRow | null> {
  return getUserRowByIdentifier(email);
}

async function syncAuthUserClaims(
  authUserId: string | null,
  role: "admin" | "member",
  churchId: string | null
) {
  if (!authUserId) {
    return;
  }

  const authUserResult = await db.auth.admin.getUserById(authUserId);
  if (authUserResult.error || !authUserResult.data?.user) {
    logger.warn(
      { authUserId, err: authUserResult.error },
      "Could not fetch auth user for metadata sync"
    );
    return;
  }

  const existingMetadata = authUserResult.data.user.user_metadata || {};
  const payload = {
    ...existingMetadata,
    role,
    church_id: churchId || "",
  };

  const updateResult = await db.auth.admin.updateUserById(authUserId, {
    user_metadata: payload,
  });

  if (updateResult.error) {
    logger.warn({ authUserId, err: updateResult.error }, "Failed to sync auth metadata claims");
  }
}

export async function grantAdminAccess(targetIdentifier: string, churchId?: string, callerChurchId?: string) {
  const trimmed = targetIdentifier.trim();
  if (superAdminEmailSet.has(normalizeEmail(trimmed)) || superAdminPhoneSet.has(trimmed)) {
    throw new Error("Super admin cannot be modified as dedicated church admin");
  }

  const user = await getUserRowByIdentifier(trimmed);
  if (!user) {
    throw new Error("Target user not found. Pre-register them first (by phone).");
  }

  const resolvedChurchId = churchId || user.church_id;
  if (!resolvedChurchId) {
    throw new Error("church_id is required for this user. Provide church_id in request body.");
  }

  // RBAC-002: Non-super-admin callers can only grant admin within their own church
  if (callerChurchId && resolvedChurchId !== callerChurchId) {
    throw new Error("Cannot grant admin access to a user in a different church");
  }

  const { data, error } = await db
    .from("users")
    .update({ role: "admin", church_id: resolvedChurchId })
    .eq("id", user.id)
    .neq("role", "admin")
    .select("id, email, role, church_id")
    .maybeSingle();

  if (error) {
    logger.error({ err: error, identifier: targetIdentifier }, "grantAdminAccess failed");
    throw error;
  }
  if (!data) {
    throw new Error("User is already an admin or was updated by another request");
  }

  await syncAuthUserClaims(user.auth_user_id, "admin", resolvedChurchId);
  invalidateRoleCache(user.id);
  // AUTH-14: Invalidate existing sessions so the user must re-authenticate with new role
  revokeAllRefreshTokens(user.id).catch((e) => logger.warn({ err: e }, "Failed to revoke tokens after grant"));
  return data;
}

export async function revokeAdminAccess(targetIdentifier: string) {
  const user = await getUserRowByIdentifier(targetIdentifier.trim());
  if (!user) {
    throw new Error("Target user not found in users table.");
  }

  // C2: Last-admin guard — prevent revoking the only remaining admin of a church
  if (user.church_id && user.role === "admin") {
    const { data: adminCount } = await db
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("church_id", user.church_id)
      .eq("role", "admin");
    if ((adminCount ?? 0) <= 1) {
      throw new Error("Cannot revoke the last admin of a church. Assign another admin first.");
    }
  }

  const { data, error } = await db
    .from("users")
    .update({ role: "member" })
    .eq("id", user.id)
    .select("id, email, role, church_id")
    .single();

  if (error) {
    logger.error({ err: error, identifier: targetIdentifier }, "revokeAdminAccess failed");
    throw error;
  }

  await syncAuthUserClaims(user.auth_user_id, "member", user.church_id);
  invalidateRoleCache(user.id);
  // AUTH-14: Invalidate existing sessions so the user must re-authenticate with new role
  revokeAllRefreshTokens(user.id).catch((e) => logger.warn({ err: e }, "Failed to revoke tokens after revoke"));
  return data;
}

export async function listAdmins(churchId: string, allChurches = false) {
  if (!churchId && !allChurches) throw new Error("churchId is required");

  let query = db.from("users").select("id, email, phone_number, full_name, role, church_id").eq("role", "admin").order("created_at", { ascending: true });
  if (churchId) query = query.eq("church_id", churchId);
  const { data, error } = await query;
  if (error) {
    logger.error({ err: error }, "listAdmins failed");
    throw error;
  }

  return (data || []).filter(
    (admin: any) =>
      !superAdminEmailSet.has(normalizeEmail(String(admin.email || ""))) &&
      !superAdminPhoneSet.has(normalizeIndianPhone(String(admin.phone_number || "")))
  );
}

export async function searchAdmins(input: { churchId: string; query?: string; limit?: number; allChurches?: boolean }) {
  const churchId = input.churchId?.trim();
  if (!churchId && !input.allChurches) throw new Error("churchId is required");

  const q = input.query?.trim() || "";
  const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200);

  let query = db
    .from("users")
    .select("id, auth_user_id, email, full_name, role, church_id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (churchId) query = query.eq("church_id", churchId);

  if (q) {
    // SVCADM-001: Strict allowlist to prevent PostgREST filter injection
    const sanitized = q.replace(/[^a-zA-Z0-9@\s\-+.]/g, "").trim();
    if (sanitized) {
      const escaped = sanitized.replace(/%/g, "").replace(/_/g, "\\_");
      query = query.or(`email.ilike.%${escaped}%,full_name.ilike.%${escaped}%`);
    }
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId, query: q }, "searchAdmins failed");
    throw error;
  }

  return ((data || []) as UserRow[]).filter(
    (admin) =>
      !superAdminEmailSet.has(normalizeEmail(String(admin.email || ""))) &&
      !superAdminPhoneSet.has(normalizeIndianPhone(String((admin as any).phone_number || "")))
  );
}

export async function getAdminById(adminId: string) {
  const { data, error } = await db
    .from("users")
    .select("id, auth_user_id, email, full_name, role, church_id")
    .eq("id", adminId)
    .eq("role", "admin")
    .maybeSingle<UserRow>();

  if (error) {
    logger.error({ err: error, adminId }, "getAdminById failed");
    throw error;
  }

  if (!data) {
    return null;
  }

  if (superAdminEmailSet.has(normalizeEmail(String(data.email || "")))) {
    return null;
  }

  return data;
}

export async function updateAdminById(adminId: string, input: UpdateAdminInput) {
  const admin = await getAdminById(adminId);
  if (!admin) {
    throw new Error("Admin not found");
  }

  const patch: Record<string, unknown> = {};

  if (typeof input.full_name === "string") {
    patch.full_name = input.full_name.trim() || null;
  }

  if (typeof input.church_id === "string") {
    const churchId = input.church_id.trim();
    if (!churchId) {
      throw new Error("church_id cannot be empty");
    }
    patch.church_id = churchId;
  }

  if (!Object.keys(patch).length) {
    throw new Error("No admin fields provided to update");
  }

  const { data, error } = await db
    .from("users")
    .update(patch)
    .eq("id", adminId)
    .eq("role", "admin")
    .select("id, auth_user_id, email, full_name, role, church_id")
    .single<UserRow>();

  if (error) {
    logger.error({ err: error, adminId }, "updateAdminById failed");
    throw error;
  }

  await syncAuthUserClaims(data.auth_user_id, "admin", data.church_id);
  invalidateRoleCache(adminId);
  return data;
}

export async function removeAdminById(adminId: string) {
  const admin = await getAdminById(adminId);
  if (!admin) {
    throw new Error("Admin not found");
  }

  // Prevent removing the last admin of a church
  if (admin.church_id) {
    const { count } = await db
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("church_id", admin.church_id);
    if ((count || 0) <= 1) {
      throw new Error("Cannot remove the last admin from a church. Assign another admin first.");
    }
  }

  const { data, error } = await db
    .from("users")
    .update({ role: "member" })
    .eq("id", adminId)
    .eq("role", "admin")
    .select("id, auth_user_id, email, full_name, role, church_id")
    .single<UserRow>();

  if (error) {
    logger.error({ err: error, adminId }, "removeAdminById failed");
    throw error;
  }

  await syncAuthUserClaims(data.auth_user_id, "member", data.church_id);
  invalidateRoleCache(adminId);
  return data;
}

export async function preRegisterMember(input: PreRegisterMemberInput) {
  const normalizedEmail = input.email ? normalizeEmail(input.email) : "";
  const normalizedPhone = input.phone_number?.trim() ? normalizeIndianPhone(input.phone_number) : "";
  const normalizedName = input.full_name?.trim() || null;
  const normalizedMembershipId = input.membership_id?.trim() || null;
  const normalizedAddress = input.address?.trim() || null;

  if (!normalizedPhone && !normalizedEmail) {
    throw new Error("Either phone_number or email is required to pre-register a member.");
  }

  // Look up existing user by phone first, then email
  let existingUser: UserRow | null = null;
  if (normalizedPhone) {
    const { data: byPhone } = await db
      .from("users")
      .select("id, auth_user_id, email, phone_number, full_name, role, church_id")
      .eq("phone_number", normalizedPhone)
      .order("created_at", { ascending: true })
      .limit(1);
    existingUser = ((byPhone as UserRow[] | null)?.[0] as UserRow | undefined) || null;
  }
  if (!existingUser && normalizedEmail) {
    const { data: byEmail, error: existingUsersError } = await db
      .from("users")
      .select("id, auth_user_id, email, phone_number, full_name, role, church_id")
      .ilike("email", normalizedEmail)
      .order("created_at", { ascending: true })
      .limit(1);
    if (existingUsersError) {
      logger.error({ err: existingUsersError }, "preRegisterMember users lookup failed");
      throw existingUsersError;
    }
    existingUser = ((byEmail as UserRow[] | null)?.[0] as UserRow | undefined) || null;
  }

  // Prevent hijacking: reject if the user already belongs to a different church
  if (existingUser && existingUser.church_id && existingUser.church_id !== input.church_id) {
    throw new Error("This user already belongs to another church. Cannot pre-register.");
  }

  const userPayload: Record<string, unknown> = {
    role: "member",
    church_id: input.church_id,
  };
  if (normalizedEmail) userPayload.email = normalizedEmail;
  if (normalizedPhone) userPayload.phone_number = normalizedPhone;
  if (normalizedName) userPayload.full_name = normalizedName;

  let user: UserRow;
  if (existingUser) {
    const { data: updatedUser, error: updateUserError } = await db
      .from("users")
      .update(userPayload)
      .eq("id", existingUser.id)
      .select("id, auth_user_id, email, phone_number, full_name, role, church_id")
      .single<UserRow>();

    if (updateUserError) {
      logger.error({ err: updateUserError }, "preRegisterMember user update failed");
      throw updateUserError;
    }
    user = updatedUser;
  } else {
    const { data: insertedUser, error: insertUserError } = await db
      .from("users")
      .insert([userPayload])
      .select("id, auth_user_id, email, phone_number, full_name, role, church_id")
      .single<UserRow>();

    if (insertUserError) {
      logger.error({ err: insertUserError }, "preRegisterMember user insert failed");
      throw insertUserError;
    }
    user = insertedUser;
  }

  // Look up existing member by phone first, then email
  let existingMember: MemberRow | null = null;
  let matchedBy: "phone" | "email" | null = null;
  if (normalizedPhone) {
    const { data: memByPhone } = await db
      .from("members")
      .select("id, user_id, full_name, email, phone_number, address, membership_id, subscription_amount, verification_status, church_id")
      .eq("phone_number", normalizedPhone)
      .eq("church_id", input.church_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    existingMember = ((memByPhone as MemberRow[] | null)?.[0] as MemberRow | undefined) || null;
    if (existingMember) matchedBy = "phone";
  }
  if (!existingMember && normalizedEmail) {
    const { data: memByEmail, error: existingMembersError } = await db
      .from("members")
      .select("id, user_id, full_name, email, phone_number, address, membership_id, subscription_amount, verification_status, church_id")
      .ilike("email", normalizedEmail)
      .eq("church_id", input.church_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (existingMembersError) {
      logger.error({ err: existingMembersError }, "preRegisterMember member lookup failed");
      throw existingMembersError;
    }
    existingMember = ((memByEmail as MemberRow[] | null)?.[0] as MemberRow | undefined) || null;
    if (existingMember) matchedBy = "email";
  }

  // Reject if the member already exists — do not silently overwrite
  if (existingMember) {
    const identifier = matchedBy === "phone" ? normalizedPhone : normalizedEmail;
    throw new Error(
      `A member with this ${matchedBy} (${identifier}) already exists in this church: ${existingMember.full_name || existingMember.id}. Use the Members tab to edit existing members.`
    );
  }

  // Prevent duplicate membership_id within the same church
  if (normalizedMembershipId) {
    const { data: dupMember } = await db
      .from("members")
      .select("id")
      .eq("membership_id", normalizedMembershipId)
      .eq("church_id", input.church_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (dupMember) {
      throw new Error(`A member with membership ID "${normalizedMembershipId}" already exists in this church.`);
    }
  }

  const memberPayload: Record<string, unknown> = {
    user_id: user.id,
    full_name: normalizedName || user.full_name || normalizedPhone || normalizedEmail,
    church_id: input.church_id,
  };
  if (normalizedEmail) memberPayload.email = normalizedEmail;
  if (normalizedPhone) memberPayload.phone_number = normalizedPhone;
  if (normalizedMembershipId !== null) {
    memberPayload.membership_id = normalizedMembershipId;
  }
  if (normalizedAddress !== null) {
    memberPayload.address = normalizedAddress;
  }
  if (typeof input.subscription_amount === "number") {
    memberPayload.subscription_amount = input.subscription_amount;
  }
  if (input.occupation) memberPayload.occupation = input.occupation;
  if (typeof input.confirmation_taken === "boolean") memberPayload.confirmation_taken = input.confirmation_taken;
  if (typeof input.age === "number") memberPayload.age = input.age;

  const { data: insertedMember, error: insertMemberError } = await db
    .from("members")
    .insert([
      {
        ...memberPayload,
        verification_status: "verified",
      },
    ])
    .select(
      "id, user_id, full_name, email, phone_number, address, membership_id, subscription_amount, verification_status, church_id, occupation, confirmation_taken, age"
    )
    .single<MemberRow>();

  if (insertMemberError) {
    if (insertMemberError.code === "23505") {
      if (insertMemberError.message?.includes("membership_id")) {
        throw new Error(`A member with membership ID "${normalizedMembershipId}" already exists in this church.`);
      }
      if (insertMemberError.message?.includes("phone_number")) {
        throw new Error(`A member with phone number "${normalizedPhone}" already exists in this church.`);
      }
    }
    logger.error({ err: insertMemberError }, "preRegisterMember member insert failed");
    throw insertMemberError;
  }

  // Optional: initialize a monthly subscription ledger during pre-register.
  // This is needed for legacy/manual-record migration where pending months start from Jan 2025.
  if (typeof input.subscription_amount === "number" && Number.isFinite(input.subscription_amount) && input.subscription_amount > 0) {
    const jan2025 = "2025-01-01";
    const { data: createdSubscription, error: subErr } = await db
      .from("subscriptions")
      .insert([
        {
          member_id: insertedMember.id,
          family_member_id: null,
          church_id: input.church_id,
          plan_name: "Monthly Subscription",
          amount: input.subscription_amount,
          billing_cycle: "monthly",
          start_date: jan2025,
          next_payment_date: jan2025,
          status: "pending_first_payment",
        },
      ])
      .select("id")
      .single<{ id: string }>();

    if (subErr) {
      logger.error({ err: subErr, memberId: insertedMember.id }, "preRegisterMember subscription insert failed");
      throw subErr;
    }

    await initializeMonthlyDuesForPreRegister({
      subscription_id: createdSubscription.id,
      member_id: insertedMember.id,
      church_id: input.church_id,
      start_month: jan2025,
      pending_months: input.pending_months || [],
      no_pending_payments: !!input.no_pending_payments,
    });
  }

  return {
    user,
    member: insertedMember,
  };
}
