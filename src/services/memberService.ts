import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { normalizeIndianPhone } from "../utils/phone";

export interface CreateMemberInput {
  full_name: string;
  email: string;
  address: string;
  membership_id: string;
  phone_number?: string;
  subscription_amount: number;
  church_id: string;
  occupation?: string;
  confirmation_taken?: boolean;
  age?: number;
  gender?: string;
  dob?: string;
}

export interface UpdateMemberInput {
  full_name?: string;
  email?: string;
  address?: string;
  membership_id?: string;
  phone_number?: string;
  alt_phone_number?: string;
  verification_status?: string;
  subscription_amount?: number;
  occupation?: string;
  confirmation_taken?: boolean;
  age?: number;
  gender?: string;
  dob?: string;
}

export type MemberListRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone_number: string | null;
  alt_phone_number: string | null;
  address: string | null;
  membership_id: string | null;
  subscription_amount: number | string | null;
  verification_status: string | null;
  church_id: string | null;
  created_at: string;
  occupation: string | null;
  confirmation_taken: boolean | null;
  age: number | null;
};

export type MemberDeleteImpact = {
  family_members: number;
  subscriptions: number;
  payments: number;
};

export async function createMember(input: CreateMemberInput) {
  // Prevent duplicate membership_id within the same church
  const trimmedMembershipId = typeof input.membership_id === "string" ? input.membership_id.trim() : "";
  if (trimmedMembershipId) {
    const { data: existing } = await db
      .from("members")
      .select("id")
      .eq("membership_id", trimmedMembershipId)
      .eq("church_id", input.church_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      throw new Error(`A member with membership ID "${trimmedMembershipId}" already exists in this church.`);
    }
  }

  // Validate email format if provided
  const normalizedEmail = typeof input.email === "string" && input.email.trim()
    ? input.email.trim().toLowerCase()
    : null;
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Invalid email address format");
  }

  // Normalize and check phone_number for duplicates
  const normalizedPhone = typeof input.phone_number === "string" && input.phone_number.trim()
    ? normalizeIndianPhone(input.phone_number)
    : null;
  if (normalizedPhone) {
    const { data: phoneExists } = await db
      .from("members")
      .select("id")
      .eq("phone_number", normalizedPhone)
      .eq("church_id", input.church_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (phoneExists) {
      throw new Error(`A member with phone number "${normalizedPhone}" already exists in this church.`);
    }
  }

  // Validate subscription_amount
  const subAmt = typeof input.subscription_amount === "number" ? input.subscription_amount : 0;
  if (subAmt !== 0 && subAmt < 200) {
    throw new Error("subscription_amount must be at least 200 (or 0 to skip)");
  }

  const { data, error } = await db
    .from("members")
    .insert([
      {
        full_name: input.full_name,
        email: normalizedEmail,
        address: input.address,
        membership_id: trimmedMembershipId || null,
        phone_number: normalizedPhone,
        subscription_amount: input.subscription_amount,
        verification_status: "verified",
        church_id: input.church_id,
        occupation: input.occupation || null,
        confirmation_taken: input.confirmation_taken ?? false,
        age: typeof input.age === "number" ? input.age : null,
        gender: input.gender || null,
        dob: input.dob || null,
      },
    ])
    .single();

  if (error) {
    if (error.code === "23505") {
      if (error.message?.includes("membership_id")) {
        throw new Error(`A member with membership ID "${trimmedMembershipId}" already exists in this church.`);
      }
      if (error.message?.includes("phone_number")) {
        throw new Error(`A member with this phone number already exists in this church.`);
      }
    }
    logger.error({ err: error }, "createMember failed");
    throw error;
  }
  return data;
}

export async function linkUserToMember(userId: string, email: string, churchId: string) {
  const { data: member, error: findError } = await db
    .from("members")
    .select("id, user_id, church_id")
    .eq("email", email)
    .eq("church_id", churchId)
    .single();

  if (findError && findError.code !== "PGRST116") {
    logger.error({ err: findError }, "linkUserToMember find error");
    throw findError;
  }

  if (!member) {
    return null;
  }

  const { data, error } = await db
    .from("members")
    .update({ user_id: userId, verification_status: "verified" })
    .eq("id", member.id)
    .single();

  if (error) {
    logger.error({ err: error }, "linkUserToMember update error");
    throw error;
  }

  return data;
}

export async function listMembers(churchId?: string, limit = 100, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  let query = db
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, subscription_amount, verification_status, church_id, created_at, occupation, confirmation_taken, age",
      { count: "exact" }
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (churchId) {
    query = query.eq("church_id", churchId);
  } else {
    return { data: [], total: 0, limit: safeLimit, offset: safeOffset, has_more: false };
  }

  const { data, error, count } = await query;
  if (error) {
    logger.error({ err: error, churchId }, "listMembers failed");
    throw error;
  }

  const rows = (data || []) as MemberListRow[];
  const total = count ?? rows.length;
  return {
    data: rows,
    total,
    limit: safeLimit,
    offset: safeOffset,
    has_more: safeOffset + rows.length < total,
  };
}

export async function searchMembers(input: {
  churchId?: string;
  query?: string;
  limit?: number;
}) {
  const churchId = input.churchId?.trim();
  const q = input.query?.trim() || "";
  const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200);

  let query = db
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, subscription_amount, verification_status, church_id, created_at, occupation, confirmation_taken, age"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (churchId) {
    query = query.eq("church_id", churchId);
  } else {
    return [] as MemberListRow[];
  }

  if (q) {
    // 4.1: Strip PostgREST special chars to prevent filter injection
    const escaped = q.replace(/,/g, "").replace(/[.()%*\\]/g, "").replace(/_/g, "\\_");
    if (escaped) {
      query = query.or(
        `full_name.ilike.%${escaped}%,email.ilike.%${escaped}%,membership_id.ilike.%${escaped}%,phone_number.ilike.%${escaped}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId, query: q }, "searchMembers failed");
    throw error;
  }

  return (data || []) as MemberListRow[];
}

export async function getMemberById(memberId: string, churchId: string) {
  if (!churchId) throw new Error("churchId is required");

  const { data, error } = await db
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, subscription_amount, verification_status, church_id, created_at, occupation, confirmation_taken, age"
    )
    .eq("id", memberId)
    .eq("church_id", churchId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle<MemberListRow>();
  if (error) {
    logger.error({ err: error, memberId, churchId }, "getMemberById failed");
    throw error;
  }

  return data;
}

export async function updateMember(memberId: string, churchId: string, input: UpdateMemberInput) {
  if (!churchId) throw new Error("churchId is required");
  const patch: Record<string, unknown> = {};

  if (typeof input.full_name === "string") {
    const value = input.full_name.trim();
    if (!value) {
      throw new Error("full_name cannot be empty");
    }
    patch.full_name = value;
  }

  if (typeof input.email === "string") {
    const value = input.email.trim().toLowerCase();
    if (!value) {
      throw new Error("email cannot be empty");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new Error("Invalid email address format");
    }
    patch.email = value;
  }

  if (typeof input.address === "string") {
    patch.address = input.address.trim() || null;
  }

  if (typeof input.membership_id === "string") {
    const trimmed = input.membership_id.trim() || null;
    if (trimmed) {
      const { data: dupMember } = await db
        .from("members")
        .select("id")
        .eq("membership_id", trimmed)
        .eq("church_id", churchId)
        .neq("id", memberId)
        .is("deleted_at", null)
        .maybeSingle();
      if (dupMember) {
        throw new Error(`A member with membership ID "${trimmed}" already exists in this church.`);
      }
    }
    patch.membership_id = trimmed;
  }

  if (typeof input.phone_number === "string") {
    const v = input.phone_number.trim();
    const normalized = v ? normalizeIndianPhone(v) : null;
    if (normalized) {
      const { data: phoneExists } = await db
        .from("members")
        .select("id")
        .eq("phone_number", normalized)
        .eq("church_id", churchId)
        .neq("id", memberId)
        .is("deleted_at", null)
        .maybeSingle();
      if (phoneExists) {
        throw new Error(`A member with phone number "${normalized}" already exists in this church.`);
      }
    }
    patch.phone_number = normalized;
  }

  if (typeof input.alt_phone_number === "string") {
    const v = input.alt_phone_number.trim();
    patch.alt_phone_number = v ? normalizeIndianPhone(v) : null;
  }

  if (typeof input.verification_status === "string") {
    const value = input.verification_status.trim();
    if (!value) {
      throw new Error("verification_status cannot be empty");
    }
    const VALID_STATUSES = ["verified", "pending", "rejected", "suspended"];
    if (!VALID_STATUSES.includes(value)) {
      throw new Error(`verification_status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    patch.verification_status = value;
  }

  if (typeof input.subscription_amount === "number") {
    if (!Number.isFinite(input.subscription_amount) || input.subscription_amount < 0) {
      throw new Error("subscription_amount must be a non-negative number");
    }
    if (input.subscription_amount > 0 && input.subscription_amount < 200) {
      throw new Error("subscription_amount must be at least 200");
    }
    patch.subscription_amount = input.subscription_amount;
  }

  if (typeof input.occupation === "string") {
    patch.occupation = input.occupation.trim() || null;
  }
  if (typeof input.confirmation_taken === "boolean") {
    patch.confirmation_taken = input.confirmation_taken;
  }
  if (typeof input.age === "number") {
    if (input.age < 0 || input.age > 150) {
      throw new Error("age must be between 0 and 150");
    }
    patch.age = input.age;
  }

  if (typeof input.gender === "string") {
    const g = input.gender.trim().toLowerCase();
    if (g && !["male", "female", "other"].includes(g)) {
      throw new Error("gender must be 'male', 'female', or 'other'");
    }
    patch.gender = g || null;
  }

  if (typeof input.dob === "string") {
    const d = input.dob.trim();
    if (d) {
      const parsed = new Date(d);
      if (isNaN(parsed.getTime())) throw new Error("Invalid dob format");
      if (parsed > new Date()) throw new Error("dob cannot be in the future");
      patch.dob = d;
    } else {
      patch.dob = null;
    }
  }

  if (!Object.keys(patch).length) {
    throw new Error("No member fields provided to update");
  }

  const { data, error } = await db
    .from("members")
    .update(patch)
    .eq("id", memberId)
    .eq("church_id", churchId)
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, subscription_amount, verification_status, church_id, created_at, occupation, confirmation_taken, age, gender, dob"
    )
    .single<MemberListRow>();
  if (error) {
    logger.error({ err: error, memberId, churchId }, "updateMember failed");
    throw error;
  }

  return data;
}

export async function getMemberDeleteImpact(memberId: string, churchId: string): Promise<MemberDeleteImpact> {
  if (!churchId) throw new Error("churchId is required");
  const member = await getMemberById(memberId, churchId);
  if (!member) {
    throw new Error("Member not found");
  }

  const [{ count: familyCount, error: familyError }, { count: subscriptionCount, error: subscriptionError }, { count: paymentCount, error: paymentError }] = await Promise.all([
    db
      .from("family_members")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId),
    db
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId),
    db
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId),
  ]);

  if (familyError || subscriptionError || paymentError) {
    logger.error(
      {
        familyError,
        subscriptionError,
        paymentError,
        memberId,
      },
      "getMemberDeleteImpact failed"
    );
    throw familyError || subscriptionError || paymentError;
  }

  return {
    family_members: familyCount || 0,
    subscriptions: subscriptionCount || 0,
    payments: paymentCount || 0,
  };
}

export async function deleteMember(memberId: string, churchId: string) {
  if (!churchId) throw new Error("churchId is required");

  const member = await getMemberById(memberId, churchId);
  if (!member) {
    throw new Error("Member not found");
  }

  // Cancel active subscriptions BEFORE soft-deleting to minimize timing window
  await db
    .from("subscriptions")
    .update({ status: "cancelled" })
    .eq("member_id", memberId)
    .in("status", ["active", "pending_first_payment", "overdue"]);

  // Soft-delete: set deleted_at timestamp instead of hard-deleting
  const { error } = await db
    .from("members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("church_id", churchId);
  if (error) {
    logger.error({ err: error, memberId, churchId }, "deleteMember (soft) failed");
    throw error;
  }

  return { deleted: true, id: memberId };
}

// ── Restore soft-deleted member ──

export async function restoreMember(memberId: string, churchId: string) {
  if (!churchId) throw new Error("churchId is required");

  const { data: member, error: findErr } = await db
    .from("members")
    .select("id, deleted_at")
    .eq("id", memberId)
    .eq("church_id", churchId)
    .maybeSingle<{ id: string; deleted_at: string | null }>();

  if (findErr) throw findErr;
  if (!member) throw new Error("Member not found");
  if (!member.deleted_at) throw new Error("Member is not deleted");

  const { error } = await db
    .from("members")
    .update({ deleted_at: null })
    .eq("id", memberId)
    .eq("church_id", churchId);

  if (error) {
    logger.error({ err: error, memberId }, "restoreMember failed");
    throw error;
  }

  return { restored: true, id: memberId };
}
