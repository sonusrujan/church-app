import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB client / transaction surface
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockGetClient = vi.fn().mockResolvedValue({
  query: (...args: any[]) => mockClientQuery(...args),
  release: () => mockClientRelease(),
});
const mockDbFrom = vi.fn();

vi.mock("./dbClient", () => ({
  db: { from: (...args: any[]) => mockDbFrom(...args) },
  rawQuery: vi.fn(),
  getClient: (...args: any[]) => mockGetClient(...args),
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("./jobQueueService", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-id-1"),
}));

vi.mock("../config", () => ({
  AWS_REGION: "ap-south-1",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  APP_NAME: "TEST",
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "",
  TWILIO_ACCOUNT_SID: "",
  TWILIO_AUTH_TOKEN: "",
  TWILIO_MESSAGING_SERVICE_SID: "",
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

vi.mock("@aws-sdk/client-sns", () => ({
  SNSClient: vi.fn(),
  PublishCommand: vi.fn(),
}));

import { queueNotification } from "./notificationService";

function stubTxn(deliveryId: string | null, insertError?: Error) {
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) return {};
    if (sql.includes("INSERT INTO notification_deliveries")) {
      if (insertError) throw insertError;
      return { rows: [{ id: deliveryId }] };
    }
    if (sql.includes("INSERT INTO job_queue")) return { rows: [] };
    return { rows: [] };
  });
}

describe("queueNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a delivery record and inserts a job_queue row (push channel)", async () => {
    stubTxn("delivery-1");
    const result = await queueNotification({
      church_id: "c1",
      recipient_user_id: "u1",
      channel: "push",
      notification_type: "test_notif",
      body: "Hello!",
      subject: "Test",
    });
    expect(result).toBe("delivery-1");
    const jobInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO job_queue"),
    );
    expect(jobInsert).toBeTruthy();
    expect(jobInsert![1][0]).toBe("send_push");
    const payload = JSON.parse(jobInsert![1][1]);
    expect(payload.delivery_id).toBe("delivery-1");
    expect(payload.body).toBe("Hello!");
  });

  it("enqueues send_email for email channel", async () => {
    stubTxn("delivery-2");
    await queueNotification({
      church_id: "c1",
      recipient_email: "test@test.com",
      channel: "email",
      notification_type: "test_email",
      body: "Email body",
      subject: "Sub",
    });
    const jobInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO job_queue"),
    );
    expect(jobInsert![1][0]).toBe("send_email");
  });

  it("enqueues send_sms for sms channel", async () => {
    stubTxn("delivery-3");
    await queueNotification({
      church_id: "c1",
      recipient_phone: "+919999999999",
      channel: "sms",
      notification_type: "test_sms",
      body: "SMS body",
    });
    const jobInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO job_queue"),
    );
    expect(jobInsert![1][0]).toBe("send_sms");
  });

  it("rolls back and throws when delivery insert fails", async () => {
    stubTxn(null, new Error("DB insert failed"));
    await expect(
      queueNotification({
        church_id: "c1",
        channel: "push",
        notification_type: "test",
        body: "fail",
      }),
    ).rejects.toThrow("DB insert failed");
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it("passes url from metadata into job payload", async () => {
    stubTxn("delivery-4");
    await queueNotification({
      church_id: "c1",
      recipient_user_id: "u1",
      channel: "push",
      notification_type: "with_url",
      body: "Click me",
      metadata: { url: "/payments" },
    });
    const jobInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO job_queue"),
    );
    const payload = JSON.parse(jobInsert![1][1]);
    expect(payload.url).toBe("/payments");
  });
});
