import { db, getClient } from "./dbClient";
import { logger } from "../utils/logger";
import { normalizeIndianPhone } from "../utils/phone";

// ── Types ──

export interface MembershipRequestRow {
  id: string;
  church_id: string;
  email: string;
  full_name: string;
  phone_number: string | null;
  address: string | null;
  membership_id: string | null;
  message: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export interface CreateMembershipRequestInput {
  church_code: string;
  email?: string;
  full_name: string;
  phone_number?: string;
  address?: string;
  membership_id?: string;
  message?: string;
}

// ── Functions ──

export async function createMembershipRequest(input: CreateMembershipRequestInput) {
  const normalizedEmail = input.email?.trim().toLowerCase() || "";
  const normalizedPhone = input.phone_number?.trim() ? normalizeIndianPhone(input.phone_number) : "";

  if (!normalizedPhone && !normalizedEmail) {
    throw new Error("Either phone number or email is required.");
  }

  // Resolve church by code
  const { data: church, error: churchError } = await db
    .from("churches")
    .select("id, name")
    .eq("church_code", input.church_code.trim())
    .is("deleted_at", null)
    .single();

  if (churchError || !church) {
    throw new Error("No church found with that code. Please verify and try again.");
  }

  // Check if already a member by phone or email
  let existingMemberQuery = db
    .from("members")
    .select("id")
    .eq("church_id", church.id)
    .is("deleted_at", null)
    .limit(1);

  if (normalizedPhone) {
    existingMemberQuery = existingMemberQuery.eq("phone_number", normalizedPhone);
  } else {
    existingMemberQuery = existingMemberQuery.ilike("email", normalizedEmail);
  }

  const { data: existingMember } = await existingMemberQuery;

  if (existingMember && existingMember.length > 0) {
    throw new Error("An account with this phone/email already exists for this church.");
  }

  // Check if pending request already exists by phone or email
  let pendingQuery = db
    .from("membership_requests")
    .select("id")
    .eq("church_id", church.id)
    .eq("status", "pending")
    .limit(1);

  if (normalizedPhone) {
    pendingQuery = pendingQuery.eq("phone_number", normalizedPhone);
  } else {
    pendingQuery = pendingQuery.ilike("email", normalizedEmail);
  }

  const { data: existingRequest } = await pendingQuery;

  if (existingRequest && existingRequest.length > 0) {
    throw new Error("A membership request is already pending. Please wait for admin approval.");
  }

  // Rate-limit re-submissions after rejection (24-hour cooldown)
  let rejectionQuery = db
    .from("membership_requests")
    .select("id, reviewed_at")
    .eq("church_id", church.id)
    .eq("status", "rejected")
    .order("reviewed_at", { ascending: false })
    .limit(1);

  if (normalizedPhone) {
    rejectionQuery = rejectionQuery.eq("phone_number", normalizedPhone);
  } else {
    rejectionQuery = rejectionQuery.ilike("email", normalizedEmail);
  }

  const { data: recentRejection } = await rejectionQuery;

  if (recentRejection && recentRejection.length > 0 && recentRejection[0].reviewed_at) {
    const rejectedAt = new Date(recentRejection[0].reviewed_at).getTime();
    const cooldownMs = 24 * 60 * 60 * 1000;
    if (Date.now() - rejectedAt < cooldownMs) {
      throw new Error("Your previous request was recently reviewed. Please wait 24 hours before re-submitting.");
    }
  }

  const insertPayload: Record<string, unknown> = {
    church_id: church.id,
    full_name: input.full_name.trim(),
    address: input.address?.trim() || null,
    membership_id: input.membership_id?.trim() || null,
    message: input.message?.trim().replace(/<[^>]*>/g, "") || null,
  };
  if (normalizedEmail) insertPayload.email = normalizedEmail;
  if (normalizedPhone) insertPayload.phone_number = normalizedPhone;

  const { data, error } = await db
    .from("membership_requests")
    .insert([insertPayload])
    .select("*")
    .single<MembershipRequestRow>();

  if (error) {
    logger.error({ err: error }, "createMembershipRequest failed");
    throw new Error("Failed to submit membership request. Please try again.");
  }

  return { request: data, church_name: church.name };
}

export async function listMembershipRequests(churchId: string, status?: string) {
  let query = db
    .from("membership_requests")
    .select("*")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.returns<MembershipRequestRow[]>();

  if (error) {
    logger.error({ err: error, churchId }, "listMembershipRequests failed");
    throw error;
  }

  return data || [];
}

export async function reviewMembershipRequest(
  requestId: string,
  decision: "approved" | "rejected",
  reviewedBy: string,
  reviewNote?: string,
  callerChurchId?: string
) {
  // Transactional approval path — lock the row with FOR UPDATE SKIP LOCKED
  // so two concurrent admin approvals can't both succeed. The second caller
  // sees zero rows and gets "already reviewed".
  const client = await getClient();
  let request: MembershipRequestRow;
  try {
    await client.query("BEGIN");

    const lockResult = await client.query<MembershipRequestRow>(
      `SELECT * FROM "membership_requests"
       WHERE "id" = $1 AND "status" = 'pending'
       FOR UPDATE SKIP LOCKED`,
      [requestId],
    );

    if (lockResult.rows.length === 0) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error("Request not found or already reviewed.");
    }

    request = lockResult.rows[0];

    // Church-scoping: non-super-admins can only review requests for their own church
    if (callerChurchId && request.church_id !== callerChurchId) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error("You cannot review requests for another church.");
    }

    await client.query(
      `UPDATE "membership_requests" SET "status" = $1, "reviewed_by" = $2, "reviewed_at" = $3, "review_note" = $4 WHERE "id" = $5`,
      [decision, reviewedBy, new Date().toISOString(), reviewNote?.trim() || null, requestId],
    );

    if (decision === "approved") {
      // Find existing user by phone first, then email
      let userId: string | null = null;

      if (request.phone_number) {
        const phoneUserResult = await client.query(
          `SELECT "id", "church_id" FROM "users" WHERE "phone_number" = $1 LIMIT 1`,
          [request.phone_number],
        );
        if (phoneUserResult.rows.length > 0) {
          userId = phoneUserResult.rows[0].id;
          // Only set church_id on users table if user has NO church yet (don't overwrite!)
          if (!phoneUserResult.rows[0].church_id) {
            await client.query(
              `UPDATE "users" SET "church_id" = $1 WHERE "id" = $2`,
              [request.church_id, userId],
            );
          }
        }
      }

      if (!userId && request.email) {
        const emailUserResult = await client.query(
          `SELECT "id", "church_id" FROM "users" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
          [request.email],
        );
        if (emailUserResult.rows.length > 0) {
          userId = emailUserResult.rows[0].id;
          if (!emailUserResult.rows[0].church_id) {
            await client.query(
              `UPDATE "users" SET "church_id" = $1 WHERE "id" = $2`,
              [request.church_id, userId],
            );
          }
        }
      }

      if (!userId) {
        const insertFields: string[] = ['"full_name"', '"role"', '"church_id"'];
        const insertVals: unknown[] = [request.full_name, "member", request.church_id];
        let paramIdx = 4;
        if (request.email) {
          insertFields.push('"email"');
          insertVals.push(request.email);
          paramIdx++;
        }
        if (request.phone_number) {
          insertFields.push('"phone_number"');
          insertVals.push(request.phone_number);
        }

        const newUserResult = await client.query(
          `INSERT INTO "users" (${insertFields.join(", ")}) VALUES (${insertVals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING "id"`,
          insertVals,
        );
        userId = newUserResult.rows[0]?.id;
        if (!userId) throw new Error("User creation returned no id");
      }

      // Check if member already exists by phone or email (scoped to THIS church)
      let existingMemberId: string | null = null;
      if (request.phone_number) {
        const memByPhone = await client.query(
          `SELECT "id" FROM "members" WHERE "phone_number" = $1 AND "church_id" = $2 AND "deleted_at" IS NULL LIMIT 1`,
          [request.phone_number, request.church_id],
        );
        if (memByPhone.rows.length > 0) existingMemberId = memByPhone.rows[0].id;
      }
      if (!existingMemberId && request.email) {
        const memByEmail = await client.query(
          `SELECT "id" FROM "members" WHERE LOWER("email") = LOWER($1) AND "church_id" = $2 AND "deleted_at" IS NULL LIMIT 1`,
          [request.email, request.church_id],
        );
        if (memByEmail.rows.length > 0) existingMemberId = memByEmail.rows[0].id;
      }

      let memberId = existingMemberId;
      if (!existingMemberId) {
        const memberResult = await client.query(
          `INSERT INTO "members" ("user_id", "full_name", "email", "phone_number", "address", "membership_id", "church_id", "verification_status")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING "id"`,
          [userId, request.full_name, request.email || "", request.phone_number || null, request.address, request.membership_id, request.church_id, "verified"],
        );
        memberId = memberResult.rows[0]?.id || null;
      } else {
        // Link existing member to this user if not already linked
        await client.query(
          `UPDATE "members" SET "user_id" = $1 WHERE "id" = $2 AND ("user_id" IS NULL OR "user_id" = $1)`,
          [userId, existingMemberId],
        );
      }

      // Create junction table row (additive — does NOT overwrite other church memberships)
      await client.query(
        `INSERT INTO "user_church_memberships" ("user_id", "church_id", "member_id", "role", "is_active")
         VALUES ($1, $2, $3, 'member', true)
         ON CONFLICT ("user_id", "church_id") DO UPDATE SET "member_id" = COALESCE(EXCLUDED."member_id", "user_church_memberships"."member_id"), "is_active" = true`,
        [userId, request.church_id, memberId],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err, requestId }, "reviewMembershipRequest transaction failed");
    throw err;
  } finally {
    client.release();
  }

  return { status: decision, request_id: requestId };
}
