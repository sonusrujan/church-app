import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockInsertSelect = vi.fn();
const mockUpdateSelect = vi.fn();
const mockDbFrom = vi.fn();
vi.mock("./dbClient", () => ({
  db: {
    from: (...args: any[]) => mockDbFrom(...args),
  },
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("./mailerService", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { enqueueJob, enqueueEmailJob, processJobQueue } from "./jobQueueService";

describe("enqueueJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a job and returns its ID", async () => {
    mockDbFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "job-123" }, error: null }),
        }),
      }),
    });

    const id = await enqueueJob({
      job_type: "send_email",
      payload: { to: "test@test.com", subject: "hi", text: "hello" },
    });

    expect(id).toBe("job-123");
    expect(mockDbFrom).toHaveBeenCalledWith("job_queue");
  });

  it("throws when DB insert fails", async () => {
    mockDbFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: new Error("DB error") }),
        }),
      }),
    });

    await expect(
      enqueueJob({ job_type: "send_sms", payload: { to: "+91", body: "hi" } })
    ).rejects.toThrow("DB error");
  });
});

describe("enqueueEmailJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues with job_type send_email", async () => {
    mockDbFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "email-job-1" }, error: null }),
        }),
      }),
    });

    const id = await enqueueEmailJob("a@b.com", "Subject", "Body text");
    expect(id).toBe("email-job-1");
  });
});

describe("processJobQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns {0,0} when no jobs are found", async () => {
    mockDbFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    });

    const result = await processJobQueue();
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it("returns {0,0} when query fails", async () => {
    mockDbFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: null, error: new Error("timeout") }),
            }),
          }),
        }),
      }),
    });

    const result = await processJobQueue();
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it("returns {0,0} when data is null", async () => {
    mockDbFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });

    const result = await processJobQueue();
    expect(result).toEqual({ processed: 0, failed: 0 });
  });
});
