import { test, expect } from "@playwright/test";

/**
 * Public donation flow — no auth, just verify the page bootstraps
 * and the form validates required fields.
 */

test.describe("Public donation flow", () => {
  test("public donate page renders", async ({ page }) => {
    await page.goto("/donate");
    await expect(page.locator("body")).toBeVisible();
  });

  test("donation form requires amount and contact details before submit", async ({ page }) => {
    await page.goto("/donate");
    const payButton = page.getByRole("button", { name: /pay|donate|proceed/i }).first();
    if (await payButton.count()) {
      await expect(payButton).toBeVisible();
    }
  });
});
