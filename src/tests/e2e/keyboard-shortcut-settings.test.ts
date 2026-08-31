import { expect, test, type Page } from "playwright/test";

const SCREEN_PROFILES = [
  {
    name: "mobile-landscape",
    viewport: { width: 764, height: 345 },
    deviceScaleFactor: 3.125,
    hasTouch: true,
    isMobile: true,
    expectedDeviceClass: "mobile",
    expectedScreenShape: "landscape",
  },
  {
    name: "tablet-square",
    viewport: { width: 711, height: 665 },
    deviceScaleFactor: 3.125,
    hasTouch: true,
    isMobile: true,
    expectedDeviceClass: "tablet",
    expectedScreenShape: "square",
  },
  {
    name: "desktop-landscape",
    viewport: { width: 2552, height: 1315 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: false,
    expectedDeviceClass: "desktop",
    expectedScreenShape: "landscape",
  },
] as const;

const EXPECTED_GROUPS = [
  { id: "quick-access", title: "快速访问与面板", actionCount: 6 },
  { id: "placement", title: "放置入口", actionCount: 7 },
  { id: "operation", title: "当前操作与选区", actionCount: 8 },
  { id: "viewport", title: "视口", actionCount: 5 },
  { id: "history", title: "历史", actionCount: 2 },
] as const;

test("shortcut settings groups actions and resolves conflicts from real route scopes", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  for (const profile of SCREEN_PROFILES) {
    const context = await browser.newContext({
      deviceScaleFactor: profile.deviceScaleFactor,
      hasTouch: profile.hasTouch,
      isMobile: profile.isMobile,
      locale: "zh-CN",
      viewport: profile.viewport,
    });
    const page = await context.newPage();

    try {
      if (profile.hasTouch && !profile.isMobile) {
        await installFinePointerTouchEnvironment(page);
      }
      await page.goto("/");
      await openShortcutSettings(page);

      const actualProfile = await page.evaluate(() =>
        window.__industrialPlannerAppHost?.state.screenProfile,
      );
      expect(actualProfile, profile.name).toMatchObject({
        viewportWidth: profile.viewport.width,
        viewportHeight: profile.viewport.height,
        devicePixelRatio: profile.deviceScaleFactor,
        deviceClass: profile.expectedDeviceClass,
        screenShape: profile.expectedScreenShape,
        hasTouch: profile.hasTouch,
      });

      const shortcutDialog = page.locator(".keyboard-shortcut-settings-dialog");
      await expect(shortcutDialog.locator('[data-shortcut-id][data-slot-index="0"]')).toHaveCount(28);
      await expect(shortcutDialog.locator("[data-shortcut-group]")).toHaveCount(5);
      for (const groupSpec of EXPECTED_GROUPS) {
        const group = shortcutDialog.locator(`[data-shortcut-group="${groupSpec.id}"]`);
        await expect(group.getByRole("heading", { level: 2, name: groupSpec.title })).toBeVisible();
        await expect(group.locator(":scope > article")).toHaveCount(groupSpec.actionCount);
      }

      if (profile.name !== "desktop-landscape") {
        continue;
      }

      const rotate = primarySlot(page, "shortcut-rotate");
      const resourcesPower = primarySlot(page, "shortcut-resources-power");
      await captureBinding(page, "shortcut-rotate", "g");
      await expect(page.locator(".keyboard-shortcut-conflict-dialog")).toHaveCount(0);
      await expect(rotate).toHaveAttribute("aria-label", /· G$/);
      await expect(resourcesPower).toHaveAttribute("aria-label", /· G$/);

      await captureBinding(page, "shortcut-rotate", "v");
      const chordConflict = page.locator(".keyboard-shortcut-conflict-dialog");
      await expect(chordConflict).toBeVisible();
      await expect(chordConflict).toContainText("粘贴选区（Ctrl+V）");
      await chordConflict.getByRole("button", { name: "取消" }).click();
      await expect(rotate).toHaveAttribute("aria-label", /· G$/);

      const quickPlace = primarySlot(page, "shortcut-quick-place");
      await captureBinding(page, "shortcut-quick-place", "1");
      const fixedConflict = page.locator(".keyboard-shortcut-conflict-dialog");
      await expect(fixedConflict).toContainText("选择放置设备快捷位（1）");
      await expect(fixedConflict).toContainText("无法替换");
      await expect(fixedConflict.getByRole("button", { name: "更换" })).toHaveCount(0);
      await fixedConflict.getByRole("button", { name: "取消" }).click();
      await expect(quickPlace).toHaveAttribute("aria-label", /· Z$/);

      await resetAllShortcuts(page);
      await expect(rotate).toHaveAttribute("aria-label", /· R$/);
      const rotateViewport = primarySlot(page, "shortcut-rotate-viewport");
      await expect(rotateViewport).toHaveAttribute("aria-label", /· Ctrl\+R$/);

      await captureBinding(page, "shortcut-rotate-viewport", "r");
      await expect(page.locator(".keyboard-shortcut-conflict-dialog")).toHaveCount(0);
      await expect(rotate).toHaveAttribute("aria-label", /· R$/);
      await expect(rotateViewport).toHaveAttribute("aria-label", /· R$/);

      await page.reload();
      await openShortcutSettings(page);
      await expect(primarySlot(page, "shortcut-rotate")).toHaveAttribute("aria-label", /· R$/);
      await expect(primarySlot(page, "shortcut-rotate-viewport")).toHaveAttribute("aria-label", /· R$/);

      await captureModifierOnlyBinding(page, "shortcut-rotate", "Control");
      await expect(primarySlot(page, "shortcut-rotate")).toHaveAttribute("aria-label", /· Ctrl$/);
    } finally {
      await context.close();
    }
  }
});

async function openShortcutSettings(page: Page): Promise<void> {
  const shortcutDialog = page.locator(".keyboard-shortcut-settings-dialog");
  if (await shortcutDialog.isVisible()) {
    return;
  }
  const settingsDialog = page.getByRole("dialog", { name: "设置", exact: true });
  if (!await settingsDialog.isVisible()) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
  }
  await page.getByRole("button", { name: "打开快捷键设置", exact: true }).click();
  await expect(shortcutDialog).toBeVisible();
}

function primarySlot(page: Page, shortcutId: string) {
  return page.locator(`[data-shortcut-id="${shortcutId}"][data-slot-index="0"]`);
}

async function captureBinding(page: Page, shortcutId: string, binding: string): Promise<void> {
  await primarySlot(page, shortcutId).click();
  await page.keyboard.press(binding);
}

async function captureModifierOnlyBinding(
  page: Page,
  shortcutId: string,
  modifier: string,
): Promise<void> {
  await primarySlot(page, shortcutId).click();
  await page.keyboard.down(modifier);
  await page.keyboard.up(modifier);
}

async function resetAllShortcuts(page: Page): Promise<void> {
  const shortcutDialog = page.locator(".keyboard-shortcut-settings-dialog");
  await shortcutDialog.getByRole("button", { name: "重置全部快捷键" }).click();
  const resetDialog = page.locator(".keyboard-shortcut-reset-dialog");
  await expect(resetDialog).toBeVisible();
  await resetDialog.getByRole("button", { name: "重置全部快捷键" }).click();
  await expect(resetDialog).toBeHidden();
}

async function installFinePointerTouchEnvironment(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 1,
    });
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = nativeMatchMedia(query);
      if (query !== "(pointer: coarse)" && query !== "(hover: none)") {
        return result;
      }
      return new Proxy(result, {
        get(target, property) {
          if (property === "matches") {
            return false;
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
  });
}
