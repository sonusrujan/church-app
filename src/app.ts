import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import memberRoutes from "./routes/memberRoutes";
import subscriptionRoutes from "./routes/subscriptionRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import announcementRoutes from "./routes/announcementRoutes";
import adminRoutes from "./routes/adminRoutes";
import authRoutes from "./routes/authRoutes";
import churchRoutes from "./routes/churchRoutes";
import pastorRoutes from "./routes/pastorRoutes";
import engagementRoutes from "./routes/engagementRoutes";
import { logger } from "./utils/logger";
import { APP_NAME, FRONTEND_URL } from "./config";

const app = express();
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
app.get("/", (_req, res) => {
  res.redirect(FRONTEND_URL);
});

app.get("/api", (_req, res) => {
  res.status(200).json({
    name: `${APP_NAME} Backend`,
    status: "running",
    endpoints: {
      health: "/health",
      authSyncProfile: "/api/auth/sync-profile",
      authMe: "/api/auth/me",
      authMemberDashboard: "/api/auth/member-dashboard",
      authUpdateProfile: "/api/auth/update-profile",
      authFamilyMembers: "/api/auth/family-members",
      members: "/api/members",
      membersSearch: "/api/members/search",
      membersById: "/api/members/:id",
      membersDeleteImpact: "/api/members/:id/delete-impact",
      subscriptions: "/api/subscriptions",
      subscriptionsReconcileOverdue: "/api/subscriptions/reconcile-overdue",
      payments: "/api/payments",
      paymentConfig: "/api/payments/config",
      paymentDonationOrder: "/api/payments/donation/order",
      paymentDonationVerify: "/api/payments/donation/verify",
      paymentSubscriptionOrder: "/api/payments/subscription/order",
      paymentSubscriptionVerify: "/api/payments/subscription/verify",
      paymentReceiptDownload: "/api/payments/:paymentId/receipt",
      announcements: "/api/announcements",
      admins: "/api/admins",
      adminsSearch: "/api/admins/search",
      adminsById: "/api/admins/id/:id",
      adminPreRegisterMember: "/api/admins/pre-register-member",
      adminIncome: "/api/admins/income",
      churches: "/api/churches",
      churchSearch: "/api/churches/search",
      churchById: "/api/churches/id/:id",
      churchDeleteImpact: "/api/churches/id/:id/delete-impact",
      churchSummary: "/api/churches/summary",
      churchCreate: "/api/churches/create",
      churchPaymentConfigGet: "/api/churches/payment-config",
      churchPaymentConfigUpdate: "/api/churches/payment-config",
      pastors: "/api/pastors",
      pastorById: "/api/pastors/:id",
      pastorTransfer: "/api/pastors/:id/transfer",
      events: "/api/engagement/events",
      notifications: "/api/engagement/notifications",
      prayerRequests: "/api/engagement/prayer-requests"
    }
  });
});
app.use("/api/members", memberRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/admins", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/churches", churchRoutes);
app.use("/api/pastors", pastorRoutes);
app.use("/api/engagement", engagementRoutes);

// 404 handler for unknown routes
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
