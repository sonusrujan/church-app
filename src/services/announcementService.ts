import { db } from "./dbClient";
import { logger } from "../utils/logger";

export async function postAnnouncement(church_id: string, title: string, message: string, created_by: string) {
  const normalizedTitle = String(title || "").trim().replace(/<[^>]*>/g, "");
  const normalizedMessage = String(message || "").trim().replace(/<[^>]*>/g, "");
  if (!normalizedTitle) {
    throw new Error("Announcement title is required");
  }
  if (!normalizedMessage) {
    throw new Error("Announcement message is required");
  }

  const { data, error } = await db
    .from("announcements")
    .insert([{ church_id, title: normalizedTitle, message: normalizedMessage, created_by }])
    .single();

  if (error) {
    logger.error({ err: error }, "postAnnouncement failed");
    throw error;
  }
  return data;
}

export async function getAnnouncements(church_id: string, limit = 100, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { data, error } = await db
    .from("announcements")
    .select("*")
    .eq("church_id", church_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (error) {
    logger.error({ err: error }, "getAnnouncements failed");
    throw error;
  }
  return data;
}

export async function updateAnnouncement(id: string, church_id: string, title?: string, message?: string) {
  const patch: Record<string, unknown> = {};
  if (typeof title === "string") {
    const v = title.trim().replace(/<[^>]*>/g, "");
    if (!v) throw new Error("Announcement title cannot be empty");
    patch.title = v;
  }
  if (typeof message === "string") {
    const v = message.trim().replace(/<[^>]*>/g, "");
    if (!v) throw new Error("Announcement message cannot be empty");
    patch.message = v;
  }
  if (!Object.keys(patch).length) throw new Error("No fields to update");

  const { data, error } = await db
    .from("announcements")
    .update(patch)
    .eq("id", id)
    .eq("church_id", church_id)
    .select("*")
    .single();

  if (error) {
    logger.error({ err: error }, "updateAnnouncement failed");
    throw error;
  }
  return data;
}

export async function deleteAnnouncement(id: string, church_id: string) {
  const { error } = await db
    .from("announcements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("church_id", church_id)
    .is("deleted_at", null);

  if (error) {
    logger.error({ err: error }, "deleteAnnouncement failed");
    throw error;
  }
  return { deleted: true, id };
}

export async function clearAllAnnouncements(church_id: string) {
  const { error } = await db
    .from("announcements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("church_id", church_id)
    .is("deleted_at", null);

  if (error) {
    logger.error({ err: error }, "clearAllAnnouncements failed");
    throw error;
  }
  return { cleared: true };
}
