import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all DB & external dependencies
const mockInsertSelect = vi.fn();
const mockDbFrom = vi.fn();
vi.mock("./dbClient", () => ({
  db: {
    from: (...args: any[]) => mockDbFrom(...args),
  },
  rawQuery: vi.fn(),
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
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

vi.mock("@aws-sdk/client-sns", () => ({
  SNSClient: vi.fn(),
  PublishCommand: vi.fn(),
}));

import { queueNotification } from "./notificationService";
import { enqueueJob } from "./jobQueueService";

describe("queueNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a delivery record and enqueues a job", async () => {
    // Mock insert to return delivery ID
    mockDbFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "delivery-1" }, error: null }),
        }),
      }),
    });

    const result = await queueNotification({
      church_id: "c1",
      recipient_user_id: "u1",
      channel: "push",
      notification_type: "test_notif",
      body: "Hello!",
      subject: "Test",
    });

    expect(result).toBe("delivery-1");
    expect(mockDbFrom).toHaveBeenCalledWith("notification_deliveries");
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        job_type: "send_push",
        payload: expect.objectContaining({
          delivery_id: "delivery-1",
          body: "Hello!",
        }),
      })
    );
  });

  it("enqueues send_email for email channel", async () => {
    mockDbFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "delivery-2" }, error: null }),
        }),
      }),
    });

    await queueNotification({
      church_id: "c1",
      recipient_email: "test@test.com",
      channel: "email",
      notification_type: "test_email",
      body: "Email body",
      subject: "Sub",
    });

    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ job_type: "send_email" })
    );
  });

  it("enqueues send_sms for sms channel", async () => {
    mockDbFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "delivery-3" }, error: null }),
        }),
      }),
    });

    await queueNotification({
      church_id: "c1",
      recipient_phone: "+919999999999",
      channel: "sms",
      notification_type: "test_sms",
      body: "SMS body",
    });

    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ job_type: "send_sms" })
    );
  });

  it("throws when DB insert fails", async () => {
    mockDbFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: new Error("DB insert failed") }),
        }),
      }),
    });

    await expect(
      queueNotification({
        church_id: "c1",
        channel: "push",
        notification_type: "test",
        body: "fail",
      })
    ).rejects.toThrow("DB insert failed");
  });

  it("passes url from metadata into job payload", async () => {
    mockDbFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "delivery-4" }, error: null }),
        }),
      }),
    });

    await queueNotification({
      church_id: "c1",
      recipient_user_id: "u1",
      channel: "push",
      notification_type: "with_url",
      body: "Click me",
      metadata: { url: "/payments" },
    });

    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ url: "/payments" }),
      })
    );
  });
});
