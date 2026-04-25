import { randomInt } from "crypto";
import { db, rawQuery } from "./dbClient";
import { logger } from "../utils/logger";
import { SUPER_ADMIN_EMAILS } from "../config";

type ChurchRow = {
  id: string;
  church_code: string | null;
  name: string;
  address: string | null;
  location: string | null;
  contact_phone: string | null;
  logo_url: string | null;
  created_at: string;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  church_id: string | null;
};

type MemberRow = {
  id: string;
  church_id: string | null;
};

type PastorRow = {
  id: string;
  church_id: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  details: string | null;
  is_active: boolean;
};

export type ChurchSummaryRow = {
  id: string;
  unique_id: string;
  name: string;
  address: string | null;
  location: string | null;
  contact_phone: string | null;
  logo_url: string | null;
  created_at: string;
  admin_count: number;
  member_count: number;
  pastor_count: number;
  admins: Array<{
    id: string;
    email: string;
    full_name: string | null;
  }>;
  pastors: Array<{
    id: string;
    full_name: string;
    phone_number: string;
    email: string | null;
    details: string | null;
    is_active: boolean;
  }>;
};

export interface CreateChurchInput {
  name: string;
  address?: string;
  location?: string;
  contact_phone?: string;
  admin_emails?: string[];
  logo_url?: string;
  member_subscription_enabled?: boolean;
  church_subscription_enabled?: boolean;
  church_subscription_amount?: number;
  platform_fee_enabled?: boolean;
  platform_fee_percentage?: number;
  service_enabled?: boolean;
}

export interface UpdateChurchInput {
  name?: string;
  address?: string;
  location?: string;
  contact_phone?: string;
  church_code?: string;
  logo_url?: string;
}

export type ChurchDeleteImpact = {
  users: number;
  members: number;
  pastors: number;
  church_events: number;
  church_notifications: number;
  prayer_requests: number;
  payments: number;
};

const superAdminEmailSet = new Set(SUPER_ADMIN_EMAILS.map((email) => email.toLowerCase()));

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function generateUniqueChurchCode() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const code = String(randomInt(10000000, 100000000));
    const { data, error } = await db
      .from("churches")
      .select("id")
      .eq("church_code", code)
      .maybeSingle();

    if (error) {
      logger.error({ err: error }, "generateUniqueChurchCode lookup failed");
      throw error;
    }

    if (!data) {
      return code;
    }
  }

  throw new Error("Unable to generate unique church code. Retry request.");
}

async function assignAdminsToChurch(churchId: string, adminEmails: string[]) {
  const normalizedEmails = Array.from(
    new Set(
      adminEmails
        .map((email) => normalizeEmail(String(email || "")))
        .filter(Boolean)
    )
  );

  if (!normalizedEmails.length) {
    return [] as UserRow[];
  }

  // Validate email format on backend side
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const badFormat = normalizedEmails.filter((e) => !EMAIL_RE.test(e));
  if (badFormat.length) {
    throw new Error(`Invalid email format: ${badFormat.join(", ")}`);
  }

  const hasSuperAdminEmail = normalizedEmails.some((email) => superAdminEmailSet.has(email));
  if (hasSuperAdminEmail) {
    throw new Error("Super admin emails cannot be assigned as church admins");
  }

  const { data: users, error: usersError } = await db
    .from("users")
    .select("id, email, full_name, role, church_id")
    .in("email", normalizedEmails);

  if (usersError) {
    logger.error({ err: usersError }, "assignAdminsToChurch users lookup failed");
    throw usersError;
  }

  const foundEmails = new Set((users || []).map((row: any) => normalizeEmail(row.email || "")));
  const missing = normalizedEmails.filter((email) => !foundEmails.has(email));
  if (missing.length) {
    throw new Error(`Admin user not found for emails: ${missing.join(", ")}`);
  }

  // Check if any user already belongs to a DIFFERENT church
  const alreadyAssigned = (users || []).filter(
    (u: any) => u.church_id && u.church_id !== churchId
  );
  if (alreadyAssigned.length) {
    const names = alreadyAssigned.map((u: any) => u.email).join(", ");
    throw new Error(`These users already belong to another church: ${names}. Remove them from their current church first.`);
  }

  const userIds = (users || []).map((u: any) => u.id);
  const { data: updatedAdmins, error: updateError } = await db
    .from("users")
    .update({ role: "admin", church_id: churchId })
    .in("id", userIds)
    .select("id, email, full_name, role, church_id");

  if (updateError) {
    logger.error({ err: updateError, userIds }, "assignAdminsToChurch batch update failed");
    throw updateError;
  }

  return (updatedAdmins || []) as UserRow[];
}

export async function listChurches(churchId?: string) {
  let query = db
    .from("churches")
    .select("id, church_code, name, address, location, contact_phone, logo_url, created_at")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (churchId) {
    query = query.eq("id", churchId);
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId }, "listChurches failed");
    throw error;
  }

  return data;
}

export async function searchChurches(queryText: string, limit = 50) {
  const q = queryText.trim();
  const size = Math.min(Math.max(limit, 1), 200);

  let query = db
    .from("churches")
    .select("id, church_code, name, address, location, contact_phone, logo_url, created_at")
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .limit(size);

  if (q) {
    const escaped = q.replace(/,/g, "").replace(/_/g, "\\_");
    query = query.or(
      `name.ilike.%${escaped}%,church_code.ilike.%${escaped}%,address.ilike.%${escaped}%,location.ilike.%${escaped}%,contact_phone.ilike.%${escaped}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, query: q }, "searchChurches failed");
    throw error;
  }

  return (data || []) as ChurchRow[];
}

export async function getChurchById(churchId: string) {
  const { data, error } = await db
    .from("churches")
    .select("id, church_code, name, address, location, contact_phone, logo_url, created_at")
    .eq("id", churchId)
    .is("deleted_at", null)
    .maybeSingle<ChurchRow>();

  if (error) {
    logger.error({ err: error, churchId }, "getChurchById failed");
    throw error;
  }

  return data;
}

export async function createChurch(input: CreateChurchInput) {
  const churchName = String(input.name || "").trim();
  if (!churchName) {
    throw new Error("Church name is required");
  }

  const churchCode = await generateUniqueChurchCode();

  const insertPayload: Record<string, unknown> = {
    church_code: churchCode,
    name: churchName,
    address: input.address?.trim() || null,
    location: input.location?.trim() || null,
    contact_phone: input.contact_phone?.trim() || null,
    logo_url: input.logo_url?.trim() || null,
  };

  // SaaS toggles
  if (typeof input.member_subscription_enabled === "boolean") {
    insertPayload.member_subscription_enabled = input.member_subscription_enabled;
  }
  if (typeof input.church_subscription_enabled === "boolean") {
    insertPayload.church_subscription_enabled = input.church_subscription_enabled;
  }
  if (typeof input.church_subscription_amount === "number" && input.church_subscription_amount >= 0) {
    insertPayload.church_subscription_amount = input.church_subscription_amount;
  }
  if (typeof input.platform_fee_enabled === "boolean") {
    insertPayload.platform_fee_enabled = input.platform_fee_enabled;
  }
  if (typeof input.platform_fee_percentage === "number" && input.platform_fee_percentage >= 0) {
    insertPayload.platform_fee_percentage = input.platform_fee_percentage;
  }
  if (typeof input.service_enabled === "boolean") {
    insertPayload.service_enabled = input.service_enabled;
  }

  const { data: church, error: churchError } = await db
    .from("churches")
    .insert([insertPayload])
    .select("id, church_code, name, address, location, contact_phone, logo_url, created_at")
    .single<ChurchRow>();

  if (churchError) {
    logger.error({ err: churchError, churchName }, "createChurch failed");
    throw churchError;
  }

  const assignedAdmins = await assignAdminsToChurch(church.id, input.admin_emails || []);
  return {
    church,
    assigned_admins: assignedAdmins,
  };
}

export async function updateChurch(churchId: string, input: UpdateChurchInput) {
  const patch: Record<string, unknown> = {};

  if (typeof input.name === "string") {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Church name cannot be empty");
    }
    patch.name = name;
  }

  if (typeof input.address === "string") {
    patch.address = input.address.trim() || null;
  }

  if (typeof input.location === "string") {
    patch.location = input.location.trim() || null;
  }

  if (typeof input.contact_phone === "string") {
    patch.contact_phone = input.contact_phone.trim() || null;
  }

  if (typeof input.logo_url === "string") {
    patch.logo_url = input.logo_url.trim() || null;
  }

  if (typeof input.church_code === "string") {
    const code = input.church_code.trim();
    if (!/^\d{8}$/.test(code)) {
      throw new Error("Church code must be exactly 8 digits");
    }
    // Check uniqueness
    const { data: existing } = await db
      .from("churches")
      .select("id")
      .eq("church_code", code)
      .neq("id", churchId)
      .maybeSingle();
    if (existing) {
      throw new Error("Church code already in use by another church");
    }
    patch.church_code = code;
  }

  if (!Object.keys(patch).length) {
    throw new Error("No church fields provided to update");
  }

  const { data, error } = await db
    .from("churches")
    .update(patch)
    .eq("id", churchId)
    .select("id, church_code, name, address, location, contact_phone, logo_url, created_at")
    .single<ChurchRow>();

  if (error) {
    logger.error({ err: error, churchId }, "updateChurch failed");
    throw error;
  }

  return data;
}

export async function getChurchDeleteImpact(churchId: string): Promise<ChurchDeleteImpact> {
  const church = await getChurchById(churchId);
  if (!church) {
    throw new Error("Church not found");
  }

  const [{ count: usersCount, error: usersError }, { count: membersCount, error: membersError }, { count: pastorsCount, error: pastorsError }, { count: eventsCount, error: eventsError }, { count: notificationsCount, error: notificationsError }, { count: prayerCount, error: prayerError }] = await Promise.all([
    db.from("users").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    db.from("members").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    db.from("pastors").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    db.from("church_events").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    db.from("church_notifications").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    db.from("prayer_requests").select("id", { count: "exact", head: true }).eq("church_id", churchId),
  ]);

  if (usersError || membersError || pastorsError || eventsError || notificationsError || prayerError) {
    logger.error(
      {
        usersError,
        membersError,
        pastorsError,
        eventsError,
        notificationsError,
        prayerError,
        churchId,
      },
      "getChurchDeleteImpact failed"
    );
    throw usersError || membersError || pastorsError || eventsError || notificationsError || prayerError;
  }

  const { data: memberIds, error: memberIdsError } = await db
    .from("members")
    .select("id")
    .eq("church_id", churchId);

  if (memberIdsError) {
    logger.error({ err: memberIdsError, churchId }, "getChurchDeleteImpact member ids failed");
    throw memberIdsError;
  }

  const memberIdList = (memberIds || []).map((row: any) => String((row as { id: string }).id)).filter(Boolean);
  let paymentsCount = 0;
  if (memberIdList.length) {
    const { count, error } = await db
      .from("payments")
      .select("id", { count: "exact", head: true })
      .in("member_id", memberIdList);

    if (error) {
      logger.error({ err: error, churchId }, "getChurchDeleteImpact payments count failed");
      throw error;
    }

    paymentsCount = count || 0;
  }

  return {
    users: usersCount || 0,
    members: membersCount || 0,
    pastors: pastorsCount || 0,
    church_events: eventsCount || 0,
    church_notifications: notificationsCount || 0,
    prayer_requests: prayerCount || 0,
    payments: paymentsCount,
  };
}

export async function deleteChurch(churchId: string) {
  const church = await getChurchById(churchId);
  if (!church) {
    throw new Error("Church not found");
  }

  const { data: superAdminRows, error: superAdminRowsError } = await db
    .from("users")
    .select("id, email")
    .eq("church_id", churchId)
    .in("email", Array.from(superAdminEmailSet));

  if (superAdminRowsError) {
    logger.error({ err: superAdminRowsError, churchId }, "deleteChurch super-admin guard lookup failed");
    throw superAdminRowsError;
  }

  if ((superAdminRows || []).length) {
    throw new Error("Cannot delete church while a super admin user is mapped to it");
  }

  const { error } = await db
    .from("churches")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", churchId);
  if (error) {
    logger.error({ err: error, churchId }, "deleteChurch (soft) failed");
    throw error;
  }

  return { deleted: true, id: churchId };
}

export async function listChurchesWithStats(churchId?: string) {
  const churches = (await listChurches(churchId)) as ChurchRow[];
  if (!churches.length) {
    return [] as ChurchSummaryRow[];
  }

  const churchIds = churches.map((church) => church.id);
  const [{ data: admins, error: adminsError }, memberCountResult, { data: pastors, error: pastorsError }] = await Promise.all([
    db
      .from("users")
      .select("id, email, full_name, role, church_id")
      .eq("role", "admin")
      .in("church_id", churchIds),
    rawQuery<{ church_id: string; cnt: string }>(
      `SELECT church_id, COUNT(*)::text AS cnt FROM members WHERE church_id = ANY($1) GROUP BY church_id`,
      [churchIds],
    ),
    db
      .from("pastors")
      .select("id, church_id, full_name, phone_number, email, details, is_active")
      .in("church_id", churchIds),
  ]);

  if (adminsError) {
    logger.error({ err: adminsError }, "listChurchesWithStats admins query failed");
    throw adminsError;
  }

  if (pastorsError) {
    logger.error({ err: pastorsError }, "listChurchesWithStats pastors query failed");
    throw pastorsError;
  }

  const adminsByChurch = new Map<string, UserRow[]>();
  for (const admin of (admins || []) as UserRow[]) {
    if (!admin.church_id) {
      continue;
    }

    if (superAdminEmailSet.has(normalizeEmail(admin.email || ""))) {
      continue;
    }

    const rows = adminsByChurch.get(admin.church_id) || [];
    rows.push(admin);
    adminsByChurch.set(admin.church_id, rows);
  }

  const memberCountsByChurch = new Map<string, number>();
  for (const row of memberCountResult.rows) {
    memberCountsByChurch.set(row.church_id, Number(row.cnt) || 0);
  }

  const pastorsByChurch = new Map<string, PastorRow[]>();
  for (const pastor of (pastors || []) as PastorRow[]) {
    const rows = pastorsByChurch.get(pastor.church_id) || [];
    rows.push(pastor);
    pastorsByChurch.set(pastor.church_id, rows);
  }

  return churches.map((church) => {
    const churchAdmins = adminsByChurch.get(church.id) || [];
    const churchPastors = pastorsByChurch.get(church.id) || [];

    return {
      id: church.id,
      unique_id: church.church_code || "",
      name: church.name,
      address: church.address,
      location: church.location,
      contact_phone: church.contact_phone,
      logo_url: church.logo_url,
      created_at: church.created_at,
      admin_count: churchAdmins.length,
      member_count: memberCountsByChurch.get(church.id) || 0,
      pastor_count: churchPastors.length,
      admins: churchAdmins.map((admin) => ({
        id: admin.id,
        email: admin.email,
        full_name: admin.full_name,
      })),
      pastors: churchPastors.map((pastor) => ({
        id: pastor.id,
        full_name: pastor.full_name,
        phone_number: pastor.phone_number,
        email: pastor.email,
        details: pastor.details,
        is_active: pastor.is_active,
      })),
    };
  });
}

// ── Restore soft-deleted church ──

export async function restoreChurch(churchId: string) {
  // Look up including deleted
  const { data: church, error: findErr } = await db
    .from("churches")
    .select("id, deleted_at")
    .eq("id", churchId)
    .maybeSingle<{ id: string; deleted_at: string | null }>();

  if (findErr) throw findErr;
  if (!church) throw new Error("Church not found");
  if (!church.deleted_at) throw new Error("Church is not deleted");

  const { error } = await db
    .from("churches")
    .update({ deleted_at: null })
    .eq("id", churchId);

  if (error) {
    logger.error({ err: error, churchId }, "restoreChurch failed");
    throw error;
  }

  return { restored: true, id: churchId };
}
