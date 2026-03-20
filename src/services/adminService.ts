import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";
import { SUPER_ADMIN_EMAILS } from "../config";

type UserRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
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
  address: string | null;
  membership_id: string | null;
  subscription_amount: number | string | null;
  verification_status: string | null;
  church_id: string;
};

export interface PreRegisterMemberInput {
  email: string;
  church_id: string;
  full_name?: string;
  membership_id?: string;
  address?: string;
  subscription_amount?: number;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const superAdminEmailSet = new Set(SUPER_ADMIN_EMAILS.map((email) => normalizeEmail(email)));

async function getUserRowByEmail(email: string): Promise<UserRow | null> {
  const normalizedEmail = normalizeEmail(email);
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, auth_user_id, email, role, church_id")
    .ilike("email", normalizedEmail)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    logger.error({ err: error, email: normalizedEmail }, "getUserRowByEmail failed");
    throw error;
  }

  return ((data as UserRow[] | null)?.[0] as UserRow | undefined) || null;
}

async function syncAuthUserClaims(
  authUserId: string | null,
  role: "admin" | "member",
  churchId: string | null
) {
  if (!authUserId) {
    return;
  }

  const authUserResult = await supabaseAdmin.auth.admin.getUserById(authUserId);
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

  const updateResult = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    user_metadata: payload,
  });

  if (updateResult.error) {
    logger.warn({ authUserId, err: updateResult.error }, "Failed to sync auth metadata claims");
  }
}

export async function grantAdminAccess(targetEmail: string, churchId?: string) {
  if (superAdminEmailSet.has(normalizeEmail(targetEmail))) {
    throw new Error("Super admin email cannot be modified as dedicated church admin");
  }

  const user = await getUserRowByEmail(targetEmail);
  if (!user) {
    throw new Error("Target user not found in users table. Pre-register them by email first.");
  }

  const resolvedChurchId = churchId || user.church_id;
  if (!resolvedChurchId) {
    throw new Error("church_id is required for this user. Provide church_id in request body.");
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .update({ role: "admin", church_id: resolvedChurchId })
    .eq("id", user.id)
    .select("id, email, role, church_id")
    .single();

  if (error) {
    logger.error({ err: error, email: targetEmail }, "grantAdminAccess failed");
    throw error;
  }

  await syncAuthUserClaims(user.auth_user_id, "admin", resolvedChurchId);
  return data;
}

export async function revokeAdminAccess(targetEmail: string) {
  const user = await getUserRowByEmail(targetEmail);
  if (!user) {
    throw new Error("Target user not found in users table.");
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .update({ role: "member" })
    .eq("id", user.id)
    .select("id, email, role, church_id")
    .single();

  if (error) {
    logger.error({ err: error, email: targetEmail }, "revokeAdminAccess failed");
    throw error;
  }

  await syncAuthUserClaims(user.auth_user_id, "member", user.church_id);
  return data;
}

export async function listAdmins(churchId?: string) {
  let query = supabaseAdmin.from("users").select("id, email, full_name, role, church_id").eq("role", "admin");

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) {
    logger.error({ err: error }, "listAdmins failed");
    throw error;
  }

  return (data || []).filter(
    (admin) => !superAdminEmailSet.has(normalizeEmail(String(admin.email || "")))
  );
}

export async function searchAdmins(input: { churchId?: string; query?: string; limit?: number }) {
  const churchId = input.churchId?.trim();
  const q = input.query?.trim() || "";
  const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200);

  let query = supabaseAdmin
    .from("users")
    .select("id, auth_user_id, email, full_name, role, church_id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  if (q) {
    const escaped = q.replace(/,/g, "");
    query = query.or(`email.ilike.%${escaped}%,full_name.ilike.%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId, query: q }, "searchAdmins failed");
    throw error;
  }

  return ((data || []) as UserRow[]).filter(
    (admin) => !superAdminEmailSet.has(normalizeEmail(String(admin.email || "")))
  );
}

export async function getAdminById(adminId: string) {
  const { data, error } = await supabaseAdmin
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

  const { data, error } = await supabaseAdmin
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
  return data;
}

export async function removeAdminById(adminId: string) {
  const admin = await getAdminById(adminId);
  if (!admin) {
    throw new Error("Admin not found");
  }

  const { data, error } = await supabaseAdmin
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
  return data;
}

export async function preRegisterMember(input: PreRegisterMemberInput) {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedName = input.full_name?.trim() || null;
  const normalizedMembershipId = input.membership_id?.trim() || null;
  const normalizedAddress = input.address?.trim() || null;

  const { data: existingUsers, error: existingUsersError } = await supabaseAdmin
    .from("users")
    .select("id, auth_user_id, email, full_name, role, church_id")
    .ilike("email", normalizedEmail)
    .order("created_at", { ascending: true })
    .limit(1);

  if (existingUsersError) {
    logger.error({ err: existingUsersError, email: normalizedEmail }, "preRegisterMember users lookup failed");
    throw existingUsersError;
  }

  const existingUser = ((existingUsers as UserRow[] | null)?.[0] as UserRow | undefined) || null;

  const userPayload: Record<string, unknown> = {
    email: normalizedEmail,
    role: "member",
    church_id: input.church_id,
  };
  if (normalizedName) {
    userPayload.full_name = normalizedName;
  }

  let user: UserRow;
  if (existingUser) {
    const { data: updatedUser, error: updateUserError } = await supabaseAdmin
      .from("users")
      .update(userPayload)
      .eq("id", existingUser.id)
      .select("id, auth_user_id, email, full_name, role, church_id")
      .single<UserRow>();

    if (updateUserError) {
      logger.error({ err: updateUserError, email: normalizedEmail }, "preRegisterMember user update failed");
      throw updateUserError;
    }
    user = updatedUser;
  } else {
    const { data: insertedUser, error: insertUserError } = await supabaseAdmin
      .from("users")
      .insert([userPayload])
      .select("id, auth_user_id, email, full_name, role, church_id")
      .single<UserRow>();

    if (insertUserError) {
      logger.error({ err: insertUserError, email: normalizedEmail }, "preRegisterMember user insert failed");
      throw insertUserError;
    }
    user = insertedUser;
  }

  const { data: existingMembers, error: existingMembersError } = await supabaseAdmin
    .from("members")
    .select(
      "id, user_id, full_name, email, address, membership_id, subscription_amount, verification_status, church_id"
    )
    .ilike("email", normalizedEmail)
    .order("created_at", { ascending: true })
    .limit(1);

  if (existingMembersError) {
    logger.error(
      { err: existingMembersError, email: normalizedEmail },
      "preRegisterMember member lookup failed"
    );
    throw existingMembersError;
  }

  const existingMember =
    ((existingMembers as MemberRow[] | null)?.[0] as MemberRow | undefined) || null;

  const memberPayload: Record<string, unknown> = {
    user_id: user.id,
    email: normalizedEmail,
    full_name: normalizedName || existingMember?.full_name || user.full_name || normalizedEmail,
    church_id: input.church_id,
  };
  if (normalizedMembershipId !== null) {
    memberPayload.membership_id = normalizedMembershipId;
  }
  if (normalizedAddress !== null) {
    memberPayload.address = normalizedAddress;
  }
  if (typeof input.subscription_amount === "number") {
    memberPayload.subscription_amount = input.subscription_amount;
  }

  let member: MemberRow;
  if (existingMember) {
    const { data: updatedMember, error: updateMemberError } = await supabaseAdmin
      .from("members")
      .update(memberPayload)
      .eq("id", existingMember.id)
      .select(
        "id, user_id, full_name, email, address, membership_id, subscription_amount, verification_status, church_id"
      )
      .single<MemberRow>();

    if (updateMemberError) {
      logger.error(
        { err: updateMemberError, email: normalizedEmail },
        "preRegisterMember member update failed"
      );
      throw updateMemberError;
    }
    member = updatedMember;
  } else {
    const { data: insertedMember, error: insertMemberError } = await supabaseAdmin
      .from("members")
      .insert([
        {
          ...memberPayload,
          verification_status: "pending",
        },
      ])
      .select(
        "id, user_id, full_name, email, address, membership_id, subscription_amount, verification_status, church_id"
      )
      .single<MemberRow>();

    if (insertMemberError) {
      logger.error(
        { err: insertMemberError, email: normalizedEmail },
        "preRegisterMember member insert failed"
      );
      throw insertMemberError;
    }
    member = insertedMember;
  }

  return {
    user,
    member,
  };
}
