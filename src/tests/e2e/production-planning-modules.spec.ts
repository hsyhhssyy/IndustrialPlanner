import type { Locator } from "playwright/test";

import { expect, test } from "./canvas-lock-audit";

const APP_URL = "http://127.0.0.1:4174/";

const SCREEN_PROFILES = [
  {
    name: "mobile-landscape",
    viewport: { width: 764, height: 345 },
    deviceScaleFactor: 3.125,
    hasTouch: true,
    isMobile: true,
  },
  {
    name: "tablet-square",
    viewport: { width: 711, height: 665 },
    deviceScaleFactor: 3.125,
    hasTouch: true,
    isMobile: true,
  },
  {
    name: "desktop-landscape",
    viewport: { width: 2552, height: 1315 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: false,
  },
] as const;

test("production planning opens the generated module editor before persisting the module", async ({ browser }) => {
  test.setTimeout(180_000);

  for (const profile of SCREEN_PROFILES) {
    const context = await browser.newContext({
      deviceScaleFactor: profile.deviceScaleFactor,
      hasTouch: profile.hasTouch,
      isMobile: profile.isMobile,
      viewport: profile.viewport,
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**cloudflareinsights.com/**", (route) => route.abort());

    try {
      await page.goto(APP_URL);
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost !== undefined))
        .toBe(true);

      await press(page.getByRole("button", { name: "工具箱" }), profile.isMobile);
      await press(page.getByText("产线规划", { exact: true }), profile.isMobile);

      const moduleSwitch = page.getByLabel("使用模块");
      await expect(moduleSwitch, profile.name).not.toBeChecked();
      await moduleSwitch.check();
      await expect(moduleSwitch, profile.name).toBeChecked();

      await press(page.getByRole("button", { name: "添加目标", exact: true }), profile.isMobile);
      const itemPicker = page.getByRole("dialog").last();
      await press(itemPicker.getByText("息壤", { exact: true }), profile.isMobile);
      await press(page.getByRole("button", { name: "计算", exact: true }), profile.isMobile);

      const candidateSelect = page.getByLabel("生产候选");
      await expect(candidateSelect, profile.name).toBeVisible();
      await expect(page.getByText("碳块", { exact: true }).first(), profile.name).toBeVisible();
      await test.info().attach(`${profile.name}-system-plan.yaml`, {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });

      await press(page.getByRole("button", { name: "转为模块", exact: true }), profile.isMobile);
      const moduleEditorTitle = page.getByRole("heading", { name: "编辑模块", exact: true });
      await expect(moduleEditorTitle, profile.name).toBeVisible();
      await expect(page.getByLabel("模块名称"), profile.name).toHaveValue("未命名模块");
      await expect.poll(() => page.evaluate(() => (
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox
          .moduleBalancing.customModules.length ?? -1
      )), { message: profile.name }).toBe(0);

      await page.getByLabel("模块名称").fill("息壤产线模块");
      await press(page.getByRole("button", { name: "保存模块", exact: true }), profile.isMobile);
      await expect(moduleEditorTitle, profile.name).toBeHidden();
      await expect.poll(() => page.evaluate(() => {
        const modules = window.__industrialPlannerAppHost?.internalState.workbench.toolbox
          .moduleBalancing.customModules;
        const value = modules?.[0];
        return value === undefined ? null : {
          id: value.id,
          name: value.name,
          inputs: value.inputs.map((input) => ({
            itemId: input.itemId,
            perMinute: input.perMinute,
          })),
          outputs: value.outputs.map((output) => ({
            itemId: output.itemId,
            perMinute: output.perMinute,
          })),
        };
      }), { message: profile.name }).not.toBeNull();
      // AI-REMOVED 2026-08-29:
      // Reason: Playwright expect.poll 的 matcher 返回 void，旧写法把 void 赋值后再断言 undefined，没有验证模块状态。
      // Trigger: 新增正式 E2E 回归时审计异步轮询返回值。
      // Evidence: expect.poll(...).not.toBeNull() 的职责是等待断言通过，真实模块值应在轮询后从 AppHost 读取。
      // Replacement: 上方直接 await 轮询，以及下方 moduleState 结构化断言。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const generatedModule = await expect.poll(...).not.toBeNull();
      // expect(generatedModule, profile.name).toBeUndefined();

      const moduleState = await page.evaluate(() => {
        const value = window.__industrialPlannerAppHost?.internalState.workbench.toolbox
          .moduleBalancing.customModules[0];
        return value === undefined ? null : {
          id: value.id,
          name: value.name,
          inputs: value.inputs.map((input) => ({ itemId: input.itemId, perMinute: input.perMinute })),
          outputs: value.outputs.map((output) => ({ itemId: output.itemId, perMinute: output.perMinute })),
        };
      });
      expect(moduleState?.name, profile.name).toBe("息壤产线模块");
      expect(moduleState?.outputs, profile.name).toEqual([
        { itemId: "item_xiranite_powder", perMinute: 30 },
      ]);
      expect(moduleState?.inputs, profile.name).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemId: "item_liquid_water", perMinute: 30 }),
      ]));
      // AI-REMOVED 2026-08-29:
      // Reason: 产线规划中的植物—种子闭环属于稳定自循环，不是生成模块的外部端口。
      // Trigger: 正式 E2E 回归需要断言模块真实黑盒边界，不能把闭环内部流量当外部输入。
      // Evidence: createProductionPlanningModule 只汇总手动/无限供应和自然资源采集边界；植物闭环由 cycle supply 闭合。
      // Replacement: 上方清水自然资源边界断言；植物闭环通过重新求解自动采用模块间接验证。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // expect.objectContaining({ itemId: "item_plant_moss_1", perMinute: 30 }),

      await press(page.getByText("产线规划", { exact: true }), profile.isMobile);
      await expect(candidateSelect.locator("option", { hasText: "息壤产线模块 · 自定义模块" }), profile.name)
        .toHaveCount(1);
      await expect(page.getByText("自定义模块 · 由 息壤产线模块 产出", { exact: true }), profile.name)
        .toBeVisible();
      await expect(moduleSwitch, profile.name).toBeChecked();
      await test.info().attach(`${profile.name}-module-plan.yaml`, {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });

      expect(pageErrors, profile.name).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

async function press(target: Locator, useTap: boolean): Promise<void> {
  if (useTap) {
    await target.tap();
    return;
  }

  await target.click();
}
