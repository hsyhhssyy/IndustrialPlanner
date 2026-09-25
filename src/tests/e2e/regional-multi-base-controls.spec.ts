import { expect, test } from "./canvas-lock-audit";

test("fixed infinite resources remain visible outside the editable regional list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "基地" }).click();

  const fixedSupply = page.getByText("仓库固定无限供应", { exact: true }).locator("..");
  const card = fixedSupply.locator("xpath=ancestor::article");
  await expect(fixedSupply).toBeVisible();
  await expect(fixedSupply).toContainText(/清水\s*∞/);
  await expect(fixedSupply).toContainText(/沉积酸\s*∞/);
  await expect(fixedSupply.locator("button, input")).toHaveCount(0);

  const regionTag = await card.locator("h3").locator("..").locator("span").innerText();
  await page.evaluate((tag) => {
    window.__industrialPlannerAppHost?.regionalSettings.setRegionResources(tag, []);
  }, regionTag);
  await expect.poll(() => page.evaluate((tag) =>
    window.__industrialPlannerAppHost?.regionalSettings.getRegionResources(tag),
  regionTag)).toEqual([]);
  await expect(card.getByRole("button", { name: "移除资源" })).toHaveCount(0);
  await expect(fixedSupply).toBeVisible();
});

test("regional multi-base mode keeps full speed controls and resolves timeline UI", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem("v3-user-settings-dialog", JSON.stringify({
      selectedGroupId: "experimental",
      values: {
        "other-experimental-features": true,
        "experimental-dense-simulation-engine": true,
      },
    }));
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

  const regionalSwitch = page.getByRole("switch", { name: "同时运行所有基地" });
  const helpButton = page.getByRole("button", { name: "同时运行所有基地帮助" });
  await expect(regionalSwitch).not.toBeChecked();
  await helpButton.click();

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("启用该选项后，会同时运行同一地区的所有基地，共享仓库。");
  await expect(tooltip.locator("strong")).toHaveCount(3);
  await expect(regionalSwitch).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(page.getByRole("dialog", { name: "时间轴" })).toBeVisible();

  await page.locator("label").filter({ hasText: "同时运行所有基地" }).click();
  const tutorial = page.locator('[data-dialog-key="regional-multi-base-guide"]');
  await expect(tutorial).toBeVisible();
  await expect(tutorial.locator("p").first()).toHaveText("请注意");
  await expect(tutorial).not.toContainText("你可以使用作弊工具里的虚空矿机来进行模拟采矿");
  await expect(tutorial.locator("strong")).toHaveCount(3);
  await expect(tutorial.locator("p").last()).toHaveText("(点击任意位置关闭)");
  await tutorial.click({ position: { x: 4, y: 4 } });

  // AI-REMOVED 2026-09-22:
  // Reason: 多基地模式不再回落 x1，也不再隐藏 x4/x16。
  // Trigger: 用户要求所有模式均可使用完整速度。
  // Evidence: 顶栏始终渲染完整速度集合，Dense Host 保留并接受高倍率。
  // Replacement: 下方验证 x16 保持选中且 x4/x16 均可见。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // await expect(page.getByRole("button", { name: "速率 x1" })).toHaveAttribute("aria-pressed", "true");
  // await expect(page.getByRole("button", { name: "速率 x4" })).toHaveCount(0);
  // await expect(page.getByRole("button", { name: "速率 x16" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "速率 x16" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "速率 x4" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "速率 x16" })).toHaveCount(1);
  await expect(page.locator('[data-ui-button-id="top-bar-timeline"]')).toBeDisabled();
  await expect(page.getByText("同时运行所有基地功能不能和时间轴功能同时使用", { exact: true })).toBeVisible();
  // AI-REMOVED 2026-09-22:
  // Reason: 多基地开关不再把先前选择的 x16 改写为 x1。
  // Trigger: 用户撤销区域模式倍率归一化需求。
  // Evidence: 上方按钮状态与 Dense simulationSpeed 均应继续保持 x16。
  // Replacement: 下方 speed: 16 状态断言。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // await expect.poll(() => page.evaluate(() => ({
  //   speed: window.__industrialPlannerAppHost?.workspace.simulation?.state.simulationSpeed,
  //   timelineEnabled: window.__industrialPlannerAppHost?.workspace.simulation?.state.timeline.enabled,
  //   timelineVisible: window.__industrialPlannerAppHost?.internalState.workbench.dialogState.timeline.visible,
  // }))).toEqual({
  //   speed: 1,
  //   timelineEnabled: false,
  //   timelineVisible: true,
  // });
  await expect.poll(() => page.evaluate(() => ({
    speed: window.__industrialPlannerAppHost?.workspace.simulation?.state.simulationSpeed,
    timelineEnabled: window.__industrialPlannerAppHost?.workspace.simulation?.state.timeline.enabled,
    timelineVisible: window.__industrialPlannerAppHost?.internalState.workbench.dialogState.timeline.visible,
  }))).toEqual({
    speed: 16,
    timelineEnabled: false,
    timelineVisible: true,
  });

  await page.getByRole("button", { name: "速率 x4" }).click();
  await expect(page.getByRole("button", { name: "速率 x4" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.workspace.simulation?.state.simulationSpeed,
  )).toBe(4);
});

test("legacy keeps regional multi-base disabled and explains the limitation", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem("v3-user-settings-dialog", JSON.stringify({
      selectedGroupId: "experimental",
      values: {
        "other-experimental-features": true,
      },
    }));
    localStorage.setItem("v3-experimental-regional-multi-base", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "基地" }).click();

  const regionalSwitch = page.getByRole("switch", { name: "同时运行所有基地" });
  await expect(regionalSwitch).toBeDisabled();

  await page.evaluate(() => {
    window.__industrialPlannerAppHost?.regionalSettings.setMultiBaseEnabled(true);
  });
  await expect(regionalSwitch).toBeChecked();
  await expect(regionalSwitch).toBeDisabled();

  await page.getByRole("button", { name: "同时运行所有基地帮助" }).click();
  await expect(page.getByRole("tooltip")).toHaveText(
    "传统解析器不支持同时运行所有基地。",
  );

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "开始仿真" }).click();
  await expect.poll(() => page.evaluate(() => ({
    engineKind: window.__industrialPlannerAppHost?.workspace.simulation?.engineKind,
    runningState: window.__industrialPlannerAppHost?.workspace.simulation?.state.runningState,
    simulationMode: window.__industrialPlannerAppHost?.workspace.simulation?.state.simulationMode,
  }))).toEqual({
    engineKind: "legacy",
    runningState: "start",
    simulationMode: "single-base",
  });
});
