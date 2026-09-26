import { expect, test, type Page } from "playwright/test";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import fixtureJson from "../fixtures/blueprints/editor-regional-dark-pipe/scene.schema6.json" with { type: "json" };

const fixture = normalizeBlueprintDocument(fixtureJson)!;
const profiles = [
  { name: "mobile", width: 764, height: 345, dpr: 3.125, shape: "landscape" },
  { name: "tablet", width: 711, height: 665, dpr: 3.125, shape: "square" },
  { name: "desktop", width: 2552, height: 1315, dpr: 1, shape: "landscape" },
] as const;

for (const profile of profiles) {
  test(`文档暗管关系、入口断开、出口撤销与关闭模式覆盖 [${profile.name}]`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr, hasTouch: true, isMobile: profile.name === "mobile",
    });
    try {
      await context.addInitScript(profileName => {
        localStorage.setItem("v3-user-settings-dialog", JSON.stringify({ values: {
          "other-experimental-features": true,
          // AI-REMOVED 2026-09-26:
          // Reason: Dense 已是默认引擎，旧 key 不再影响启动选择。
          // Trigger: 求解器开关反转并移入调试分组。
          // Evidence: 新启动偏好只读取 debug-legacy-simulation-engine。
          // Replacement: 下方显式关闭 Legacy 开关。
          // Risk: Low。
          // Human Review: Required
          // Original code:
          // "experimental-dense-simulation-engine": true,
          "debug-legacy-simulation-engine": false,
        } }));
        localStorage.setItem("v3-experimental-regional-multi-base", "true");
        if (profileName !== "desktop") return;
        const matchMedia = window.matchMedia.bind(window);
        window.matchMedia = query => query === "(pointer: coarse)" || query === "(hover: none)"
          ? { matches: false, media: query, onchange: null, addListener() {}, removeListener() {},
              addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
          : matchMedia(query);
      }, profile.name);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => {
        if (message.text().includes("[MobX]") && message.text().includes("strict-mode")) {
          errors.push(message.text());
        }
      });
      await page.goto("/");
      await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.simulation !== null
        && window.__industrialPlannerAppHost?.workspace.simulation !== undefined);
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.state.screenProfile)).toMatchObject({
        deviceClass: profile.name, screenShape: profile.shape, devicePixelRatio: profile.dpr,
        viewportWidth: profile.width, viewportHeight: profile.height, hasTouch: true,
      });
      await page.getByRole("button", { name: "基地", exact: true }).click();
      await toggleMultiBase(page);
      const bases = await page.evaluate(async blueprint => {
        const app = window.__industrialPlannerAppHost!;
        const editor = app.workspace.editor!;
        await editor.queries.listBaseDocumentSummaries();
        const inlet = editor.document.getSnapshot().baseId;
        const region = app.workspace.registry.baseDefinitions.find(base => base.id === inlet)!.tag;
        const outlet = app.workspace.registry.baseDefinitions.find(base => base.tag === region && base.id !== inlet)!.id;
        for (const before of await editor.queries.readLatestBaseDocuments([inlet, outlet])) {
          await editor.actions.applySynchronizedDocument({
            ...before, entities: { ...before.entities, ...blueprint.entities },
            entityOrder: [...before.entityOrder, ...blueprint.entityOrder], slotLinks: blueprint.slotLinks,
          });
        }
        return { inlet, outlet };
      }, fixture);
      const panel = page.locator('[data-inspector-key="dark-pipe-link"]');
      await clickEntity(page, "inlet");
      await panel.getByRole("button", { name: "创建链接", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.state.toolInfo.darkPipeLink)).toBeNull();
      await clickEntity(page, "inlet");
      await panel.getByRole("button", { name: "创建链接", exact: true }).click();
      await selectBase(page, bases.outlet);
      await clickEntity(page, "outlet");
      await expect.poll(() => visibleRelationCount(page)).toBe(1);
      const connected = await readLinks(page, [bases.inlet, bases.outlet]);
      expect(connected[0]!.map(link => link.id)).toEqual(["warehouse-outlet", "warehouse-other-outlet"]);
      expect(connected[1]).toHaveLength(2);
      expect(connected[1]).toContainEqual(expect.objectContaining({ id: "warehouse-other-outlet" }));
      expect(connected[1]!.find(link => link.target.baseId !== undefined)?.target).toMatchObject({ baseId: bases.inlet, entityId: "inlet" });
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.document.getSnapshot().entities.outlet!.config)).toEqual({});
      await page.screenshot({ path: testInfo.outputPath("cross-base-visible.png") });
      await testInfo.attach("connected.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      await selectBase(page, bases.inlet);
      await clickEntity(page, "inlet");
      await panel.getByRole("button", { name: "断开链接", exact: true }).click();
      await expect.poll(() => visibleRelationCount(page)).toBe(0);
      await selectBase(page, bases.outlet);
      await focusCanvas(page);
      await page.keyboard.press("Control+z");
      await expect.poll(() => visibleRelationCount(page)).toBe(1);
      await selectBase(page, bases.inlet);
      await toggleMultiBase(page);
      expect(await visibleRelationCount(page)).toBe(0);
      expect((await readLinks(page, [bases.outlet]))[0]!.some(link => link.target.baseId === bases.inlet)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("cross-base-hidden.png") });
      await clickEntity(page, "inlet");
      await expect(panel).not.toContainText("远端");
      await panel.getByRole("button", { name: "创建链接", exact: true }).click();
      await clickEntity(page, "outlet");
      await expect.poll(async () => (await readLinks(page, [bases.inlet]))[0]!.map(link => link.id))
        .toEqual(["warehouse-other-outlet", "dark-pipe-link:outlet:inlet"]);
      expect((await readLinks(page, [bases.outlet]))[0]!.map(link => link.id)).toEqual(["warehouse-other-outlet"]);
      await toggleMultiBase(page);
      expect(await visibleRelationCount(page)).toBe(0);
      await clickEntity(page, "outlet");
      await panel.getByRole("button", { name: "断开链接", exact: true }).click();
      await expect.poll(async () => (await readLinks(page, [bases.inlet]))[0]!.map(link => link.id)).toEqual(["warehouse-other-outlet"]);
      if (profile.name === "desktop") {
        await connectAcrossBases(page, bases);
        await selectBase(page, bases.inlet);
        await toggleMultiBase(page);
        await clickEntity(page, "inlet");
        await page.locator('[data-slot-action="open-slot-editor"]').first().click();
        await page.locator('[data-slot-dialog-action="pick-item"]').click();
        await chooseWater(page);
        await page.locator('[data-slot-dialog-input="count"]').fill("4");
        await page.locator('[data-slot-dialog-action="confirm"]').click();
        expect((await readLinks(page, [bases.outlet]))[0]!.map(link => link.id)).toEqual(["warehouse-other-outlet"]);

        await toggleMultiBase(page);
        await connectAcrossBases(page, bases);
        await toggleMultiBase(page);
        await clickEntity(page, "outlet");
        await page.locator('[data-inspector-key="warehouse-item-link"] [data-slot-action="pick-item"]').click();
        await chooseWater(page);
        const replaced = (await readLinks(page, [bases.outlet]))[0]!;
        expect(replaced).toHaveLength(2);
        expect(replaced.every(link => link.target.entityId === "warehouse")).toBe(true);

        await toggleMultiBase(page);
        await connectAcrossBases(page, bases);
        await selectBase(page, bases.inlet);
        await clickEntity(page, "inlet");
        await page.keyboard.press("f");
        await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.document.getSnapshot().entities.inlet)).toBeUndefined();
        expect((await readLinks(page, [bases.outlet]))[0]!.map(link => link.id)).toEqual(["warehouse-other-outlet"]);
      }
      await dismissInspector(page);
      await page.screenshot({ path: testInfo.outputPath("after.png") });
      await testInfo.attach("after.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

async function connectAcrossBases(page: Page, bases: { inlet: string; outlet: string }): Promise<void> {
  await selectBase(page, bases.inlet);
  await clickEntity(page, "inlet");
  await page.locator('[data-inspector-key="dark-pipe-link"]').getByRole("button", { name: "创建链接", exact: true }).click();
  await selectBase(page, bases.outlet);
  await clickEntity(page, "outlet");
  await expect.poll(() => visibleRelationCount(page)).toBe(1);
}

async function chooseWater(page: Page): Promise<void> {
  await page.locator('[data-dialog-key="encyclopedia-picker"]').getByRole("button").filter({ hasText: "清水" }).first().click();
}

async function dismissInspector(page: Page): Promise<void> {
  const backdrop = page.locator(".inspector-dialog-backdrop");
  if (await backdrop.isVisible()) await backdrop.click({ position: { x: 4, y: 4 } });
}

async function toggleMultiBase(page: Page): Promise<void> {
  await dismissInspector(page);
  await page.locator("label").filter({ hasText: "同时运行所有基地" }).click();
  const guide = page.locator('[data-dialog-key="regional-multi-base-guide"]');
  if (await guide.isVisible()) await guide.click({ position: { x: 4, y: 4 } });
}

async function selectBase(page: Page, baseId: string): Promise<void> {
  await dismissInspector(page);
  await page.locator('[data-ui-button-id="base-current-select"]').click();
  await page.locator(`[data-base-id="${baseId}"]`).click();
  await page.getByRole("dialog", { name: "选择基地" }).getByRole("button", { name: "确定", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.document.getSnapshot().baseId)).toBe(baseId);
}

async function clickEntity(page: Page, entityId: string): Promise<void> {
  await dismissInspector(page);
  // 定位视口属于测试布景；实体选择和建链由原生点击完成。
  await page.evaluate(id => window.__industrialPlannerAppHost!.workspace.editor!.actions.focusOnEntity(id, { duration: 100 }), entityId);
  await page.waitForTimeout(250);
  const rect = await page.evaluate(id => {
    const editor = window.__industrialPlannerAppHost!.workspace.editor!;
    return editor.queries.findClientRectForGridCell(editor.document.getSnapshot().entities[id]!.position);
  }, entityId);
  if (rect === null) throw new Error(`Entity ${entityId} has no canvas rectangle.`);
  await page.mouse.click(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

async function focusCanvas(page: Page): Promise<void> {
  await dismissInspector(page);
  const rect = (await page.locator("main").boundingBox())!;
  await page.mouse.click(rect.x + 50, rect.y + 50);
}

async function visibleRelationCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.queries.getRegionalDarkPipeLinks().length);
}

async function readLinks(page: Page, baseIds: string[]) {
  return page.evaluate(async ids => (await window.__industrialPlannerAppHost!.workspace.editor!.queries.readLatestBaseDocuments(ids)).map(document => document.slotLinks), baseIds);
}
