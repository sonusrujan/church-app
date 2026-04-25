import { randomUUID } from "crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import memberRoutes from "./routes/memberRoutes";
import subscriptionRoutes from "./routes/subscriptionRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import announcementRoutes from "./routes/announcementRoutes";
import adminRoutes from "./routes/adminRoutes";
import authRoutes from "./routes/authRoutes";
import churchRoutes from "./routes/churchRoutes";
import pastorRoutes from "./routes/pastorRoutes";
import engagementRoutes from "./routes/engagementRoutes";
import requestRoutes from "./routes/requestRoutes";
import adminExtrasRoutes from "./routes/adminExtrasRoutes";
import operationsRoutes from "./routes/operationsRoutes";
import otpRoutes from "./routes/otpRoutes";
import leadershipRoutes from "./routes/leadershipRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import saasRoutes from "./routes/saasRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import dioceseRoutes from "./routes/dioceseRoutes";
import adBannerRoutes from "./routes/adBannerRoutes";
import specialDateRoutes from "./routes/specialDateRoutes";
import pushRoutes from "./routes/pushRoutes";
import donationFundRoutes from "./routes/donationFundRoutes";
import razorpayRoutesRoutes from "./routes/razorpayRoutesRoutes";
import { logger } from "./utils/logger";
import { pool } from "./services/dbClient";
import { FRONTEND_URL } from "./config";
import { rlsStorage } from "./middleware/rlsContext";
import { sanitizeHtml } from "./middleware/inputSanitizer";
import { requireActiveChurch } from "./middleware/requireActiveChurch";

const app = express();

// 7.3: Trust ALB/CloudFront proxy — makes req.ip use X-Forwarded-For
// NOTE: Set to 1 for single-hop ALB. If adding CloudFront in front of ALB, change to 2.
app.set("trust proxy", 1);

// 1.1: RLS context — wrap each request in an AsyncLocalStorage scope.
// The church_id is set to "" initially (superadmin / unauthenticated).
// requireAuth & requireRegisteredUser update it once user is identified.
app.use((_req, _res, next) => {
  rlsStorage.run({ churchId: null }, () => next());
});

// --- Security: CORS locked to frontend origin ---
// MED-11: Use NODE_ENV to decide dev mode, not FRONTEND_URL content.
const isDev = process.env.NODE_ENV !== "production";
const allowedOrigins: string[] = [FRONTEND_URL];
if (isDev) {
  // In development, Vite auto-increments port (5173→5174→5175) when the port is in use.
  const base = FRONTEND_URL.replace(/:\d+$/, "");
  for (let p = 5173; p <= 5180; p++) allowedOrigins.push(`${base}:${p}`);
}

app.use(
  cors({
    origin: isDev
      ? (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin)) cb(null, true);
          else cb(new Error("CORS: origin not allowed"));
        }
      : FRONTEND_URL,
    credentials: true,
  })
);

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://checkout.razorpay.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", FRONTEND_URL, "https://lumberjack-cx.razorpay.com", "https://api.razorpay.com"],
      frameSrc: ["'self'", "https://api.razorpay.com"],
      fontSrc: ["'self'"],
    },
  },
}));

// LOW-001: Restrict access to sensitive browser APIs
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  next();
});

app.use(cookieParser());

// Webhook route needs raw body for signature verification — must be before express.json()
app.use("/api/webhooks", express.json({
  limit: "1mb",
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
// Standard JSON parsing for all other routes
app.use(express.json({ limit: "1mb" }));

// 7.4: Input sanitization — strip HTML from all incoming string fields
// Must be AFTER express.json() so req.body is populated
app.use(sanitizeHtml);

// LOG-7: Request correlation IDs — MED-008: sanitize client-supplied header
app.use((req, _res, next) => {
  const clientId = req.headers["x-request-id"];
  const validId = typeof clientId === "string" && /^[a-zA-Z0-9_\-]{1,128}$/.test(clientId);
  (req as any).id = validId ? clientId : randomUUID();
  next();
});

// Default: no caching for API responses (safe for mutations)
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// API-10: Require JSON Content-Type on mutation endpoints
app.use("/api", (req, res, next) => {
  const exemptPaths = ["/webhooks/razorpay", "/auth/refresh"];
  if (["POST", "PUT", "PATCH"].includes(req.method) && !exemptPaths.includes(req.path)) {
    const ct = req.headers["content-type"] || "";
    if (!ct.includes("application/json") && !ct.includes("multipart/form-data") && !ct.includes("text/csv")) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }
  }
  next();
});

// --- Security: Rate limiting ---
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, "Rate limit exceeded (general)");
    res.status(429).json({ error: "Too many requests, please try again later" });
  },
});

const paymentLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment requests, please try again later" },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, "Rate limit exceeded (payment)");
    res.status(429).json({ error: "Too many payment requests, please try again later" });
  },
});

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth requests, please try again later" },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, "Rate limit exceeded (auth)");
    res.status(429).json({ error: "Too many auth requests, please try again later" });
  },
});

// Tighter rate limit specifically for OTP send (prevent SMS abuse)
const otpSendLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many OTP requests, please wait before trying again" },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, "Rate limit exceeded (OTP send)");
    res.status(429).json({ error: "Too many OTP requests, please wait before trying again" });
  },
});

const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, "Rate limit exceeded (sensitive)");
    res.status(429).json({ error: "Too many requests, please try again later" });
  },
});

// Tight limit on unauthenticated public endpoints to prevent enumeration / DoS
const publicEndpointLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, "Rate limit exceeded (public endpoint)");
    res.status(429).json({ error: "Too many requests, please try again later" });
  },
});

// Tight limit on file upload mutations (expensive S3 operations)
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many upload requests, please try again later" },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, "Rate limit exceeded (uploads)");
    res.status(429).json({ error: "Too many upload requests, please try again later" });
  },
});

app.use("/api/payments", paymentLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/otp/send", otpSendLimiter);
app.use("/api/otp", authLimiter);
app.use("/api/subscriptions/create", sensitiveLimiter);
app.use("/api/members/list", sensitiveLimiter);
app.use("/api/members/search", sensitiveLimiter);
app.use("/api/members/link", sensitiveLimiter);
app.use("/api/donation-funds/public", publicEndpointLimiter);
app.use("/api/uploads", uploadLimiter);
app.use("/api/", generalLimiter);
app.use(pinoHttp({ logger, genReqId: (req) => (req as any).id }));

// Lightweight ping for external uptime monitors (UptimeRobot, BetterStack, etc.)
app.get("/ping", (_req, res) => {
  res.status(200).send("pong");
});

app.get("/health", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    // MED-003: Only expose status to external callers, no server metadata
    res.status(200).json({ status: "ok" });
  } catch (err) {
    logger.error({ err }, "Health check failed");
    res.status(503).json({ status: "unhealthy" });
  }
});

app.get("/", (_req, res) => {
  res.redirect(FRONTEND_URL);
});

// LOW-009: Do not reveal app name to unauthenticated callers
app.get("/api", (_req, res) => {
  res.status(200).json({ status: "running" });
});
app.use("/api/members", requireActiveChurch, memberRoutes);
app.use("/api/subscriptions", requireActiveChurch, subscriptionRoutes);
app.use("/api/payments", requireActiveChurch, paymentRoutes);
app.use("/api/announcements", requireActiveChurch, announcementRoutes);
app.use("/api/admins", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/churches", churchRoutes);
app.use("/api/pastors", requireActiveChurch, pastorRoutes);
app.use("/api/engagement", requireActiveChurch, engagementRoutes);
app.use("/api/requests", requireActiveChurch, requestRoutes);
app.use("/api/admin", requireActiveChurch, adminExtrasRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/ops", requireActiveChurch, operationsRoutes);
app.use("/api/leadership", requireActiveChurch, leadershipRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/saas", saasRoutes);
app.use("/api/uploads", requireActiveChurch, uploadRoutes);
// MED-010: Gate non-super-admin routes behind requireActiveChurch
app.use("/api/diocese", requireActiveChurch, dioceseRoutes);
app.use("/api/ad-banners", requireActiveChurch, adBannerRoutes);
app.use("/api/special-dates", requireActiveChurch, specialDateRoutes);
app.use("/api/push", requireActiveChurch, pushRoutes);
app.use("/api/donation-funds", (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path === "/public" && req.method === "GET") return next();
  requireActiveChurch(req, res, next);
}, donationFundRoutes);
app.use("/api/razorpay-routes", razorpayRoutesRoutes);

// 404 handler for unknown routes
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Handle malformed JSON body (SyntaxError from express.json())
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }
  // Report to Sentry if available
  try { const { Sentry } = require("./sentry"); Sentry.captureException(err); } catch { /* sentry not init */ }
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
