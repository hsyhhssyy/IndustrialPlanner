import { expect, test } from "playwright/test";

test("调试旧版求解器开关在刷新后切换引擎", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.workspace.simulation?.engineKind,
  )).toBe("dense-v2");

  await page.getByRole("button", { name: "设置", exact: true }).click();
  const legacySwitch = page.locator("#setting-debug-legacy-simulation-engine");
  await expect(legacySwitch).toHaveCount(0);

  await page.locator("label[for=setting-other-debug-mode]").click();
  await expect(legacySwitch).toBeVisible();
  await expect(legacySwitch).not.toBeChecked();
  await expect(legacySwitch).toBeEnabled();
  await expect(page.locator("#setting-experimental-dense-simulation-engine")).toHaveCount(0);
  await expect(page.getByText("使用旧版求解器（需刷新网页）", { exact: true })
    .locator("xpath=ancestor::section[@id]")).toHaveAttribute("id", "settings-dialog-group-debug");

  await page.locator("label[for=setting-debug-legacy-simulation-engine]").click();
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.workspace.simulation?.engineKind,
  )).toBe("dense-v2");
  await expect(page.getByRole("button", { name: "重新加载并应用" })).toBeVisible();

  await page.reload();
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.workspace.simulation?.engineKind,
  )).toBe("legacy");
  await expect(page.locator("#setting-other-debug-mode")).toBeChecked();
  await expect(legacySwitch).toBeChecked();

  await page.locator("label[for=setting-other-debug-mode]").click();
  await expect(legacySwitch).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新加载并应用" })).toBeVisible();

  await page.reload();
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.workspace.simulation?.engineKind,
  )).toBe("dense-v2");
});
