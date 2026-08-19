import { expect, test } from "playwright/test";

test("regional multi-base mode resolves conflicting speed and timeline UI", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem("v3-experimental-regional-multi-base", "true");
  });
  await page.goto("/");

  await page.getByRole("button", { name: "时间轴" }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.internalState.workbench.dialogState.timeline.visible,
  )).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.workspace.simulation?.state.timeline.enabled,
  )).toBe(true);
  await page.getByRole("button", { name: "停止仿真" }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.workspace.simulation?.state.runningState,
  )).toBe("stop");

  await page.getByRole("button", { name: "速率 x16" }).click();
  await page.getByRole("button", { name: "基地" }).click();

  const regionalSwitch = page.getByRole("checkbox", { name: "同时运行所有基地" });
  const helpButton = page.getByRole("button", { name: "同时运行所有基地帮助" });
  await expect(regionalSwitch).not.toBeChecked();
  await helpButton.click();

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("启用该选项后，会同时运行同一地区的所有基地，共享仓库。");
  await expect(tooltip.locator("strong")).toHaveCount(4);
  await expect(regionalSwitch).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(page.getByRole("dialog", { name: "时间轴" })).toBeVisible();

  await page.locator("label").filter({ hasText: "同时运行所有基地" }).click();
  const tutorial = page.locator('[data-dialog-key="regional-multi-base-guide"]');
  await expect(tutorial).toBeVisible();
  await expect(tutorial).toContainText("你可以使用作弊工具里的虚空矿机来进行模拟采矿");
  await expect(tutorial.locator("strong")).toHaveCount(4);
  await tutorial.click({ position: { x: 4, y: 4 } });

  await expect(page.getByRole("button", { name: "速率 x1" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "速率 x4" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "速率 x16" })).toHaveCount(0);
  await expect(page.locator('[data-ui-button-id="top-bar-timeline"]')).toBeDisabled();
  await expect(page.getByText("同时运行所有基地功能不能和时间轴功能同时使用", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    speed: window.__industrialPlannerAppHost?.workspace.simulation?.state.simulationSpeed,
    timelineEnabled: window.__industrialPlannerAppHost?.workspace.simulation?.state.timeline.enabled,
    timelineVisible: window.__industrialPlannerAppHost?.internalState.workbench.dialogState.timeline.visible,
  }))).toEqual({
    speed: 1,
    timelineEnabled: false,
    timelineVisible: true,
  });
});
