import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";
import { SUPER_ADMIN_EMAILS } from "../config";

type ChurchRow = {
  id: string;
  church_code: string | null;
  name: string;
  address: string | null;
  location: string | null;
  contact_phone: string | null;
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
}

export interface UpdateChurchInput {
  name?: string;
  address?: string;
  location?: string;
  contact_phone?: string;
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
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { data, error } = await supabaseAdmin
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

  const hasSuperAdminEmail = normalizedEmails.some((email) => superAdminEmailSet.has(email));
  if (hasSuperAdminEmail) {
    throw new Error("Super admin emails cannot be assigned as church admins");
  }

  const { data: users, error: usersError } = await supabaseAdmin
    .from("users")
    .select("id, email, full_name, role, church_id")
    .in("email", normalizedEmails);

  if (usersError) {
    logger.error({ err: usersError }, "assignAdminsToChurch users lookup failed");
    throw usersError;
  }

  const foundEmails = new Set((users || []).map((row) => normalizeEmail(row.email || "")));
  const missing = normalizedEmails.filter((email) => !foundEmails.has(email));
  if (missing.length) {
    throw new Error(`Admin user not found for emails: ${missing.join(", ")}`);
  }

  const updatedAdmins: UserRow[] = [];
  for (const user of users || []) {
    if (superAdminEmailSet.has(normalizeEmail(user.email || ""))) {
      throw new Error(`Super admin cannot be assigned to church: ${user.email}`);
    }

    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from("users")
      .update({ role: "admin", church_id: churchId })
      .eq("id", user.id)
      .select("id, email, full_name, role, church_id")
      .single<UserRow>();

    if (updateError) {
      logger.error({ err: updateError, userId: user.id }, "assignAdminsToChurch update failed");
      throw updateError;
    }

    updatedAdmins.push(updatedUser);
  }

  return updatedAdmins;
}

export async function listChurches(churchId?: string) {
  let query = supabaseAdmin
    .from("churches")
    .select("id, church_code, name, address, location, contact_phone, created_at")
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

  let query = supabaseAdmin
    .from("churches")
    .select("id, church_code, name, address, location, contact_phone, created_at")
    .order("name", { ascending: true })
    .limit(size);

  if (q) {
    const escaped = q.replace(/,/g, "");
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
  const { data, error } = await supabaseAdmin
    .from("churches")
    .select("id, church_code, name, address, location, contact_phone, created_at")
    .eq("id", churchId)
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
  const { data: church, error: churchError } = await supabaseAdmin
    .from("churches")
    .insert([
      {
        church_code: churchCode,
        name: churchName,
        address: input.address?.trim() || null,
        location: input.location?.trim() || null,
        contact_phone: input.contact_phone?.trim() || null,
      },
    ])
    .select("id, church_code, name, address, location, contact_phone, created_at")
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

  if (!Object.keys(patch).length) {
    throw new Error("No church fields provided to update");
  }

  const { data, error } = await supabaseAdmin
    .from("churches")
    .update(patch)
    .eq("id", churchId)
    .select("id, church_code, name, address, location, contact_phone, created_at")
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
    supabaseAdmin.from("users").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    supabaseAdmin.from("members").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    supabaseAdmin.from("pastors").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    supabaseAdmin.from("church_events").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    supabaseAdmin.from("church_notifications").select("id", { count: "exact", head: true }).eq("church_id", churchId),
    supabaseAdmin.from("prayer_requests").select("id", { count: "exact", head: true }).eq("church_id", churchId),
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

  const { data: memberIds, error: memberIdsError } = await supabaseAdmin
    .from("members")
    .select("id")
    .eq("church_id", churchId);

  if (memberIdsError) {
    logger.error({ err: memberIdsError, churchId }, "getChurchDeleteImpact member ids failed");
    throw memberIdsError;
  }

  const memberIdList = (memberIds || []).map((row) => String((row as { id: string }).id)).filter(Boolean);
  let paymentsCount = 0;
  if (memberIdList.length) {
    const { count, error } = await supabaseAdmin
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

  const { data: superAdminRows, error: superAdminRowsError } = await supabaseAdmin
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

  const { error } = await supabaseAdmin.from("churches").delete().eq("id", churchId);
  if (error) {
    logger.error({ err: error, churchId }, "deleteChurch failed");
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
  const [{ data: admins, error: adminsError }, { data: members, error: membersError }, { data: pastors, error: pastorsError }] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("id, email, full_name, role, church_id")
      .eq("role", "admin")
      .in("church_id", churchIds),
    supabaseAdmin
      .from("members")
      .select("id, church_id")
      .in("church_id", churchIds),
    supabaseAdmin
      .from("pastors")
      .select("id, church_id, full_name, phone_number, email, details, is_active")
      .in("church_id", churchIds),
  ]);

  if (adminsError) {
    logger.error({ err: adminsError }, "listChurchesWithStats admins query failed");
    throw adminsError;
  }

  if (membersError) {
    logger.error({ err: membersError }, "listChurchesWithStats members query failed");
    throw membersError;
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
  for (const member of (members || []) as MemberRow[]) {
    if (!member.church_id) {
      continue;
    }
    memberCountsByChurch.set(member.church_id, (memberCountsByChurch.get(member.church_id) || 0) + 1);
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
