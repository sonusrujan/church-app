import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";

export async function sendAnnouncement(church_id: string, title: string, message: string, created_by: string) {
  const { data, error } = await supabaseAdmin
    .from("announcements")
    .insert([{ church_id, title, message, created_by }])
    .single();

  if (error) {
    logger.error({ err: error }, "sendAnnouncement failed");
    throw error;
  }
  return data;
}

export async function getAnnouncements(church_id: string) {
  const { data, error } = await supabaseAdmin
    .from("announcements")
    .select("*")
    .eq("church_id", church_id)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ err: error }, "getAnnouncements failed");
    throw error;
  }
  return data;
}
