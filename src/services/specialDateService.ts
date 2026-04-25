import { db, rawQuery } from "./dbClient";
import { logger } from "../utils/logger";

export interface SpecialDateRow {
  id: string;
  member_id: string;
  church_id: string;
  occasion_type: "birthday" | "anniversary";
  occasion_date: string;
  person_name: string;
  spouse_name: string | null;
  notes: string | null;
  is_from_profile: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSpecialDateInput {
  member_id: string;
  church_id: string;
  occasion_type: "birthday" | "anniversary";
  occasion_date: string;
  person_name: string;
  spouse_name?: string;
  notes?: string;
  is_from_profile?: boolean;
}

// ── CRUD ──

export async function createSpecialDate(input: CreateSpecialDateInput): Promise<SpecialDateRow> {
  if (input.occasion_type === "anniversary" && !input.spouse_name?.trim()) {
    throw new Error("Spouse name is required for anniversary");
  }

  const { data, error } = await db
    .from("member_special_dates")
    .insert([{
      member_id: input.member_id,
      church_id: input.church_id,
      occasion_type: input.occasion_type,
      occasion_date: input.occasion_date,
      person_name: input.person_name.trim(),
      spouse_name: input.occasion_type === "anniversary" ? (input.spouse_name?.trim() || null) : null,
      notes: input.notes?.trim() || null,
      is_from_profile: input.is_from_profile || false,
    }])
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("This special date already exists for this member");
    }
    logger.error({ err: error }, "createSpecialDate failed");
    throw error;
  }
  return data as SpecialDateRow;
}

export async function listSpecialDates(memberId: string, churchId: string): Promise<SpecialDateRow[]> {
  const { data, error } = await db
    .from("member_special_dates")
    .select("*")
    .eq("member_id", memberId)
    .eq("church_id", churchId)
    .order("occasion_date", { ascending: true });

  if (error) {
    logger.error({ err: error }, "listSpecialDates failed");
    throw error;
  }
  return (data || []) as SpecialDateRow[];
}

export async function updateSpecialDate(
  id: string,
  churchId: string,
  fields: Partial<Pick<CreateSpecialDateInput, "occasion_type" | "occasion_date" | "person_name" | "spouse_name" | "notes">>,
): Promise<SpecialDateRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.occasion_type !== undefined) update.occasion_type = fields.occasion_type;
  if (fields.occasion_date !== undefined) update.occasion_date = fields.occasion_date;
  if (fields.person_name !== undefined) update.person_name = fields.person_name.trim();
  if (fields.spouse_name !== undefined) update.spouse_name = fields.spouse_name?.trim() || null;
  if (fields.notes !== undefined) update.notes = fields.notes?.trim() || null;

  const { data, error } = await db
    .from("member_special_dates")
    .update(update)
    .eq("id", id)
    .eq("church_id", churchId)
    .select("*")
    .single();

  if (error) {
    logger.error({ err: error }, "updateSpecialDate failed");
    throw error;
  }
  if (!data) throw new Error("Special date not found");
  return data as SpecialDateRow;
}

export async function deleteSpecialDate(id: string, churchId: string): Promise<void> {
  const { error } = await db
    .from("member_special_dates")
    .delete()
    .eq("id", id)
    .eq("church_id", churchId);

  if (error) {
    logger.error({ err: error }, "deleteSpecialDate failed");
    throw error;
  }
}

// ── Check if a DOB date already exists ──

export async function checkDobDuplicate(
  memberId: string,
  occasionDate: string,
): Promise<{ isDuplicate: boolean; memberDob: string | null }> {
  const { data } = await db
    .from("members")
    .select("dob")
    .eq("id", memberId)
    .single();

  const memberDob = (data as any)?.dob || null;
  if (!memberDob) return { isDuplicate: false, memberDob: null };

  // Compare date portions only (YYYY-MM-DD)
  const normalizedDob = memberDob.slice(0, 10);
  const normalizedInput = occasionDate.slice(0, 10);
  return { isDuplicate: normalizedDob === normalizedInput, memberDob: normalizedDob };
}

// ── Admin: list special dates for export ──

export async function listSpecialDatesForExport(
  churchId: string,
  range: "weekly" | "monthly" | "yearly",
): Promise<Array<SpecialDateRow & { member_name: string; member_email: string; member_phone: string | null }>> {
  // Determine date range filter based on month/day recurrence
  let dateFilter: string;
  if (range === "weekly") {
    // Next 7 days from today, matching month+day
    dateFilter = `
      AND (
        TO_CHAR(sd.occasion_date, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD')
        AND TO_CHAR(sd.occasion_date, 'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
      )
    `;
    // Handle year boundary (Dec→Jan)
    dateFilter = `
      AND (
        CASE
          WHEN TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD')
          THEN TO_CHAR(sd.occasion_date, 'MM-DD') BETWEEN TO_CHAR(CURRENT_DATE, 'MM-DD') AND TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
          ELSE TO_CHAR(sd.occasion_date, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD')
            OR TO_CHAR(sd.occasion_date, 'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'MM-DD')
        END
      )
    `;
  } else if (range === "monthly") {
    dateFilter = `AND EXTRACT(MONTH FROM sd.occasion_date) = EXTRACT(MONTH FROM CURRENT_DATE)`;
  } else {
    // yearly = all dates
    dateFilter = "";
  }

  const sql = `
    SELECT * FROM (
      SELECT
        sd.*,
        m.full_name AS member_name,
        m.email AS member_email,
        m.phone_number AS member_phone
      FROM member_special_dates sd
      JOIN members m ON m.id = sd.member_id AND m.deleted_at IS NULL
      WHERE sd.church_id = $1
      ${dateFilter}
      UNION ALL
      SELECT
        uuid_generate_v4() AS id,
        m.id AS member_id,
        m.church_id,
        'birthday' AS occasion_type,
        m.dob AS occasion_date,
        m.full_name AS person_name,
        NULL AS spouse_name,
        'Auto from profile DOB' AS notes,
        true AS is_from_profile,
        m.created_at,
        m.created_at AS updated_at,
        m.full_name AS member_name,
        m.email AS member_email,
        m.phone_number AS member_phone
      FROM members m
      WHERE m.church_id = $1
        AND m.dob IS NOT NULL
        AND m.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM member_special_dates sd2
          WHERE sd2.member_id = m.id
            AND sd2.occasion_type = 'birthday'
            AND sd2.occasion_date = m.dob
        )
        ${dateFilter ? dateFilter.replace(/sd\.occasion_date/g, "m.dob") : ""}
    ) combined
    ORDER BY
      EXTRACT(MONTH FROM occasion_date),
      EXTRACT(DAY FROM occasion_date),
      person_name
  `;

  const { rows } = await rawQuery<SpecialDateRow & { member_name: string; member_email: string; member_phone: string | null }>(sql, [churchId]);
  return rows;
}
