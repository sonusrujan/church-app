import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

// ── Reusable field schemas ──

const indianPhoneSchema = z
  .string()
  .min(1, "Phone number is required")
  .transform((v) => v.replace(/[\s\-()]/g, ""));

const optionalIndianPhoneSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.replace(/[\s\-()]/g, "") : undefined));

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

const emailSchema = z
  .string()
  .email("Must be a valid email address")
  .transform((v) => v.trim().toLowerCase());

const optionalEmailSchema = z
  .string()
  .optional()
  .nullable()
  .transform((v) => {
    if (!v || !v.trim()) return undefined;
    return v.trim().toLowerCase();
  })
  .pipe(z.string().email("Must be a valid email address").optional().or(z.undefined()));

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in YYYY-MM-DD format")
  .refine((v) => new Date(v) <= new Date(), "Date cannot be in the future");

const optionalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in YYYY-MM-DD format")
  .refine((v) => !isNaN(new Date(v).getTime()), "Invalid date")
  .optional()
  .nullable();

const subscriptionAmountSchema = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === null || v === undefined || `${v}`.trim() === "") return undefined;
    return Number(v);
  })
  .pipe(
    z.number()
      .refine((n) => n === 0 || n >= 200, "subscription_amount must be at least 200 (or 0 to skip)")
      .refine((n) => n <= 1_00_00_000, "subscription_amount cannot exceed 10000000")
      .optional(),
  );

const ageSchema = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === null || v === undefined || `${v}`.trim() === "") return undefined;
    return Number(v);
  })
  .pipe(
    z.number().min(0, "age must be >= 0").max(150, "age must be <= 150").optional(),
  );

const genderSchema = z
  .enum(["male", "female", "other"])
  .optional()
  .nullable();

// ── Shared entity schemas ──

/** Admin-create-member: POST /api/members/create */
export const createMemberSchema = z.object({
  full_name: z.string().min(1, "full_name is required"),
  email: optionalEmailSchema,
  phone_number: optionalIndianPhoneSchema,
  address: z.string().optional(),
  membership_id: z.string().optional(),
  subscription_amount: subscriptionAmountSchema,
  church_id: z.string().optional(),
  occupation: z.string().optional(),
  confirmation_taken: z.boolean().optional(),
  age: ageSchema,
  gender: genderSchema,
  dob: optionalDateSchema,
});

/** Admin-pre-register: POST /api/admins/pre-register-member */
export const preRegisterMemberSchema = z.object({
  email: z.string().optional(),
  phone_number: z.string().optional(),
  full_name: z.string().optional(),
  membership_id: z.string().optional(),
  address: z.string().optional(),
  subscription_amount: subscriptionAmountSchema,
  church_id: z.string().optional(),
  occupation: z.string().optional(),
  confirmation_taken: z.boolean().optional(),
  age: ageSchema,
  pending_months: z.array(z.string()).optional(),
  no_pending_payments: z.boolean().optional(),
}).refine(
  (d) => !!(d.email?.trim() || d.phone_number?.trim()),
  { message: "email or phone_number is required", path: ["email"] },
);

/** Subscription create: POST /api/subscriptions/create */
export const createSubscriptionSchema = z.object({
  member_id: uuidSchema,
  plan_name: z.string().min(1, "plan_name is required"),
  amount: z.union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().min(200, "amount must be at least 200").max(1_00_00_000, "amount cannot exceed 10000000")),
  billing_cycle: z.enum(["monthly", "yearly"]).optional().default("monthly"),
});

/** Manual payment: POST /api/ops/payments/manual */
export const manualPaymentSchema = z.object({
  member_id: uuidSchema,
  subscription_id: uuidSchema.optional().nullable(),
  amount: z.union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().positive("amount must be positive").max(1_00_00_000, "amount cannot exceed 10000000")),
  payment_method: z.enum(["cash", "cheque", "bank_transfer", "upi_manual", "other"]),
  payment_date: z.string().min(1, "payment_date is required"),
  payment_category: z.enum(["subscription", "donation", "other"]).optional().default("other"),
  note: z.string().max(1000, "note too long").optional(),
  church_id: z.string().optional(),
});

/** Subscription edit: PATCH /api/ops/subscriptions/:id */
export const updateSubscriptionSchema = z.object({
  amount: z.union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().min(200, "amount must be at least 200").max(1_00_00_000, "amount cannot exceed 10000000"))
    .optional(),
  billing_cycle: z.enum(["monthly", "yearly"]).optional(),
  next_payment_date: z.string().optional(),
  status: z.enum(["active", "paused", "cancelled", "overdue", "pending_first_payment"]).optional(),
  plan_name: z.string().optional(),
});

// ── OTP schemas ──

export const otpSendSchema = z.object({
  phone: indianPhoneSchema,
});

export const otpVerifySchema = z.object({
  phone: indianPhoneSchema,
  otp: z.string().min(1, "OTP is required"),
});

// ── Auth route schemas ──

export const syncProfileSchema = z.object({
  full_name: z.string().optional(),
  church_id: z.string().optional(),
});

export const updateProfileSchema = z.object({
  full_name: z.string().optional(),
  avatar_url: z.string().optional(),
  address: z.string().optional(),
  phone_number: z.string().optional(),
  alt_phone_number: z.string().optional(),
  preferred_language: z.enum(["en", "hi", "ta", "te", "ml", "kn"]).optional(),
  dark_mode: z.boolean().optional(),
  gender: genderSchema,
  dob: optionalDateSchema,
  phone_change_token: z.string().optional(),
  occupation: z.string().optional(),
  confirmation_taken: z.boolean().optional(),
  age: ageSchema,
});

export const joinChurchSchema = z.object({
  church_code: z.string().min(1, "Church code is required"),
  full_name: z.string().min(1, "Full name is required"),
});

export const addFamilyMemberSchema = z.object({
  full_name: z.string().min(1, "full_name is required"),
  gender: z.string().optional(),
  relation: z.string().optional(),
  age: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === undefined || `${v}`.trim() === "") return undefined;
      return Number(v);
    })
    .pipe(
      z.number().min(0, "age must be >= 0").max(150, "age must be <= 150").optional(),
    ),
  dob: dateSchema.optional().nullable(),
  add_subscription: z.boolean().optional(),
  subscription_amount: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === undefined || `${v}`.trim() === "") return undefined;
      return Number(v);
    })
    .pipe(
      z.number().min(200, "subscription_amount must be at least 200").optional(),
    ),
  billing_cycle: z.enum(["monthly", "yearly"]).optional().default("monthly"),
});

export const updateFamilyMemberSchema = z.object({
  full_name: z.string().optional(),
  gender: z.string().optional(),
  relation: z.string().optional(),
  age: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === undefined || `${v}`.trim() === "") return undefined;
      return Number(v);
    })
    .pipe(
      z.number().min(0, "age must be >= 0").max(150, "age must be <= 150").optional(),
    ),
  dob: dateSchema.optional().nullable(),
  address: z.string().optional(),
  phone_number: z.string().optional(),
  alt_phone_number: z.string().optional(),
  occupation: z.string().optional(),
  confirmation_taken: z.boolean().optional(),
  phone_change_token: z.string().optional(),
});

// ── Family request schemas ──

export const createFamilyRequestSchema = z.object({
  target_member_id: uuidSchema,
  relation: z.string().min(1, "Relation is required"),
});

// MED-013: Refund schema for POST /api/ops/payments/:paymentId/refund
export const refundSchema = z.object({
  refund_amount: z.union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().positive("refund_amount must be positive").max(10_000_000, "refund_amount cannot exceed 1 crore")),
  refund_reason: z.string().max(500, "refund_reason too long").optional(),
  refund_method: z.enum(["cash", "cheque", "bank_transfer", "upi_manual", "razorpay", "other"]),
});

/** Link member: POST /api/members/link */
export const linkMemberSchema = z.object({
  email: emailSchema,
});

/** Update member: PATCH /api/members/:id */
export const updateMemberSchema = z.object({
  full_name: z.string().optional(),
  email: optionalEmailSchema,
  address: z.string().max(500, "address too long").optional(),
  membership_id: z.string().max(100, "membership_id too long").optional(),
  phone_number: optionalIndianPhoneSchema,
  alt_phone_number: optionalIndianPhoneSchema,
  verification_status: z.enum(["pending", "verified", "rejected"]).optional(),
  subscription_amount: subscriptionAmountSchema,
  occupation: z.string().max(200, "occupation too long").optional(),
  confirmation_taken: z.boolean().optional(),
  gender: genderSchema,
  dob: optionalDateSchema,
  age: ageSchema,
  church_id: z.string().optional(),
});

/** Create event: POST /api/engagement/events */
export const createEventSchema = z.object({
  title: z.string().min(1, "title is required").max(300, "title too long"),
  message: z.string().max(5000, "message too long").optional().nullable(),
  event_date: z.string().min(1, "event_date is required"),
  image_url: z.string().max(2048, "image_url too long").optional().nullable(),
  church_id: z.string().optional(),
});

/** Create notification: POST /api/engagement/notifications */
export const createNotificationSchema = z.object({
  title: z.string().min(1, "title is required").max(300, "title too long"),
  message: z.string().max(5000, "message too long").optional().nullable(),
  image_url: z.string().max(2048, "image_url too long").optional().nullable(),
  church_id: z.string().optional(),
});

/** Create special date: POST /api/special-dates */
export const createSpecialDateSchema = z.object({
  occasion_type: z.enum(["birthday", "anniversary"], { error: "occasion_type must be 'birthday' or 'anniversary'" }),
  occasion_date: z.string().min(1, "occasion_date required"),
  person_name: z.string().min(1, "person_name required").max(200, "person_name too long"),
  spouse_name: z.string().max(200, "spouse_name too long").optional().nullable(),
  notes: z.string().max(1000, "notes too long").optional().nullable(),
  member_id: z.string().optional(),
  church_id: z.string().optional(),
});

/** Create ad banner: POST /api/ad-banners */
export const createAdBannerSchema = z.object({
  scope: z.enum(["diocese", "church"], { error: "scope must be diocese or church" }),
  scope_id: uuidSchema,
  image_url: z.string().min(1, "image_url is required").max(2048, "image_url too long"),
  link_url: z.string().max(2048, "link_url too long").optional().nullable(),
  sort_order: z.number().optional(),
  media_type: z.enum(["image", "video", "gif"]).optional().default("image"),
  position: z.enum(["top", "bottom"]).optional().default("bottom"),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
});

/** Post announcement: POST /api/announcements/post */
export const postAnnouncementSchema = z.object({
  title: z.string().min(1, "title is required").max(200, "Title must be 200 characters or less"),
  message: z.string().max(2000, "Message must be 2000 characters or less").optional().nullable(),
});

// ── Payment schemas (C-2) ──

const razorpayIdSchema = z.string().min(1).max(200);

export const paymentOrderSchema = z.object({
  currency: z.string().max(10).optional(),
  receipt: z.string().max(200).optional(),
  subscription_id: z.string().optional().nullable(),
  amount: z.union([z.number(), z.string()]).optional().nullable()
    .transform((v) => (v != null && `${v}`.trim() !== "" ? Number(v) : undefined)),
});

export const paymentVerifySchema = z.object({
  razorpay_order_id: razorpayIdSchema,
  razorpay_payment_id: razorpayIdSchema,
  razorpay_signature: z.string().min(1),
  subscription_id: z.string().optional().nullable(),
  payment_method: z.string().max(100).optional(),
});

export const donationOrderSchema = z.object({
  amount: z.union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().positive("amount must be positive").max(10_000_000)),
});

export const donationVerifySchema = z.object({
  razorpay_order_id: razorpayIdSchema,
  razorpay_payment_id: razorpayIdSchema,
  razorpay_signature: z.string().min(1),
  fund: z.string().max(200).optional(),
});

export const subscriptionOrderSchema = z.object({
  subscription_ids: z.array(z.string()).min(1, "At least one subscription required"),
  subscription_month_counts: z.record(z.string(), z.number().int().min(1).max(60)).optional(),
});

export const subscriptionVerifySchema = z.object({
  razorpay_order_id: razorpayIdSchema,
  razorpay_payment_id: razorpayIdSchema,
  razorpay_signature: z.string().min(1),
  subscription_ids: z.array(z.string()).optional(),
  subscription_month_counts: z.record(z.string(), z.number().int().min(1).max(60)).optional(),
  subscription_id: z.string().optional(),
});

export const publicDonationOrderSchema = z.object({
  church_id: z.string().min(1, "church_id required"),
  amount: z.union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().positive("amount must be positive").max(10_000_000)),
  donor_name: z.string().max(200).optional(),
  donor_email: z.string().email().optional().or(z.literal("")),
  donor_phone: z.string().max(30).optional(),
  fund: z.string().max(200).optional(),
  message: z.string().max(1000).optional(),
});

export const publicDonationVerifySchema = z.object({
  church_id: z.string().min(1, "church_id required"),
  razorpay_order_id: razorpayIdSchema,
  razorpay_payment_id: razorpayIdSchema,
  razorpay_signature: z.string().min(1),
  donor_name: z.string().max(200).optional(),
  donor_email: z.string().email().optional().or(z.literal("")),
  donor_phone: z.string().max(30).optional(),
  fund: z.string().max(200).optional(),
  message: z.string().max(1000).optional(),
});

// ── Pastor schemas ──

export const createPastorSchema = z.object({
  church_id: z.string().optional(),
  full_name: z.string().min(1, "full_name is required").max(200),
  phone_number: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  details: z.string().max(2000).optional().nullable(),
});

export const updatePastorSchema = z.object({
  church_id: z.string().optional(),
  full_name: z.string().min(1).max(200).optional(),
  phone_number: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  details: z.string().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const transferPastorSchema = z.object({
  from_church_id: z.string().min(1, "from_church_id required"),
  to_church_id: z.string().min(1, "to_church_id required"),
});

// ── Leadership schemas ──

export const assignLeadershipSchema = z.object({
  church_id: z.string().optional(),
  role_id: z.string().optional().nullable(),
  member_id: z.string().optional().nullable(),
  full_name: z.string().min(1, "full_name is required").max(200),
  phone_number: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  photo_url: z.string().max(2048).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  custom_role_name: z.string().max(200).optional().nullable(),
  custom_hierarchy_level: z.number().int().min(0).max(100).optional().nullable(),
});

export const updateLeadershipSchema = z.object({
  church_id: z.string().optional(),
  full_name: z.string().max(200).optional(),
  phone_number: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  photo_url: z.string().max(2048).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
  role_id: z.string().optional().nullable(),
  custom_role_name: z.string().max(200).optional().nullable(),
  custom_hierarchy_level: z.number().int().min(0).max(100).optional().nullable(),
});

// ── Admin schemas ──

export const adminUpdateMemberSchema = z.object({
  full_name: z.string().max(200).optional(),
  church_id: z.string().optional(),
});

export const adminGrantSchema = z.object({
  phone_number: z.string().min(1, "phone_number is required"),
  church_id: z.string().optional(),
});

export const adminRevokeSchema = z.object({
  phone_number: z.string().min(1, "phone_number is required"),
});

// ── Diocese schemas ──

export const createDioceseSchema = z.object({
  name: z.string().min(1, "name is required").max(200),
});

export const updateDioceseSchema = z.object({
  name: z.string().min(1, "name is required").max(200),
});

export const dioceseMediaSchema = z.object({
  logo_url: z.string().max(2048).optional().nullable(),
  banner_url: z.string().max(2048).optional().nullable(),
});

export const dioceseLogoSchema = z.object({
  logo_url: z.string().min(1).max(2048),
});

export const dioceseChurchesSchema = z.object({
  church_ids: z.array(z.string()).min(1, "At least one church_id required"),
});

export const createDioceseLeaderSchema = z.object({
  role: z.string().min(1, "role is required").max(100),
  full_name: z.string().min(1, "full_name is required").max(200),
  phone_number: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  bio: z.string().max(2000).optional().nullable(),
  photo_url: z.string().max(2048).optional().nullable(),
});

export const updateDioceseLeaderSchema = z.object({
  full_name: z.string().max(200).optional(),
  phone_number: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  bio: z.string().max(2000).optional().nullable(),
  photo_url: z.string().max(2048).optional().nullable(),
  role: z.string().max(100).optional(),
  is_active: z.boolean().optional(),
});

// ── Push notification schemas ──

export const pushSubscribeSchema = z.object({
  endpoint: z.string().min(1, "endpoint is required").max(2048),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().min(1, "endpoint is required").max(2048),
});

export const pushResubscribeSchema = z.object({
  oldEndpoint: z.string().min(1).max(2048),
  newEndpoint: z.string().min(1).max(2048),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const sendNotificationSchema = z.object({
  diocese_id: z.string().optional().nullable(),
  church_id: z.string().optional().nullable(),
  member_id: z.string().optional().nullable(),
  channel: z.string().max(50).optional(),
  title: z.string().min(1, "title is required").max(200),
  message: z.string().min(1, "message is required").max(2000),
  url: z.string().max(2048).optional(),
});

// ── Request schemas ──

export const membershipRequestSchema = z.object({
  church_code: z.string().min(1, "church_code is required").max(50),
  full_name: z.string().min(1, "full_name is required").max(200),
  phone_number: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
  membership_id: z.string().max(100).optional(),
  message: z.string().max(1000).optional(),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  review_note: z.string().max(1000).optional(),
  review_notes: z.string().max(1000).optional(),
});

export const cancellationRequestSchema = z.object({
  subscription_id: z.string().min(1, "subscription_id is required"),
  reason: z.string().max(1000).optional(),
});

export const familyCreateRequestSchema = z.object({
  full_name: z.string().min(1, "full_name is required").max(200),
  phone_number: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  date_of_birth: z.string().optional(),
  relation: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

export const accountDeletionRequestSchema = z.object({
  reason: z.string().min(5, "Please provide a reason (minimum 5 characters)").max(1000),
});

// ── Donation fund schemas ──

export const createDonationFundSchema = z.object({
  church_id: z.string().optional(),
  name: z.string().min(1, "Fund name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  sort_order: z.union([z.number(), z.string()])
    .optional()
    .transform((v) => (v != null ? Number(v) : 0))
    .pipe(z.number().int().min(0).max(1000)),
});

export const updateDonationFundSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  is_active: z.boolean().optional(),
  sort_order: z.union([z.number(), z.string()])
    .optional()
    .transform((v) => (v != null ? Number(v) : undefined))
    .pipe(z.number().int().min(0).max(1000).optional()),
});

// ── Operations schemas (ones not already covered) ──

export const updateAnnouncementSchema = z.object({
  church_id: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  message: z.string().max(2000).optional().nullable(),
});

export const updateChurchCodeSchema = z.object({
  church_code: z.string().min(1, "church_code is required").max(50),
});

export const bulkImportMembersSchema = z.object({
  church_id: z.string().optional(),
  members: z.array(z.object({
    full_name: z.string().min(1).max(200),
    email: z.string().optional(),
    phone_number: z.string().optional(),
    address: z.string().optional(),
    membership_id: z.string().optional(),
    subscription_amount: z.union([z.number(), z.string()]).optional()
      .transform((v) => (v != null && `${v}`.trim() !== "" ? Number(v) : undefined)),
  })).min(1, "At least one member required"),
});

export const relinkAuthSchema = z.object({
  new_email: z.string().email().optional(),
  new_phone: z.string().optional(),
}).refine((d) => !!(d.new_email || d.new_phone), {
  message: "new_email or new_phone is required",
  path: ["new_email"],
});

export const createRefundRequestSchema = z.object({
  payment_id: z.string().optional(),
  transaction_id: z.string().optional(),
  amount: z.union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().positive("amount must be positive")),
  reason: z.string().max(1000).optional(),
});

export const reviewRefundRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  review_note: z.string().max(1000).optional(),
});

// ── Special date update schema ──

export const updateSpecialDateSchema = z.object({
  occasion_type: z.enum(["birthday", "anniversary"]).optional(),
  occasion_date: z.string().optional(),
  person_name: z.string().max(200).optional(),
  spouse_name: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

// ── Middleware factory ──

/**
 * Express middleware that validates `req.body` against a Zod schema.
 * On success, replaces `req.body` with the parsed (and transformed) data.
 * On failure, responds with 400 and the first validation error message.
 */
export function validate(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues[0]?.message || "Invalid request body";
      return res.status(400).json({ error: message });
    }
    req.body = result.data;
    next();
  };
}
