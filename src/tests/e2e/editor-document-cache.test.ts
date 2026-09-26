import { expect, test, type Page } from "playwright/test";
import type { EditorHost } from "@/editor/editor-host";
import type { EditorDocumentRepositoryOptions } from "@/editor/document-repository";

const SCREEN_PROFILES = [
  { name: "mobile", width: 764, height: 345, dpr: 3.125, shape: "landscape" },
  { name: "tablet", width: 711, height: 665, dpr: 3.125, shape: "square" },
  { name: "desktop", width: 2552, height: 1315, dpr: 1, shape: "landscape" },
] as const;

declare global {
  interface Window {
    __req038CacheProbe?: {
      reads: string[];
      saveStarted: boolean;
      releaseSave: () => void;
    };
  }
}

for (const profile of SCREEN_PROFILES) {
  test(`区域缓存保留未落盘编辑，关闭多基地后刷新恢复 [${profile.name}]`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      hasTouch: true,
      isMobile: profile.name === "mobile",
    });
    try {
      await context.addInitScript(() => {
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
      });
      if (profile.name === "desktop") {
        await context.addInitScript(() => {
          // 支持触控的桌面仍使用精细主指针，避免被环境检测归为平板。
          const nativeMatchMedia = window.matchMedia.bind(window);
          window.matchMedia = (query) => query === "(pointer: coarse)" || query === "(hover: none)"
            ? {
                matches: false, media: query, onchange: null,
                addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
                dispatchEvent() { return false; },
              }
            : nativeMatchMedia(query);
        });
      }
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:4174/");
      await expect.poll(() => page.evaluate(() => {
        const editor = window.__industrialPlannerAppHost?.workspace.editor as EditorHost | null | undefined;
        return editor?.internalDocuments.snapshots().length ?? 0;
      })).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.state.screenProfile)).toMatchObject({
        viewportWidth: profile.width, viewportHeight: profile.height,
        devicePixelRatio: profile.dpr, deviceClass: profile.name, screenShape: profile.shape, hasTouch: true,
      });
      await page.getByRole("button", { name: "基地", exact: true }).click();
      await page.locator("label").filter({ hasText: "同时运行所有基地" }).click();
      const tutorial = page.locator('[data-dialog-key="regional-multi-base-guide"]');
      if (await tutorial.isVisible()) await tutorial.click({ position: { x: 4, y: 4 } });

      const region = await page.evaluate(() => {
        const app = window.__industrialPlannerAppHost!;
        const current = app.workspace.editor!.document.getSnapshot().baseId;
        const tag = app.workspace.registry.baseDefinitions.find((base) => base.id === current)!.tag;
        return { current, bases: app.workspace.registry.baseDefinitions.filter((base) => base.tag === tag).map((base) => base.id).sort() };
      });
      await expect.poll(() => readCachedBases(page)).toEqual(region.bases);
      await testInfo.attach("before.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      await page.evaluate(async () => {
        const editor = window.__industrialPlannerAppHost!.workspace.editor as EditorHost;
        await editor.internalDocuments.flush();
        // 只在 I/O 边界观测读取并延迟保存，编辑与切换仍由真实 UI 触发。
        const options = (editor.internalDocuments as unknown as { options: EditorDocumentRepositoryOptions }).options;
        const read = options.read;
        const write = options.write;
        const probe = { reads: [] as string[], saveStarted: false, releaseSave: () => {} };
        const gate = new Promise<void>((resolve) => { probe.releaseSave = resolve; });
        window.__req038CacheProbe = probe;
        Object.assign(options, {
          read: async (baseId: string) => { probe.reads.push(baseId); return read(baseId); },
          write: async (...args: Parameters<typeof write>) => {
            if (!probe.saveStarted) { probe.saveStarted = true; await gate; }
            return write(...args);
          },
        });
      });
      await page.locator("label").filter({ hasText: "无限电力" }).getByRole("switch").click();
      await expect.poll(() => page.evaluate(() => window.__req038CacheProbe?.saveStarted)).toBe(true);
      const otherBase = region.bases.find((baseId) => baseId !== region.current)!;
      await selectBase(page, otherBase);
      await selectBase(page, region.current);
      expect(await page.evaluate(() => ({
        reads: window.__req038CacheProbe!.reads,
        powerMode: window.__industrialPlannerAppHost!.workspace.editor!.document.getSnapshot().documentSettings.powerMode,
      }))).toEqual({ reads: [], powerMode: "real" });

      await page.locator("label").filter({ hasText: "同时运行所有基地" }).click();
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.state.settings.regionalMultiBaseEnabled)).toBe(false);
      expect(await readCachedBases(page)).toEqual(region.bases);
      await page.evaluate(async () => {
        window.__req038CacheProbe!.releaseSave();
        const editor = window.__industrialPlannerAppHost!.workspace.editor as EditorHost;
        await editor.internalDocuments.flush();
      });
      await expect.poll(() => readCachedBases(page)).toEqual([region.current]);
      await page.reload();
      await expect.poll(() => page.evaluate(() => {
        const app = window.__industrialPlannerAppHost;
        const editor = app?.workspace.editor as EditorHost | null | undefined;
        return {
          enabled: app?.state.settings.regionalMultiBaseEnabled,
          bases: editor?.internalDocuments.snapshots().map((document) => document.baseId),
          powerMode: editor?.document.getSnapshot().documentSettings.powerMode,
        };
      })).toEqual({ enabled: false, bases: [region.current], powerMode: "real" });
      await page.getByRole("button", { name: "基地", exact: true }).click();
      await page.locator('[data-ui-button-id="base-current-select"]').scrollIntoViewIfNeeded();
      await testInfo.attach("after.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });
      await page.screenshot({ path: testInfo.outputPath("cache-restored.png") });
    } finally {
      await context.close();
    }
  });
}

async function readCachedBases(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = window.__industrialPlannerAppHost?.workspace.editor as EditorHost | null | undefined;
    return editor?.internalDocuments.snapshots().map((document) => document.baseId).sort() ?? [];
  });
}

async function selectBase(page: Page, baseId: string): Promise<void> {
  await page.locator('[data-ui-button-id="base-current-select"]').click();
  await page.locator(`[data-base-id="${baseId}"]`).click();
  await page.getByRole("dialog", { name: "选择基地" }).getByRole("button", { name: "确定", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.document.getSnapshot().baseId)).toBe(baseId);
}
