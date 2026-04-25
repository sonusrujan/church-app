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
// Google OAuth removed — phone-only auth
// import googleAuthRoutes from "./routes/googleAuthRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import dioceseRoutes from "./routes/dioceseRoutes";
import adBannerRoutes from "./routes/adBannerRoutes";
import specialDateRoutes from "./routes/specialDateRoutes";
import pushRoutes from "./routes/pushRoutes";
import donationFundRoutes from "./routes/donationFundRoutes";
import { logger } from "./utils/logger";
import { pool } from "./services/dbClient";
import { getSchedulerHealth } from "./jobs/scheduler";
import { APP_NAME, FRONTEND_URL } from "./config";
import { rlsStorage } from "./middleware/rlsContext";
import { sanitizeHtml } from "./middleware/inputSanitizer";
import { requireActiveChurch } from "./middleware/requireActiveChurch";

const app = express();

// 7.3: Trust ALB/CloudFront proxy — makes req.ip use X-Forwarded-For
app.set("trust proxy", 1);

// 1.1: RLS context — wrap each request in an AsyncLocalStorage scope.
// The church_id is set to "" initially (superadmin / unauthenticated).
// requireAuth & requireRegisteredUser update it once user is identified.
app.use((_req, _res, next) => {
  rlsStorage.run({ churchId: null }, () => next());
});

// 7.4: Input sanitization — strip HTML from all incoming string fields
app.use(sanitizeHtml);

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
}));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

// LOG-7: Request correlation IDs
app.use((req, _res, next) => {
  (req as any).id = req.headers["x-request-id"] || randomUUID();
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

app.use("/api/payments", paymentLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/otp/send", otpSendLimiter);
app.use("/api/otp", authLimiter);
app.use("/api/subscriptions/create", sensitiveLimiter);
app.use("/api/members/search", sensitiveLimiter);
app.use("/api/members/link", sensitiveLimiter);
app.use("/api/", generalLimiter);
app.use(pinoHttp({ logger, genReqId: (req) => (req as any).id }));

app.get("/health", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    const { totalCount, idleCount, waitingCount } = pool;
    res.status(200).json({
      status: "ok",
      db: "connected",
      pool: { total: totalCount, idle: idleCount, waiting: waitingCount },
      scheduler: getSchedulerHealth(),
    });
  } catch (err) {
    logger.error({ err }, "Health check failed");
    res.status(503).json({ status: "unhealthy", db: "disconnected" });
  }
});

app.get("/", (_req, res) => {
  res.redirect(FRONTEND_URL);
});

app.get("/api", (_req, res) => {
  res.status(200).json({
    name: `${APP_NAME} Backend`,
    status: "running",
  });
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
// Google OAuth removed — phone-only auth
// app.use("/api/auth", googleAuthRoutes);
app.use("/api/uploads", requireActiveChurch, uploadRoutes);
app.use("/api/diocese", dioceseRoutes);
app.use("/api/ad-banners", adBannerRoutes);
app.use("/api/special-dates", requireActiveChurch, specialDateRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/donation-funds", donationFundRoutes);

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
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
