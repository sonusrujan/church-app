import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";

export type PastorRow = {
  id: string;
  church_id: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  details: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
};

export interface CreatePastorInput {
  church_id: string;
  full_name: string;
  phone_number: string;
  email?: string;
  details?: string;
  created_by?: string;
}

export interface UpdatePastorInput {
  full_name?: string;
  phone_number?: string;
  email?: string;
  details?: string;
  is_active?: boolean;
}

async function assertPastorSingleChurchAssignment(input: {
  church_id: string;
  phone_number: string;
  email?: string | null;
  exclude_pastor_id?: string;
}) {
  const churchId = String(input.church_id || "").trim();
  const phoneNumber = String(input.phone_number || "").trim();
  const normalizedEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const excludePastorId = typeof input.exclude_pastor_id === "string" ? input.exclude_pastor_id.trim() : "";

  if (!churchId) {
    throw new Error("church_id is required");
  }

  if (!phoneNumber) {
    throw new Error("Pastor phone number is required");
  }

  const { data: phoneRows, error: phoneError } = await supabaseAdmin
    .from("pastors")
    .select("id, church_id")
    .eq("phone_number", phoneNumber)
    .limit(5);

  if (phoneError) {
    logger.error({ err: phoneError, churchId, phoneNumber }, "assertPastorSingleChurchAssignment phone lookup failed");
    throw phoneError;
  }

  const conflictingPhone = (phoneRows || []).find(
    (row) => row.id !== excludePastorId && row.church_id !== churchId
  );

  if (conflictingPhone) {
    throw new Error("This pastor is already assigned to another church (phone number already exists)");
  }

  const duplicatePhone = (phoneRows || []).find(
    (row) => row.id !== excludePastorId && row.church_id === churchId
  );

  if (duplicatePhone) {
    throw new Error("A pastor with this phone number already exists in this church");
  }

  if (normalizedEmail) {
    const { data: emailRows, error: emailError } = await supabaseAdmin
      .from("pastors")
      .select("id, church_id")
      .ilike("email", normalizedEmail)
      .limit(5);

    if (emailError) {
      logger.error({ err: emailError, churchId, email: normalizedEmail }, "assertPastorSingleChurchAssignment email lookup failed");
      throw emailError;
    }

    const conflictingEmail = (emailRows || []).find(
      (row) => row.id !== excludePastorId && row.church_id !== churchId
    );

    if (conflictingEmail) {
      throw new Error("This pastor is already assigned to another church (email already exists)");
    }

    const duplicateEmail = (emailRows || []).find(
      (row) => row.id !== excludePastorId && row.church_id === churchId
    );

    if (duplicateEmail) {
      throw new Error("A pastor with this email already exists in this church");
    }
  }
}

export async function listPastors(churchId: string, activeOnly = false) {
  let query = supabaseAdmin
    .from("pastors")
    .select("id, church_id, full_name, phone_number, email, details, is_active, created_by, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId }, "listPastors failed");
    throw error;
  }

  return (data || []) as PastorRow[];
}

export async function getPastorById(churchId: string, pastorId: string) {
  const { data, error } = await supabaseAdmin
    .from("pastors")
    .select("id, church_id, full_name, phone_number, email, details, is_active, created_by, created_at")
    .eq("id", pastorId)
    .eq("church_id", churchId)
    .maybeSingle<PastorRow>();

  if (error) {
    logger.error({ err: error, churchId, pastorId }, "getPastorById failed");
    throw error;
  }

  return data;
}

export async function createPastor(input: CreatePastorInput) {
  const churchId = String(input.church_id || "").trim();
  const fullName = String(input.full_name || "").trim();
  const phoneNumber = String(input.phone_number || "").trim();
  const email = input.email?.trim() || "";

  if (!churchId) {
    throw new Error("church_id is required");
  }

  if (!fullName) {
    throw new Error("Pastor name is required");
  }

  if (!phoneNumber) {
    throw new Error("Pastor phone number is required");
  }

  await assertPastorSingleChurchAssignment({
    church_id: churchId,
    phone_number: phoneNumber,
    email,
  });

  const { data, error } = await supabaseAdmin
    .from("pastors")
    .insert([
      {
        church_id: churchId,
        full_name: fullName,
        phone_number: phoneNumber,
        email: email || null,
        details: input.details?.trim() || null,
        created_by: input.created_by || null,
      },
    ])
    .select("id, church_id, full_name, phone_number, email, details, is_active, created_by, created_at")
    .single<PastorRow>();

  if (error) {
    logger.error({ err: error, churchId: input.church_id }, "createPastor failed");
    throw error;
  }

  return data;
}

export async function updatePastor(churchId: string, pastorId: string, input: UpdatePastorInput) {
  const patch: Record<string, unknown> = {};

  if (typeof input.full_name === "string") {
    const fullName = input.full_name.trim();
    if (!fullName) {
      throw new Error("Pastor name cannot be empty");
    }
    patch.full_name = fullName;
  }

  if (typeof input.phone_number === "string") {
    const phoneNumber = input.phone_number.trim();
    if (!phoneNumber) {
      throw new Error("Pastor phone number cannot be empty");
    }
    patch.phone_number = phoneNumber;
  }

  if (typeof input.email === "string") {
    patch.email = input.email.trim() || null;
  }

  if (typeof input.details === "string") {
    patch.details = input.details.trim() || null;
  }

  if (typeof input.is_active === "boolean") {
    patch.is_active = input.is_active;
  }

  if (!Object.keys(patch).length) {
    throw new Error("No pastor fields provided to update");
  }

  const { data: existingPastor, error: existingPastorError } = await supabaseAdmin
    .from("pastors")
    .select("id, church_id, phone_number, email")
    .eq("id", pastorId)
    .eq("church_id", churchId)
    .maybeSingle<{ id: string; church_id: string; phone_number: string; email: string | null }>();

  if (existingPastorError) {
    logger.error({ err: existingPastorError, churchId, pastorId }, "updatePastor lookup failed");
    throw existingPastorError;
  }

  if (!existingPastor) {
    throw new Error("Pastor not found in this church");
  }

  const finalPhoneNumber =
    typeof patch.phone_number === "string" ? String(patch.phone_number) : existingPastor.phone_number;
  const finalEmail =
    patch.email !== undefined
      ? (patch.email as string | null)
      : existingPastor.email;

  await assertPastorSingleChurchAssignment({
    church_id: churchId,
    phone_number: finalPhoneNumber,
    email: finalEmail,
    exclude_pastor_id: pastorId,
  });

  const { data, error } = await supabaseAdmin
    .from("pastors")
    .update(patch)
    .eq("id", pastorId)
    .eq("church_id", churchId)
    .select("id, church_id, full_name, phone_number, email, details, is_active, created_by, created_at")
    .single<PastorRow>();

  if (error) {
    logger.error({ err: error, churchId, pastorId }, "updatePastor failed");
    throw error;
  }

  return data;
}

export async function transferPastor(input: {
  pastor_id: string;
  from_church_id: string;
  to_church_id: string;
}) {
  const pastorId = String(input.pastor_id || "").trim();
  const fromChurchId = String(input.from_church_id || "").trim();
  const toChurchId = String(input.to_church_id || "").trim();

  if (!pastorId || !fromChurchId || !toChurchId) {
    throw new Error("pastor_id, from_church_id and to_church_id are required");
  }

  if (fromChurchId === toChurchId) {
    throw new Error("Pastor is already assigned to this church");
  }

  const pastor = await getPastorById(fromChurchId, pastorId);
  if (!pastor) {
    throw new Error("Pastor not found in source church");
  }

  const { data: targetChurch, error: targetChurchError } = await supabaseAdmin
    .from("churches")
    .select("id")
    .eq("id", toChurchId)
    .maybeSingle<{ id: string }>();

  if (targetChurchError) {
    logger.error({ err: targetChurchError, toChurchId }, "transferPastor target church lookup failed");
    throw targetChurchError;
  }

  if (!targetChurch) {
    throw new Error("Target church not found");
  }

  await assertPastorSingleChurchAssignment({
    church_id: toChurchId,
    phone_number: pastor.phone_number,
    email: pastor.email,
    exclude_pastor_id: pastorId,
  });

  const { data, error } = await supabaseAdmin
    .from("pastors")
    .update({ church_id: toChurchId })
    .eq("id", pastorId)
    .eq("church_id", fromChurchId)
    .select("id, church_id, full_name, phone_number, email, details, is_active, created_by, created_at")
    .single<PastorRow>();

  if (error) {
    logger.error({ err: error, pastorId, fromChurchId, toChurchId }, "transferPastor failed");
    throw error;
  }

  return data;
}

export async function deletePastor(churchId: string, pastorId: string) {
  const pastor = await getPastorById(churchId, pastorId);
  if (!pastor) {
    throw new Error("Pastor not found in this church");
  }

  const { error } = await supabaseAdmin
    .from("pastors")
    .delete()
    .eq("id", pastorId)
    .eq("church_id", churchId);

  if (error) {
    logger.error({ err: error, churchId, pastorId }, "deletePastor failed");
    throw error;
  }

  return { deleted: true, id: pastorId };
}
