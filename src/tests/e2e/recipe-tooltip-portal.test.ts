import { expect, test } from "playwright/test";

test("recipe item tooltip escapes inspector clipping without changing layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");

  await page.evaluate(() => {
    const appHost = window.__industrialPlannerAppHost;
    const editor = appHost?.workspace.editor;
    if (appHost === undefined || editor === null || editor === undefined) {
      throw new Error("AppHost/editor unavailable");
    }

    const definitionId = "mix_pool_1";
    const definition = appHost.workspace.registry.entityDefinitions.find(
      (candidate) => candidate.id === definitionId,
    );
    if (definition === undefined) {
      throw new Error(`Missing entity definition: ${definitionId}`);
    }

    const recipeIds = appHost.workspace.registry.recipeDefinitions
      .filter((recipe) => recipe.machineId === definitionId)
      .slice(0, 4)
      .map((recipe) => recipe.id);
    if (recipeIds.length !== 4) {
      throw new Error(`Expected four recipes for ${definitionId}`);
    }

    const entityId = "e2e-recipe-tooltip";
    const currentDocument = editor.document.getSnapshot();
    editor.actions.applySynchronizedDocument({
      ...currentDocument,
      entities: {
        ...currentDocument.entities,
        [entityId]: {
          id: entityId,
          definitionId,
          position: { x: 40, y: 40 },
          rotation: 0,
          config: {
            recipeChannelAutomaticModeEnabled: false,
            channelRecipes: Object.fromEntries(
              definition.recipeChannels.slice(0, 4).map((channel, index) => [
                channel.id,
                recipeIds[index],
              ]),
            ),
          },
          tags: [],
        },
      },
      entityOrder: [
        ...currentDocument.entityOrder.filter((id) => id !== entityId),
        entityId,
      ],
    });
    editor.actions.addToCollection({
      collectionType: "selection",
      entityId,
    });
  });

  const recipePanel = page.locator(
    '[data-inspector-key="simulation-recipe-status-runtime-inspector"]',
  );
  await expect(recipePanel).toBeVisible();

  const inspectorRectsBefore = await readInspectorRects();
  await recipePanel.locator("[data-recipe-item-id]").last().hover();

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const geometry = await page.evaluate(() => {
    const panelElement = document.querySelector<HTMLElement>(
      '[data-inspector-key="simulation-recipe-status-runtime-inspector"]',
    );
    const tooltipElement = document.querySelector<HTMLElement>(
      "[data-recipe-item-tooltip]",
    );
    if (panelElement === null || tooltipElement === null) {
      throw new Error("Recipe panel/tooltip unavailable");
    }

    const panelRect = panelElement.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    return {
      panelBottom: panelRect.bottom,
      tooltipBottom: tooltipRect.bottom,
      tooltipLeft: tooltipRect.left,
      tooltipRight: tooltipRect.right,
      tooltipTop: tooltipRect.top,
      tooltipParentTag: tooltipElement.parentElement?.tagName ?? null,
      tooltipPosition: getComputedStyle(tooltipElement).position,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(geometry.tooltipParentTag).toBe("BODY");
  expect(geometry.tooltipPosition).toBe("fixed");
  expect(geometry.tooltipBottom).toBeGreaterThan(geometry.panelBottom);
  expect(geometry.tooltipLeft).toBeGreaterThanOrEqual(8);
  expect(geometry.tooltipRight).toBeLessThanOrEqual(geometry.viewportWidth - 8);
  expect(geometry.tooltipTop).toBeGreaterThanOrEqual(8);
  expect(geometry.tooltipBottom).toBeLessThanOrEqual(geometry.viewportHeight - 8);
  expect(await readInspectorRects()).toEqual(inspectorRectsBefore);

  async function readInspectorRects() {
    return page.locator("[data-inspector-key]").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          key: element.getAttribute("data-inspector-key"),
          height: rect.height,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        };
      }),
    );
  }
});
