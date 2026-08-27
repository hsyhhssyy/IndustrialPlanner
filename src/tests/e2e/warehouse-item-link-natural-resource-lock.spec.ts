import { expect, test, type Page } from "./canvas-lock-audit";

const TOOLTIP_TEXT = "自然资源现在由基地面板的地区资源卡片控制";
const APP_URL = "http://127.0.0.1:4174/";

const SCREEN_PROFILES = [
  {
    name: "mobile-landscape",
    viewport: { width: 764, height: 345 },
    deviceScaleFactor: 3.125,
    hasTouch: true,
    coarsePointer: true,
    isMobile: true,
    deviceClass: "mobile",
    screenShape: "landscape",
  },
  {
    name: "tablet-square",
    viewport: { width: 711, height: 665 },
    deviceScaleFactor: 3.125,
    hasTouch: true,
    coarsePointer: true,
    isMobile: true,
    deviceClass: "tablet",
    screenShape: "square",
  },
  {
    name: "desktop-landscape",
    viewport: { width: 2552, height: 1315 },
    deviceScaleFactor: 1,
    hasTouch: true,
    coarsePointer: false,
    isMobile: false,
    deviceClass: "desktop",
    screenShape: "landscape",
  },
] as const;

test("natural-resource warehouse links keep a locked infinity control with hover and click tooltip", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  for (const profile of SCREEN_PROFILES) {
    const context = await browser.newContext({
      deviceScaleFactor: profile.deviceScaleFactor,
      hasTouch: profile.coarsePointer,
      isMobile: profile.isMobile,
      viewport: profile.viewport,
    });
    const page = await context.newPage();

    try {
      if (profile.hasTouch && !profile.coarsePointer) {
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
      await page.goto(APP_URL);
      await installNaturalResourceWarehouseLink(page);

      const actualProfile = await page.evaluate(() =>
        window.__industrialPlannerAppHost?.state.screenProfile,
      );
      expect(actualProfile, profile.name).toMatchObject({
        viewportWidth: profile.viewport.width,
        viewportHeight: profile.viewport.height,
        devicePixelRatio: profile.deviceScaleFactor,
        deviceClass: profile.deviceClass,
        screenShape: profile.screenShape,
        hasTouch: profile.hasTouch,
      });

      const lockButton = page.locator("[data-warehouse-link-natural-resource-lock]");
      await expect(lockButton, profile.name).toBeVisible();
      await expect(lockButton, profile.name).toHaveAttribute("aria-disabled", "true");
      await expect(lockButton, profile.name).not.toHaveAttribute("aria-pressed", /.+/);

      if (profile.name === "desktop-landscape") {
        await lockButton.hover();
        await expect(page.getByRole("tooltip"), profile.name).toHaveText(TOOLTIP_TEXT);
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip"), profile.name).toBeHidden();
      }

      const configBefore = await readNaturalResourceIgnoreStock(page);
      if (profile.coarsePointer) {
        await lockButton.tap({ force: true });
      } else {
        await lockButton.click({ force: true });
      }
      await page.mouse.move(0, 0);

      const tooltip = page.getByRole("tooltip");
      await expect(tooltip, profile.name).toHaveText(TOOLTIP_TEXT);
      const geometry = await tooltip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          parentTag: element.parentElement?.tagName ?? null,
          position: getComputedStyle(element).position,
          right: rect.right,
          top: rect.top,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        };
      });
      expect(geometry.parentTag, profile.name).toBe("BODY");
      expect(geometry.position, profile.name).toBe("fixed");
      expect(geometry.left, profile.name).toBeGreaterThanOrEqual(8);
      expect(geometry.right, profile.name).toBeLessThanOrEqual(geometry.viewportWidth - 8);
      expect(geometry.top, profile.name).toBeGreaterThanOrEqual(8);
      expect(geometry.bottom, profile.name).toBeLessThanOrEqual(geometry.viewportHeight - 8);
      expect(await readNaturalResourceIgnoreStock(page), profile.name).toBe(configBefore);

      await page.keyboard.press("Escape");
      await expect(tooltip, profile.name).toBeHidden();
    } finally {
      await context.close();
    }
  }
});

async function installNaturalResourceWarehouseLink(page: Page): Promise<void> {
  await page.evaluate(() => {
    const appHost = window.__industrialPlannerAppHost;
    const editor = appHost?.workspace.editor;
    if (appHost === undefined || editor === null || editor === undefined) {
      throw new Error("AppHost/editor unavailable");
    }

    const entityId = "e2e-natural-resource-unloader";
    const currentDocument = editor.document.getSnapshot();
    editor.actions.applySynchronizedDocument({
      ...currentDocument,
      entities: {
        ...currentDocument.entities,
        [entityId]: {
          id: entityId,
          definitionId: "unloader_1",
          position: { x: 51, y: 34 },
          rotation: 270,
          config: {
            "storageSlotGroups[0].slots[0].ignoreStock": false,
          },
          tags: [],
        },
      },
      entityOrder: [
        ...currentDocument.entityOrder.filter((id) => id !== entityId),
        entityId,
      ],
      slotLinks: [
        ...currentDocument.slotLinks.filter((link) => link.source.entityId !== entityId),
        {
          id: `warehouse-link:${entityId}:unloader_buffer:slot_1`,
          linkType: "share-all",
          source: {
            entityId,
            storageSlotGroupId: "unloader_buffer",
            slotId: "slot_1",
          },
          target: {
            entityId: "warehouse",
            storageSlotGroupId: "warehouse",
            slotId: "item_copper_ore",
          },
        },
      ],
    });
    editor.actions.clearCollection("selection");
    editor.actions.addToCollection({
      collectionType: "selection",
      entityId,
    });
  });
}

async function readNaturalResourceIgnoreStock(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const entity = window.__industrialPlannerAppHost?.workspace.editor?.document
      .getSnapshot().entities["e2e-natural-resource-unloader"];
    return entity?.config["storageSlotGroups[0].slots[0].ignoreStock"];
  });
}
