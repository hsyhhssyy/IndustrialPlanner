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

const WARNING_MESSAGE = "启用动画需要额外下载约 200 MB 的动画资源，并且运行时会消耗约 2 GB 到 4 GB 显存。不推荐电脑性能不够的管理员或者使用手机的管理员开启。关闭该选项不会清除已下载的动画资源，后续再打开时可以继续下载。";

// 开发期 playwright-cli 三档验证完成后独立编写；由单 worker 的正式 E2E 入口串行执行。
test.describe.configure({ mode: "serial" });

for (const profile of SCREEN_PROFILES) {
  test(`设备动画只在确认后开启 [${profile.name}]`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: profile.deviceScaleFactor,
      hasTouch: profile.hasTouch,
      isMobile: profile.isMobile,
      locale: "zh-CN",
    });

    try {
      const page = await context.newPage();
      await installSettingsEnvironment(page, profile.isMobile);
      await page.goto("http://127.0.0.1:4174/");
      await expect(page.locator("canvas").first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => (
        window.__industrialPlannerAppHost?.workspace.editor !== null
        && window.__industrialPlannerAppHost?.workspace.editor !== undefined
      ))).toBe(true);
      expect(await page.evaluate(() => window.__industrialPlannerAppHost?.state.screenProfile)).toMatchObject({
        viewportWidth: profile.viewport.width,
        viewportHeight: profile.viewport.height,
        devicePixelRatio: profile.deviceScaleFactor,
        deviceClass: profile.expectedDeviceClass,
        screenShape: profile.expectedScreenShape,
        hasTouch: profile.hasTouch,
      });

      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settingsDialog = page.getByRole("dialog", { name: "设置", exact: true });
      const animationSwitch = settingsDialog.locator('input[name="game-play-device-animations"]');
      const animationSwitchLabel = settingsDialog.locator(
        'label[for="setting-game-play-device-animations"]',
      );
      await animationSwitchLabel.scrollIntoViewIfNeeded();
      await expect(animationSwitch).not.toBeChecked();
      await testInfo.attach("before.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });

      await animationSwitchLabel.click();
      const warningDialog = page.getByRole("dialog", { name: "启用设备动画", exact: true });
      await expect(warningDialog).toBeVisible();
      await expect(warningDialog.locator("p")).toHaveText(WARNING_MESSAGE);
      await expect(warningDialog.getByRole("button", { name: "取消", exact: true })).toBeVisible();
      await expect(warningDialog.getByRole("button", { name: "确定", exact: true })).toBeVisible();
      await expect(animationSwitch).not.toBeChecked();
      expect(await readDeviceAnimationSetting(page)).toBe(false);

      const warningBox = await warningDialog.boundingBox();
      expect(warningBox).not.toBeNull();
      if (warningBox === null) {
        throw new Error("设备动画警告窗口不可见");
      }
      expect(warningBox.x).toBeGreaterThanOrEqual(0);
      expect(warningBox.y).toBeGreaterThanOrEqual(0);
      expect(warningBox.x + warningBox.width).toBeLessThanOrEqual(profile.viewport.width);
      expect(warningBox.y + warningBox.height).toBeLessThanOrEqual(profile.viewport.height);
      await page.screenshot({ path: testInfo.outputPath(`${profile.name}-warning.png`) });

      await warningDialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(warningDialog).toBeHidden();
      await expect(animationSwitch).not.toBeChecked();
      expect(await readDeviceAnimationSetting(page)).toBe(false);

      await animationSwitchLabel.click();
      await warningDialog.getByRole("button", { name: "确定", exact: true }).click();
      await expect(warningDialog).toBeHidden();
      await expect(animationSwitch).toBeChecked();
      expect(await readDeviceAnimationSetting(page)).toBe(true);

      await animationSwitchLabel.click();
      await expect(warningDialog).toBeHidden();
      await expect(animationSwitch).not.toBeChecked();
      expect(await readDeviceAnimationSetting(page)).toBe(false);
      await testInfo.attach("after.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
    } finally {
      await context.close();
    }
  });
}

async function installSettingsEnvironment(page: Page, isMobile: boolean): Promise<void> {
  await page.addInitScript((mobile) => {
    localStorage.setItem("v3-user-settings-dialog", JSON.stringify({
      selectedGroupId: "experimental",
      values: {
        "other-experimental-features": true,
      },
    }));

    if (mobile) {
      return;
    }

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
  }, isMobile);
}

async function readDeviceAnimationSetting(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => (
    window.__industrialPlannerAppHost?.state.settings.gamePlayDeviceAnimations
  ));
}
