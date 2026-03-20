import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";

export interface CreateMemberInput {
  full_name: string;
  email: string;
  address: string;
  membership_id: string;
  subscription_amount: number;
  church_id: string;
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
};

export type MemberDeleteImpact = {
  family_members: number;
  subscriptions: number;
  payments: number;
};

export async function createMember(input: CreateMemberInput) {
  const { data, error } = await supabaseAdmin
    .from("members")
    .insert([
      {
        full_name: input.full_name,
        email: input.email,
        address: input.address,
        membership_id: input.membership_id,
        subscription_amount: input.subscription_amount,
        verification_status: "pending",
        church_id: input.church_id,
      },
    ])
    .single();

  if (error) {
    logger.error({ err: error }, "createMember failed");
    throw error;
  }
  return data;
}

export async function linkUserToMember(userId: string, email: string) {
  const { data: member, error: findError } = await supabaseAdmin
    .from("members")
    .select("id, user_id, church_id")
    .eq("email", email)
    .single();

  if (findError && findError.code !== "PGRST116") {
    logger.error({ err: findError }, "linkUserToMember find error");
    throw findError;
  }

  if (!member) {
    return null;
  }

  const { data, error } = await supabaseAdmin
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

export async function listMembers(churchId?: string) {
  let query = supabaseAdmin
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, subscription_amount, verification_status, church_id, created_at"
    )
    .order("created_at", { ascending: false });

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId }, "listMembers failed");
    throw error;
  }

  return (data || []) as MemberListRow[];
}

export async function searchMembers(input: {
  churchId?: string;
  query?: string;
  limit?: number;
}) {
  const churchId = input.churchId?.trim();
  const q = input.query?.trim() || "";
  const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200);

  let query = supabaseAdmin
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, subscription_amount, verification_status, church_id, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  if (q) {
    const escaped = q.replace(/,/g, "");
    query = query.or(
      `full_name.ilike.%${escaped}%,email.ilike.%${escaped}%,membership_id.ilike.%${escaped}%,phone_number.ilike.%${escaped}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId, query: q }, "searchMembers failed");
    throw error;
  }

  return (data || []) as MemberListRow[];
}

export async function getMemberById(memberId: string, churchId?: string) {
  let query = supabaseAdmin
    .from("members")
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, subscription_amount, verification_status, church_id, created_at"
    )
    .eq("id", memberId)
    .limit(1);

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  const { data, error } = await query.maybeSingle<MemberListRow>();
  if (error) {
    logger.error({ err: error, memberId, churchId }, "getMemberById failed");
    throw error;
  }

  return data;
}

export async function updateMember(memberId: string, churchId: string | undefined, input: UpdateMemberInput) {
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
    patch.email = value;
  }

  if (typeof input.address === "string") {
    patch.address = input.address.trim() || null;
  }

  if (typeof input.membership_id === "string") {
    patch.membership_id = input.membership_id.trim() || null;
  }

  if (typeof input.phone_number === "string") {
    patch.phone_number = input.phone_number.trim() || null;
  }

  if (typeof input.alt_phone_number === "string") {
    patch.alt_phone_number = input.alt_phone_number.trim() || null;
  }

  if (typeof input.verification_status === "string") {
    const value = input.verification_status.trim();
    if (!value) {
      throw new Error("verification_status cannot be empty");
    }
    patch.verification_status = value;
  }

  if (typeof input.subscription_amount === "number") {
    if (!Number.isFinite(input.subscription_amount) || input.subscription_amount < 0) {
      throw new Error("subscription_amount must be a non-negative number");
    }
    patch.subscription_amount = input.subscription_amount;
  }

  if (!Object.keys(patch).length) {
    throw new Error("No member fields provided to update");
  }

  let query = supabaseAdmin
    .from("members")
    .update(patch)
    .eq("id", memberId);

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  const { data, error } = await query
    .select(
      "id, user_id, full_name, email, phone_number, alt_phone_number, address, membership_id, subscription_amount, verification_status, church_id, created_at"
    )
    .single<MemberListRow>();
  if (error) {
    logger.error({ err: error, memberId, churchId }, "updateMember failed");
    throw error;
  }

  return data;
}

export async function getMemberDeleteImpact(memberId: string, churchId?: string): Promise<MemberDeleteImpact> {
  const member = await getMemberById(memberId, churchId);
  if (!member) {
    throw new Error("Member not found");
  }

  const [{ count: familyCount, error: familyError }, { count: subscriptionCount, error: subscriptionError }, { count: paymentCount, error: paymentError }] = await Promise.all([
    supabaseAdmin
      .from("family_members")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId),
    supabaseAdmin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId),
    supabaseAdmin
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

export async function deleteMember(memberId: string, churchId?: string) {
  const member = await getMemberById(memberId, churchId);
  if (!member) {
    throw new Error("Member not found");
  }

  let query = supabaseAdmin.from("members").delete().eq("id", memberId);
  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  const { error } = await query;
  if (error) {
    logger.error({ err: error, memberId, churchId }, "deleteMember failed");
    throw error;
  }

  return { deleted: true, id: memberId };
}
