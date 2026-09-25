import { expect, test } from "playwright/test";

const SCREEN_PROFILES = [
  { name: "mobile", width: 764, height: 345, dpr: 3.125, deviceClass: "mobile", screenShape: "landscape" },
  { name: "tablet", width: 711, height: 665, dpr: 3.125, deviceClass: "tablet", screenShape: "square" },
  { name: "desktop", width: 2552, height: 1315, dpr: 1, deviceClass: "desktop", screenShape: "landscape" },
] as const;

test.describe.configure({ mode: "serial" });

for (const profile of SCREEN_PROFILES) {
  test(`Inspector 长配方进度连续前进 [${profile.name}]`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      hasTouch: true,
      isMobile: profile.name !== "desktop",
    });

    try {
      if (profile.name === "desktop") {
        await context.addInitScript(() => {
          const nativeMatchMedia = window.matchMedia.bind(window);
          window.matchMedia = ((query) => (
            query === "(pointer: coarse)" || query === "(hover: none)"
              ? {
                  matches: false,
                  media: query,
                  onchange: null,
                  addListener() {},
                  removeListener() {},
                  addEventListener() {},
                  removeEventListener() {},
                  dispatchEvent() { return false; },
                }
              : nativeMatchMedia(query)
          )) as typeof window.matchMedia;
        });
      }

      const page = await context.newPage();
      await page.goto("http://127.0.0.1:4174/");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost?.workspace.editor !== null
        && window.__industrialPlannerAppHost?.workspace.editor !== undefined)).toBe(true);
      expect(await page.evaluate(() => window.__industrialPlannerAppHost?.state.screenProfile)).toMatchObject({
        viewportWidth: profile.width,
        viewportHeight: profile.height,
        devicePixelRatio: profile.dpr,
        deviceClass: profile.deviceClass,
        screenShape: profile.screenShape,
        hasTouch: true,
      });

      await testInfo.attach("before.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });

      await page.evaluate(async () => {
        const host = window.__industrialPlannerAppHost;
        const editor = host?.workspace.editor;
        const simulation = host?.workspace.simulation;
        if (!editor || !simulation) throw new Error("Inspector 测试宿主未就绪");

        const document = structuredClone(editor.document.getSnapshot());
        const entityId = "inspector-progress-test";
        document.entities[entityId] = {
          id: entityId,
          definitionId: "power_sta_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {
            channelRecipes: { default: "r_power_gen_battery_1" },
            "storageSlotGroups[0].slots[0].initialItemType": "item_proc_battery_1",
            "storageSlotGroups[0].slots[0].initialCount": 10,
          },
          tags: [],
        };
        if (!document.entityOrder.includes(entityId)) document.entityOrder.push(entityId);
        await editor.actions.applySynchronizedDocument(document);
        editor.actions.clearCollection("selection");
        editor.actions.addToCollection({ collectionType: "selection", entityId });
        await simulation.actions.start();
      });

      const progress = page.locator(
        '[data-inspector-key="simulation-recipe-status-runtime-inspector"] [data-progress-kind]',
      );
      await expect(progress).toBeVisible();
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost?.workspace.simulation?.queries
          .getDeviceRuntimeStatus("inspector-progress-test")?.channelRecipes.default?.isProgressing,
      )).toBe(true);

      const result = await page.evaluate(async () => {
        const element = document.querySelector<HTMLElement>(
          '[data-inspector-key="simulation-recipe-status-runtime-inspector"] [data-progress-kind]',
        );
        if (element === null) throw new Error("配方进度环未显示");

        let previous: number | null = null;
        let first: number | null = null;
        let last: number | null = null;
        let decreases = 0;
        let samples = 0;
        const until = performance.now() + 3_000;
        while (performance.now() < until) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const value = Number.parseFloat(element.style.getPropertyValue("--recipe-progress-percent"));
          if (!Number.isFinite(value)) continue;
          if (previous !== null && value < previous - 0.0001) decreases += 1;
          first ??= value;
          last = value;
          previous = value;
          samples += 1;
        }

        return { first, last, decreases, samples };
      });

      expect(result.samples).toBeGreaterThan(10);
      expect(result.first).not.toBeNull();
      expect(result.last).toBeGreaterThan(result.first!);
      expect(result.decreases).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`${profile.name}-inspector-progress.png`) });
      await testInfo.attach("after.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
    } finally {
      await context.close();
    }
  });
}
