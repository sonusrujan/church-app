import { db } from "./dbClient";
import { logger } from "../utils/logger";

export interface AdBannerRow {
  id: string;
  scope: "diocese" | "church";
  scope_id: string;
  image_url: string;
  media_type: "image" | "video" | "gif";
  position: "top" | "bottom";
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAdBanners(
  scope: "diocese" | "church",
  scopeId: string,
  activeOnly = true,
): Promise<AdBannerRow[]> {
  let query = db
    .from("ad_banners")
    .select("*")
    .eq("scope", scope)
    .eq("scope_id", scopeId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error }, "listAdBanners failed");
    throw error;
  }
  return (data || []) as AdBannerRow[];
}

export async function createAdBanner(input: {
  scope: "diocese" | "church";
  scope_id: string;
  image_url: string;
  media_type?: "image" | "video" | "gif";
  position?: "top" | "bottom";
  link_url?: string;
  sort_order?: number;
  created_by?: string;
  start_date?: string;
  end_date?: string;
}): Promise<AdBannerRow> {
  const row: Record<string, unknown> = {
    scope: input.scope,
    scope_id: input.scope_id,
    image_url: input.image_url,
    media_type: input.media_type || "image",
    position: input.position || "bottom",
    link_url: input.link_url || null,
    sort_order: input.sort_order ?? 0,
    created_by: input.created_by || null,
  };
  if (input.start_date) row.start_date = input.start_date;
  if (input.end_date) row.end_date = input.end_date;

  const { data, error } = await db
    .from("ad_banners")
    .insert([row])
    .select("*")
    .single();

  if (error) {
    logger.error({ err: error }, "createAdBanner failed");
    throw error;
  }
  return data as AdBannerRow;
}

export async function updateAdBanner(
  id: string,
  fields: { image_url?: string; media_type?: string; position?: string; link_url?: string | null; sort_order?: number; is_active?: boolean; start_date?: string | null; end_date?: string | null },
): Promise<AdBannerRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.image_url !== undefined) update.image_url = fields.image_url;
  if (fields.media_type !== undefined) update.media_type = fields.media_type;
  if (fields.position !== undefined) update.position = fields.position;
  if (fields.link_url !== undefined) update.link_url = fields.link_url;
  if (fields.sort_order !== undefined) update.sort_order = fields.sort_order;
  if (fields.is_active !== undefined) update.is_active = fields.is_active;
  if (fields.start_date !== undefined) update.start_date = fields.start_date;
  if (fields.end_date !== undefined) update.end_date = fields.end_date;

  const { data, error } = await db
    .from("ad_banners")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    logger.error({ err: error }, "updateAdBanner failed");
    throw error;
  }
  if (!data) throw new Error("Banner not found");
  return data as AdBannerRow;
}

export async function deleteAdBanner(id: string): Promise<{ success: boolean }> {
  const { error } = await db
    .from("ad_banners")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) {
    logger.error({ err: error }, "deleteAdBanner failed");
    throw error;
  }
  return { success: true };
}

export async function restoreAdBanner(id: string): Promise<{ success: boolean }> {
  const { error } = await db
    .from("ad_banners")
    .update({ deleted_at: null })
    .eq("id", id)
    .not("deleted_at", "is", null);

  if (error) {
    logger.error({ err: error }, "restoreAdBanner failed");
    throw error;
  }
  return { success: true };
}
