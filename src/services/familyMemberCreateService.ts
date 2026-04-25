import { db, getClient } from "./dbClient";
import { logger } from "../utils/logger";
import { normalizeIndianPhone } from "../utils/phone";

/**
 * Family Member CREATE Requests (1.5)
 * Allows a member to request that admin create a NEW member record (e.g. for a family member
 * who doesn't exist in the system yet). Different from familyRequestService which links existing members.
 */

export interface CreateFamilyMemberRequestInput {
  requester_member_id: string;
  church_id: string;
  full_name: string;
  phone_number?: string;
  email?: string;
  date_of_birth?: string;
  relation: string;
  address?: string;
  notes?: string;
}

export async function submitFamilyMemberCreateRequest(input: CreateFamilyMemberRequestInput) {
  const fullName = (input.full_name || "").trim();
  if (!fullName) throw new Error("Full name is required");

  const relation = (input.relation || "").trim();
  if (!relation) throw new Error("Relation is required");

  const { data, error } = await db
    .from("family_member_create_requests")
    .insert({
      requester_member_id: input.requester_member_id,
      church_id: input.church_id,
      full_name: fullName,
      phone_number: input.phone_number?.trim() ? normalizeIndianPhone(input.phone_number) : null,
      email: input.email?.trim().toLowerCase() || null,
      date_of_birth: input.date_of_birth || null,
      relation,
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    logger.error({ err: error }, "submitFamilyMemberCreateRequest failed");
    throw error;
  }

  // Notify admin via church notification
  try {
    const { data: requester } = await db
      .from("members")
      .select("full_name")
      .eq("id", input.requester_member_id)
      .single();

    await db.from("church_notifications").insert({
      church_id: input.church_id,
      title: "New Family Member Registration Request",
      message: `${requester?.full_name || "A member"} has requested to register ${fullName} (${relation}) as a new member.`,
    });
  } catch (e) {
    logger.warn({ err: e }, "Failed to notify admin about family member create request");
  }

  return data;
}

export async function listFamilyMemberCreateRequests(churchId: string, status?: string) {
  let query = db
    .from("family_member_create_requests")
    .select("*")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId }, "listFamilyMemberCreateRequests failed");
    throw error;
  }

  if (!data?.length) return [];

  // Enrich with requester names
  const requesterIds = [...new Set(data.map((r: any) => r.requester_member_id))];
  const { data: members } = await db
    .from("members")
    .select("id, full_name")
    .in("id", requesterIds);

  const nameMap = new Map<string, string>();
  for (const m of members || []) nameMap.set(m.id, m.full_name);

  return data.map((r: any) => ({
    ...r,
    requester_name: nameMap.get(r.requester_member_id) || "Unknown",
  }));
}

export async function listMyFamilyMemberCreateRequests(requesterMemberId: string) {
  const { data, error } = await db
    .from("family_member_create_requests")
    .select("*")
    .eq("requester_member_id", requesterMemberId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error }, "listMyFamilyMemberCreateRequests failed");
    throw error;
  }

  return data || [];
}

export async function reviewFamilyMemberCreateRequest(
  requestId: string,
  decision: "approved" | "rejected",
  reviewerUserId: string,
  reviewNotes?: string,
  callerChurchId?: string
) {
  const { data: req, error: fetchErr } = await db
    .from("family_member_create_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (fetchErr || !req) throw new Error("Request not found");
  if (req.status !== "pending") throw new Error(`Request already ${req.status}`);

  // Verify the reviewer belongs to the same church as the request
  if (callerChurchId && req.church_id !== callerChurchId) {
    throw new Error("Not authorized to review requests from another church");
  }

  if (decision === "rejected") {
    const { data, error } = await db
      .from("family_member_create_requests")
      .update({
        status: "rejected",
        reviewed_by: reviewerUserId,
        review_notes: reviewNotes || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select("*")
      .single();

    if (error) throw error;

    // Notify the requester about the rejection
    try {
      await db.from("church_notifications").insert({
        church_id: req.church_id,
        title: "Family Member Request Rejected",
        message: `Your request to register ${req.full_name} (${req.relation}) was rejected.${reviewNotes ? ` Reason: ${reviewNotes}` : ""}`,
      });
    } catch (e) {
      logger.warn({ err: e }, "Failed to notify requester about family member rejection");
    }

    return { request: data, created_member: null };
  }

  // Approved: create the member + link as family member + update request atomically
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // MED-12: Check for duplicate member before creating (same phone or email in same church)
    const normalizedPhone = req.phone_number?.trim() ? normalizeIndianPhone(req.phone_number) : null;
    const normalizedEmail = req.email?.trim()?.toLowerCase() || null;
    if (normalizedPhone || normalizedEmail) {
      const conditions: string[] = [];
      const params: (string | null)[] = [req.church_id];
      let paramIdx = 2;
      if (normalizedEmail && !normalizedEmail.includes("@placeholder.local")) {
        conditions.push(`LOWER(email) = $${paramIdx}`);
        params.push(normalizedEmail);
        paramIdx++;
      }
      if (normalizedPhone) {
        conditions.push(`phone_number = $${paramIdx}`);
        params.push(normalizedPhone);
        paramIdx++;
      }
      if (conditions.length) {
        const dupCheck = await client.query(
          `SELECT id, full_name FROM members WHERE church_id = $1 AND deleted_at IS NULL AND (${conditions.join(" OR ")}) LIMIT 1`,
          params,
        );
        if (dupCheck.rows.length) {
          await client.query("ROLLBACK");
          throw new Error(`A member with the same phone/email already exists: "${dupCheck.rows[0].full_name}". Cannot create duplicate.`);
        }
      }
    }

    const memberResult = await client.query(
      `INSERT INTO "members" ("full_name", "email", "phone_number", "address", "membership_id", "subscription_amount", "verification_status", "church_id")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING "id"`,
      [
        req.full_name,
        req.email || `family_${Date.now()}_${Math.random().toString(36).slice(2, 10)}@placeholder.local`,
        req.phone_number || null,
        req.address || null,
        `FM-${Date.now().toString(36).toUpperCase()}`,
        0,
        "verified",
        req.church_id,
      ],
    );
    const newMemberId = memberResult.rows[0]?.id;
    if (!newMemberId) throw new Error("Member creation returned no id");

    await client.query(
      `INSERT INTO "family_members" ("member_id", "linked_to_member_id", "relation", "church_id")
       VALUES ($1, $2, $3, $4)`,
      [req.requester_member_id, newMemberId, req.relation, req.church_id],
    );

    await client.query(
      `UPDATE "family_member_create_requests"
       SET "status" = 'approved', "reviewed_by" = $1, "review_notes" = $2, "reviewed_at" = $3, "created_member_id" = $4
       WHERE "id" = $5`,
      [reviewerUserId, reviewNotes || null, new Date().toISOString(), newMemberId, requestId],
    );

    await client.query("COMMIT");

    return { request: { ...req, status: "approved", reviewed_by: reviewerUserId, created_member_id: newMemberId }, created_member: { id: newMemberId } };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "reviewFamilyMemberCreateRequest transaction failed");
    throw err;
  } finally {
    client.release();
  }
}
