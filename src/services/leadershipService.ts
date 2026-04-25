import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { normalizeIndianPhone } from "../utils/phone";

// ── Types ──

export interface LeadershipRoleRow {
  id: string;
  name: string;
  hierarchy_level: number;
  is_pastor_role: boolean;
  description: string | null;
}

export interface ChurchLeadershipRow {
  id: string;
  church_id: string;
  role_id: string;
  member_id: string | null;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  photo_url: string | null;
  bio: string | null;
  is_active: boolean;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  role_name?: string;
  hierarchy_level?: number;
  is_pastor_role?: boolean;
}

// ── List all defined roles (ordered by hierarchy) ──

export async function listLeadershipRoles(): Promise<LeadershipRoleRow[]> {
  const { data, error } = await db
    .from("leadership_roles")
    .select("id, name, hierarchy_level, is_pastor_role, description")
    .order("hierarchy_level", { ascending: true });

  if (error) {
    logger.error({ err: error }, "listLeadershipRoles failed");
    throw error;
  }
  return data || [];
}

// ── List leadership for a church (enriched with role info, ordered by hierarchy) ──

export async function listChurchLeadership(
  churchId: string,
  activeOnly = true
): Promise<ChurchLeadershipRow[]> {
  // Fetch leadership assignments
  let query = db
    .from("church_leadership")
    .select("id, church_id, role_id, member_id, full_name, phone_number, email, photo_url, bio, is_active, assigned_by, created_at, updated_at, custom_role_name, custom_hierarchy_level")
    .eq("church_id", churchId);

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data: leaders, error } = await query;

  if (error) {
    logger.error({ err: error, churchId }, "listChurchLeadership failed");
    throw error;
  }

  if (!leaders || !leaders.length) return [];

  // Load all roles for enrichment
  const roles = await listLeadershipRoles();
  const roleMap = new Map(roles.map((r) => [r.id, r]));

  // Enrich and sort by hierarchy
  const enriched = leaders.map((l: any) => {
    const role = roleMap.get(l.role_id);
    return {
      ...l,
      role_name: l.custom_role_name || role?.name || "Unknown",
      hierarchy_level: l.custom_hierarchy_level ?? role?.hierarchy_level ?? 999,
      is_pastor_role: role?.is_pastor_role ?? false,
    };
  });

  enriched.sort((a: any, b: any) => (a.hierarchy_level ?? 999) - (b.hierarchy_level ?? 999));
  return enriched;
}

// ── Create leadership assignment ──

export interface CreateLeadershipInput {
  church_id: string;
  role_id: string;
  member_id?: string;
  full_name: string;
  phone_number?: string;
  email?: string;
  photo_url?: string;
  bio?: string;
  assigned_by?: string;
  custom_role_name?: string;
  custom_hierarchy_level?: number;
}

export async function createLeadershipAssignment(
  input: CreateLeadershipInput
): Promise<ChurchLeadershipRow> {
  // Validate role exists
  const { data: role, error: roleErr } = await db
    .from("leadership_roles")
    .select("id, name, is_pastor_role")
    .eq("id", input.role_id)
    .single();

  if (roleErr || !role) {
    throw new Error("Leadership role not found");
  }

  const { data: leader, error: insertErr } = await db
    .from("church_leadership")
    .insert([{
      church_id: input.church_id,
      role_id: input.role_id,
      member_id: input.member_id || null,
      full_name: input.full_name.trim(),
      phone_number: input.phone_number ? normalizeIndianPhone(input.phone_number) : null,
      email: input.email?.trim() || null,
      photo_url: input.photo_url?.trim() || null,
      bio: input.bio?.trim() || null,
      is_active: true,
      assigned_by: input.assigned_by || null,
      custom_role_name: input.custom_role_name?.trim() || null,
      custom_hierarchy_level: input.custom_hierarchy_level ?? null,
    }])
    .select("*")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      throw new Error("This person already holds this role in this church");
    }
    logger.error({ err: insertErr }, "createLeadershipAssignment failed");
    throw insertErr;
  }

  // Auto-sync to pastors table if this is a pastor role (DC, Presbyter, Pastor)
  if (role.is_pastor_role && input.phone_number) {
    await syncLeaderToPastors(input.church_id, input.full_name, normalizeIndianPhone(input.phone_number), input.email, input.bio);
  }

  return leader;
}

// ── Update leadership assignment ──

export interface UpdateLeadershipInput {
  full_name?: string;
  phone_number?: string;
  email?: string;
  photo_url?: string;
  bio?: string;
  is_active?: boolean;
  role_id?: string;
  custom_role_name?: string;
  custom_hierarchy_level?: number;
}

export async function updateLeadershipAssignment(
  churchId: string,
  leadershipId: string,
  input: UpdateLeadershipInput
): Promise<ChurchLeadershipRow> {
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.full_name !== undefined) updatePayload.full_name = input.full_name.trim();
  if (input.phone_number !== undefined) updatePayload.phone_number = input.phone_number.trim() ? normalizeIndianPhone(input.phone_number) : null;
  if (input.email !== undefined) updatePayload.email = input.email.trim() || null;
  if (input.photo_url !== undefined) updatePayload.photo_url = input.photo_url.trim() || null;
  if (input.bio !== undefined) updatePayload.bio = input.bio.trim() || null;
  if (input.is_active !== undefined) updatePayload.is_active = input.is_active;
  if (input.role_id !== undefined) updatePayload.role_id = input.role_id;
  if (input.custom_role_name !== undefined) updatePayload.custom_role_name = input.custom_role_name.trim() || null;
  if (input.custom_hierarchy_level !== undefined) updatePayload.custom_hierarchy_level = input.custom_hierarchy_level;

  const { data: updated, error } = await db
    .from("church_leadership")
    .update(updatePayload)
    .eq("id", leadershipId)
    .eq("church_id", churchId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("Duplicate role assignment");
    }
    logger.error({ err: error, leadershipId }, "updateLeadershipAssignment failed");
    throw error;
  }

  if (!updated) throw new Error("Leadership assignment not found");
  return updated;
}

// ── Delete (soft-deactivate) leadership assignment ──

export async function deleteLeadershipAssignment(
  churchId: string,
  leadershipId: string
): Promise<{ success: boolean }> {
  const { error } = await db
    .from("church_leadership")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", leadershipId)
    .eq("church_id", churchId);

  if (error) {
    logger.error({ err: error, leadershipId }, "deleteLeadershipAssignment failed");
    throw error;
  }

  return { success: true };
}

// ── Get pastoral leaders for prayer requests ──
// Returns leaders who hold DC, Presbyter, or Pastor roles (is_pastor_role = true)

export async function listPastoralLeaders(churchId: string): Promise<ChurchLeadershipRow[]> {
  const allLeaders = await listChurchLeadership(churchId, true);
  return allLeaders.filter((l) => l.is_pastor_role);
}

// ── Helper: sync a pastoral leader to the pastors table ──

async function syncLeaderToPastors(
  churchId: string,
  fullName: string,
  phoneNumber: string,
  email?: string | null,
  details?: string | null
) {
  try {
    // Check if pastor already exists with this phone
    const { data: existing } = await db
      .from("pastors")
      .select("id")
      .eq("phone_number", phoneNumber)
      .maybeSingle();

    if (existing) return; // Already in pastors table

    await db
      .from("pastors")
      .insert([{
        church_id: churchId,
        full_name: fullName,
        phone_number: phoneNumber,
        email: email || null,
        details: details || null,
        is_active: true,
      }]);
  } catch (err) {
    // Non-critical: log but don't fail the leadership assignment
    logger.warn({ err, phoneNumber }, "syncLeaderToPastors failed (non-critical)");
  }
}

// ── Validate church has at least one leadership role assigned ──

export async function validateChurchHasLeadership(churchId: string): Promise<boolean> {
  const { data, error } = await db
    .from("church_leadership")
    .select("id")
    .eq("church_id", churchId)
    .eq("is_active", true)
    .limit(1);

  if (error) {
    logger.error({ err: error, churchId }, "validateChurchHasLeadership failed");
    return false;
  }

  return (data?.length || 0) > 0;
}
