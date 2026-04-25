import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { normalizeIndianPhone } from "../utils/phone";

// ── Constants ──

export const DIOCESE_ROLES = [
  "Bishop",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Assistant Secretary",
  "Associate Treasurer",
] as const;

export type DioceseRole = (typeof DIOCESE_ROLES)[number];

// ── Types ──

export interface DioceseRow {
  id: string;
  name: string;
  logo_url: string | null;
  banner_url: string | null;
  logo_urls: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  church_count?: number;
}

export interface DioceseChurchRow {
  id: string;
  diocese_id: string;
  church_id: string;
  added_at: string;
  // Enriched
  church_name?: string;
  church_code?: string;
  church_location?: string;
}

export interface DioceseLeaderRow {
  id: string;
  diocese_id: string;
  role: string;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  bio: string | null;
  photo_url: string | null;
  is_active: boolean;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Diocese CRUD ──

export async function listDioceses(): Promise<DioceseRow[]> {
  const { data, error } = await db
    .from("dioceses")
    .select("id, name, logo_url, banner_url, logo_urls, created_by, created_at, updated_at")
    .order("name", { ascending: true });

  if (error) {
    logger.error({ err: error }, "listDioceses failed");
    throw error;
  }

  const dioceses = (data || []).map((d: any) => ({ ...d, logo_urls: d.logo_urls || [] })) as DioceseRow[];

  // Enrich with church counts
  if (dioceses.length) {
    const ids = dioceses.map((d) => d.id);
    const { data: counts } = await db
      .from("diocese_churches")
      .select("diocese_id")
      .in("diocese_id", ids);

    const countMap = new Map<string, number>();
    for (const row of counts || []) {
      countMap.set(row.diocese_id, (countMap.get(row.diocese_id) || 0) + 1);
    }
    for (const d of dioceses) {
      d.church_count = countMap.get(d.id) || 0;
    }
  }

  return dioceses;
}

export async function createDiocese(name: string, createdBy?: string): Promise<DioceseRow> {
  const { data, error } = await db
    .from("dioceses")
    .insert([{ name: name.trim(), created_by: createdBy || null }])
    .select("id, name, logo_url, banner_url, logo_urls, created_by, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("A diocese with this name already exists");
    logger.error({ err: error }, "createDiocese failed");
    throw error;
  }

  return { ...data, church_count: 0, logo_urls: data.logo_urls || [] };
}

export async function updateDiocese(id: string, name: string): Promise<DioceseRow> {
  const { data, error } = await db
    .from("dioceses")
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, name, logo_url, banner_url, logo_urls, created_by, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("A diocese with this name already exists");
    logger.error({ err: error }, "updateDiocese failed");
    throw error;
  }

  if (!data) throw new Error("Diocese not found");
  return { ...data, logo_urls: data.logo_urls || [] };
}

export async function deleteDiocese(id: string): Promise<{ success: boolean }> {
  const { error } = await db
    .from("dioceses")
    .delete()
    .eq("id", id);

  if (error) {
    logger.error({ err: error }, "deleteDiocese failed");
    throw error;
  }

  return { success: true };
}

export async function updateDioceseMedia(
  id: string,
  fields: { logo_url?: string | null; banner_url?: string | null },
): Promise<DioceseRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.logo_url !== undefined) update.logo_url = fields.logo_url;
  if (fields.banner_url !== undefined) update.banner_url = fields.banner_url;

  const { data, error } = await db
    .from("dioceses")
    .update(update)
    .eq("id", id)
    .select("id, name, logo_url, banner_url, logo_urls, created_by, created_at, updated_at")
    .single();

  if (error) {
    logger.error({ err: error }, "updateDioceseMedia failed");
    throw error;
  }
  if (!data) throw new Error("Diocese not found");
  return { ...data, logo_urls: data.logo_urls || [] };
}

/** Get the diocese a church belongs to (returns null if unassigned) */
export async function getDioceseByChurchId(churchId: string): Promise<DioceseRow | null> {
  const { data: mapping, error: mapErr } = await db
    .from("diocese_churches")
    .select("diocese_id")
    .eq("church_id", churchId)
    .maybeSingle();

  if (mapErr) {
    logger.error({ err: mapErr, churchId }, "getDioceseByChurchId mapping lookup failed");
    return null;
  }
  if (!mapping) return null;

  const { data, error } = await db
    .from("dioceses")
    .select("id, name, logo_url, banner_url, logo_urls, created_by, created_at, updated_at")
    .eq("id", mapping.diocese_id)
    .single();

  if (error) {
    logger.error({ err: error }, "getDioceseByChurchId diocese lookup failed");
    return null;
  }
  return { ...data, logo_urls: (data as any).logo_urls || [] } as DioceseRow;
}

// ── Diocese ↔ Church mapping ──

export async function listDioceseChurches(dioceseId: string): Promise<DioceseChurchRow[]> {
  const { data, error } = await db
    .from("diocese_churches")
    .select("id, diocese_id, church_id, added_at")
    .eq("diocese_id", dioceseId)
    .order("added_at", { ascending: true });

  if (error) {
    logger.error({ err: error, dioceseId }, "listDioceseChurches failed");
    throw error;
  }

  const rows = (data || []) as DioceseChurchRow[];

  // Enrich with church info
  if (rows.length) {
    const churchIds = rows.map((r) => r.church_id);
    const { data: churches } = await db
      .from("churches")
      .select("id, name, church_code, location")
      .in("id", churchIds);

    const churchMap = new Map((churches || []).map((c: any) => [c.id, c]));
    for (const row of rows) {
      const c: any = churchMap.get(row.church_id);
      if (c) {
        row.church_name = c.name;
        row.church_code = c.church_code;
        row.church_location = c.location;
      }
    }
  }

  return rows;
}

export async function addChurchesToDiocese(dioceseId: string, churchIds: string[]): Promise<DioceseChurchRow[]> {
  if (!churchIds.length) return [];

  // Verify diocese exists
  const { data: diocese } = await db
    .from("dioceses")
    .select("id")
    .eq("id", dioceseId)
    .maybeSingle();

  if (!diocese) throw new Error("Diocese not found");

  const inserts = churchIds.map((cid) => ({ diocese_id: dioceseId, church_id: cid }));

  const { data, error } = await db
    .from("diocese_churches")
    .insert(inserts)
    .select("id, diocese_id, church_id, added_at");

  if (error) {
    if (error.code === "23505") throw new Error("One or more churches are already assigned to a diocese");
    logger.error({ err: error, dioceseId }, "addChurchesToDiocese failed");
    throw error;
  }

  return (data || []) as DioceseChurchRow[];
}

export async function removeChurchFromDiocese(dioceseId: string, churchId: string): Promise<{ success: boolean }> {
  const { error } = await db
    .from("diocese_churches")
    .delete()
    .eq("diocese_id", dioceseId)
    .eq("church_id", churchId);

  if (error) {
    logger.error({ err: error, dioceseId, churchId }, "removeChurchFromDiocese failed");
    throw error;
  }

  return { success: true };
}

// ── Diocese Leadership ──

export async function listDioceseLeaders(dioceseId: string, activeOnly = true): Promise<DioceseLeaderRow[]> {
  let query = db
    .from("diocese_leadership")
    .select("id, diocese_id, role, full_name, phone_number, email, bio, photo_url, is_active, assigned_by, created_at, updated_at")
    .eq("diocese_id", dioceseId);

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    logger.error({ err: error, dioceseId }, "listDioceseLeaders failed");
    throw error;
  }

  // Sort by role hierarchy
  const roleOrder = new Map(DIOCESE_ROLES.map((r, i) => [r as string, i]));
  const leaders = (data || []) as DioceseLeaderRow[];
  leaders.sort((a, b) => (roleOrder.get(a.role as string) ?? 99) - (roleOrder.get(b.role as string) ?? 99));

  return leaders;
}

export interface CreateDioceseLeaderInput {
  diocese_id: string;
  role: string;
  full_name: string;
  phone_number?: string;
  email?: string;
  bio?: string;
  photo_url?: string;
  assigned_by?: string;
}

export async function createDioceseLeader(input: CreateDioceseLeaderInput): Promise<DioceseLeaderRow> {
  if (!DIOCESE_ROLES.includes(input.role as DioceseRole)) {
    throw new Error(`Invalid diocese role. Must be one of: ${DIOCESE_ROLES.join(", ")}`);
  }

  const { data, error } = await db
    .from("diocese_leadership")
    .insert([{
      diocese_id: input.diocese_id,
      role: input.role,
      full_name: input.full_name.trim(),
      phone_number: input.phone_number?.trim() ? normalizeIndianPhone(input.phone_number) : null,
      email: input.email?.trim() || null,
      bio: input.bio?.trim() || null,
      photo_url: input.photo_url?.trim() || null,
      is_active: true,
      assigned_by: input.assigned_by || null,
    }])
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("This person already holds this role in this diocese");
    logger.error({ err: error }, "createDioceseLeader failed");
    throw error;
  }

  return data;
}

export interface UpdateDioceseLeaderInput {
  full_name?: string;
  phone_number?: string;
  email?: string;
  bio?: string;
  photo_url?: string;
  role?: string;
  is_active?: boolean;
}

export async function updateDioceseLeader(
  dioceseId: string,
  leaderId: string,
  input: UpdateDioceseLeaderInput
): Promise<DioceseLeaderRow> {
  if (input.role !== undefined && !DIOCESE_ROLES.includes(input.role as DioceseRole)) {
    throw new Error(`Invalid diocese role. Must be one of: ${DIOCESE_ROLES.join(", ")}`);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.full_name !== undefined) patch.full_name = input.full_name.trim();
  if (input.phone_number !== undefined) patch.phone_number = input.phone_number.trim() ? normalizeIndianPhone(input.phone_number) : null;
  if (input.email !== undefined) patch.email = input.email.trim() || null;
  if (input.bio !== undefined) patch.bio = input.bio.trim() || null;
  if (input.photo_url !== undefined) patch.photo_url = input.photo_url.trim() || null;
  if (input.role !== undefined) patch.role = input.role;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const { data, error } = await db
    .from("diocese_leadership")
    .update(patch)
    .eq("id", leaderId)
    .eq("diocese_id", dioceseId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("Duplicate role assignment");
    logger.error({ err: error, leaderId }, "updateDioceseLeader failed");
    throw error;
  }

  if (!data) throw new Error("Diocese leader not found");
  return data;
}

export async function deleteDioceseLeader(dioceseId: string, leaderId: string): Promise<{ success: boolean }> {
  const { error } = await db
    .from("diocese_leadership")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", leaderId)
    .eq("diocese_id", dioceseId);

  if (error) {
    logger.error({ err: error, leaderId }, "deleteDioceseLeader failed");
    throw error;
  }

  return { success: true };
}

// ── Diocese Logos (max 3) ──

const MAX_DIOCESE_LOGOS = 3;

export async function addDioceseLogo(dioceseId: string, logoUrl: string): Promise<DioceseRow> {
  // Fetch current logos
  const { data: current, error: fetchErr } = await db
    .from("dioceses")
    .select("logo_urls")
    .eq("id", dioceseId)
    .single();

  if (fetchErr || !current) {
    logger.error({ err: fetchErr, dioceseId }, "addDioceseLogo fetch failed");
    throw new Error("Diocese not found");
  }

  const existing: string[] = current.logo_urls || [];
  if (existing.length >= MAX_DIOCESE_LOGOS) {
    throw new Error(`Maximum ${MAX_DIOCESE_LOGOS} logos allowed per diocese`);
  }
  if (existing.includes(logoUrl)) {
    throw new Error("This logo is already added");
  }

  const updated = [...existing, logoUrl];

  const { data, error } = await db
    .from("dioceses")
    .update({ logo_urls: updated, updated_at: new Date().toISOString() })
    .eq("id", dioceseId)
    .select("id, name, logo_url, banner_url, logo_urls, created_by, created_at, updated_at")
    .single();

  if (error) {
    logger.error({ err: error, dioceseId }, "addDioceseLogo update failed");
    throw error;
  }
  if (!data) throw new Error("Diocese not found");
  return { ...data, logo_urls: data.logo_urls || [] };
}

export async function removeDioceseLogo(dioceseId: string, logoUrl: string): Promise<DioceseRow> {
  const { data: current, error: fetchErr } = await db
    .from("dioceses")
    .select("logo_urls")
    .eq("id", dioceseId)
    .single();

  if (fetchErr || !current) {
    logger.error({ err: fetchErr, dioceseId }, "removeDioceseLogo fetch failed");
    throw new Error("Diocese not found");
  }

  const existing: string[] = current.logo_urls || [];
  const updated = existing.filter((u: string) => u !== logoUrl);

  const { data, error } = await db
    .from("dioceses")
    .update({ logo_urls: updated, updated_at: new Date().toISOString() })
    .eq("id", dioceseId)
    .select("id, name, logo_url, banner_url, logo_urls, created_by, created_at, updated_at")
    .single();

  if (error) {
    logger.error({ err: error, dioceseId }, "removeDioceseLogo update failed");
    throw error;
  }
  if (!data) throw new Error("Diocese not found");
  return { ...data, logo_urls: data.logo_urls || [] };
}
