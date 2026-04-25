import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (vi.mock factories are hoisted — no top-level variable refs) ──

const mockQuery = vi.fn();
const mockRelease = vi.fn();

vi.mock("./dbClient", () => ({
  db: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      insert: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn().mockReturnThis(),
    })),
  },
  getClient: vi.fn(),
}));

vi.mock("../utils/logger", () => {
  const l: any = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  l.child = vi.fn(() => l);
  return { logger: l };
});

vi.mock("../utils/subscriptionHelpers", () => ({
  computeNextDueDate: vi.fn((current: string, _cycle: string) => {
    const d = new Date(current);
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }),
}));

import {
  monthLabel,
  buildMonthRange,
} from "./subscriptionMonthlyDuesService";

// ── Pure function tests ──

describe("monthLabel", () => {
  it("formats 2025-01-01 as 'Jan 2025'", () => {
    expect(monthLabel("2025-01-01")).toBe("Jan 2025");
  });

  it("formats 2025-12-01 as 'Dec 2025'", () => {
    expect(monthLabel("2025-12-01")).toBe("Dec 2025");
  });
});

describe("buildMonthRange", () => {
  it("returns single month when start === end", () => {
    expect(buildMonthRange("2025-03-01", "2025-03-01")).toEqual(["2025-03-01"]);
  });

  it("returns correct range from Jan to Apr", () => {
    const range = buildMonthRange("2025-01-01", "2025-04-01");
    expect(range).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
      "2025-04-01",
    ]);
  });

  it("handles year boundary correctly", () => {
    const range = buildMonthRange("2025-11-01", "2026-02-01");
    expect(range).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("returns empty when start > end", () => {
    expect(buildMonthRange("2025-06-01", "2025-03-01")).toEqual([]);
  });
});

// ── Jan 2025 floor enforcement ──

describe("buildMonthRange enforces Jan 2025 floor", () => {
  it("does not include months before the supplied start", () => {
    // The service calls buildMonthRange with start = max(sub.start_date, 2025-01-01)
    // So if start_date was 2024-06-01, the caller would pass 2025-01-01
    const range = buildMonthRange("2025-01-01", "2025-04-01");
    expect(range[0]).toBe("2025-01-01");
    expect(range).not.toContain("2024-12-01");
  });
});

// ── Validation in allocation ──

describe("allocateOldestPendingMonthsAtomic validation", () => {
  let allocateOldestPendingMonthsAtomic: typeof import("./subscriptionMonthlyDuesService").allocateOldestPendingMonthsAtomic;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Wire up getClient to return our mock client
    const { getClient } = await import("./dbClient");
    (getClient as any).mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
    const mod = await import("./subscriptionMonthlyDuesService");
    allocateOldestPendingMonthsAtomic = mod.allocateOldestPendingMonthsAtomic;
  });

  it("rejects zero months_to_allocate", async () => {
    await expect(
      allocateOldestPendingMonthsAtomic({
        payment_id: "p1",
        subscription_id: "s1",
        member_id: "m1",
        church_id: "c1",
        monthly_amount: 100,
        months_to_allocate: 0,
        person_name: "Test",
      })
    ).rejects.toThrow("months_to_allocate must be a positive integer");
  });

  it("rejects negative monthly_amount", async () => {
    await expect(
      allocateOldestPendingMonthsAtomic({
        payment_id: "p1",
        subscription_id: "s1",
        member_id: "m1",
        church_id: "c1",
        monthly_amount: -50,
        months_to_allocate: 2,
        person_name: "Test",
      })
    ).rejects.toThrow("Invalid monthly amount");
  });

  it("rejects fractional months_to_allocate", async () => {
    await expect(
      allocateOldestPendingMonthsAtomic({
        payment_id: "p1",
        subscription_id: "s1",
        member_id: "m1",
        church_id: "c1",
        monthly_amount: 100,
        months_to_allocate: 1.5,
        person_name: "Test",
      })
    ).rejects.toThrow("months_to_allocate must be a positive integer");
  });

  it("rejects when insufficient pending months", async () => {
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "d1", due_month: "2025-01-01" }] }) // SELECT ... FOR UPDATE (only 1 pending)
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      allocateOldestPendingMonthsAtomic({
        payment_id: "p1",
        subscription_id: "s1",
        member_id: "m1",
        church_id: "c1",
        monthly_amount: 100,
        months_to_allocate: 3,
        person_name: "Test",
      })
    ).rejects.toThrow("Requested 3 months but only 1 pending");

    expect(mockRelease).toHaveBeenCalled();
  });

  it("FIFO: allocates oldest pending months first", async () => {
    const pendingRows = [
      { id: "d1", due_month: "2025-01-01" },
      { id: "d2", due_month: "2025-02-01" },
      { id: "d3", due_month: "2025-03-01" },
      { id: "d4", due_month: "2025-04-01" },
    ];

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: pendingRows }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({}) // UPDATE set paid
      .mockResolvedValueOnce({}) // INSERT allocation row 1
      .mockResolvedValueOnce({}) // INSERT allocation row 2
      .mockResolvedValueOnce({ rows: [{ due_month: "2025-03-01" }] }) // next pending
      .mockResolvedValueOnce({}) // UPDATE subscription
      .mockResolvedValueOnce({}); // COMMIT

    const result = await allocateOldestPendingMonthsAtomic({
      payment_id: "p1",
      subscription_id: "s1",
      member_id: "m1",
      church_id: "c1",
      monthly_amount: 100,
      months_to_allocate: 2,
      person_name: "Alice",
    });

    // Should return the first 2 due months (FIFO order)
    expect(result).toEqual(["2025-01-01", "2025-02-01"]);

    // The UPDATE should mark exactly d1 and d2 as paid
    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[1]).toEqual(["p1", ["d1", "d2"]]);
  });
});
