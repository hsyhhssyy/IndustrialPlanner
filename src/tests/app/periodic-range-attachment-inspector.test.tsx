// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { createSceneAttachmentReference, resolvePeriodicRangeRegions } from "@/app/canvas";
import { PeriodicRangeAttachmentInspector } from "@/app/shell/inspector/periodic-range-attachment-inspector";
import type { WorldDocument } from "@/domain/document/world-document";
import { createWorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { lookupText } from "@/shared/i18n";
import { createAppTestHost, createEditorTestHost } from "@/tests/helpers/app-test-workspace";

const PROGRAM: PeriodicRangeConversionProgram = {
  id: "fixture:program",
  periodSeconds: 10,
  effects: [
    { probabilityByLayer: [1], outputItemByInputId: {} },
    { probabilityByLayer: [1], outputItemByInputId: {} },
    { probabilityByLayer: [0.4], outputItemByInputId: {} },
  ],
};

interface SourceSpec {
  readonly id: string;
  readonly x: number;
  readonly side: 0 | 1;
  /** 让矩形相对默认共享区域额外横向偏移，用于制造部分重叠。 */
  readonly rectOffsetX?: number;
}

function createDefinition(id: string, offsetX: number, width: number): EntityDefinition {
  const definitionId = `fixture-machine-${id}`;
  return {
    id: definitionId,
    nameKey: definitionId,
    spriteId: "fixture",
    iconPath: "",
    footprint: { width: 1, height: 1 },
    displayOrder: 1,
    uiGroup: "hidden",
    tags: [],
    inspectors: [],
    requiresPower: false,
    powerDemand: 0,
    placementBehaviors: [],
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
    recipeChannels: [{
      id: "phase",
      type: "consumption-channel",
      manualRecipeOnly: true,
      ingredientStorageGroupIds: [],
      productStorageGroupIds: [],
    }],
    ranges: [{
      id: "primary",
      localRect: { x: offsetX, y: 0, width, height: 2 },
      coverage: "contains",
      visualId: "fixture:primary",
      placementRule: { groupId: "fixture", overlap: "disjoint-or-equal", allowedSegments: ["belt", "pipe"] },
    }],
  };
}

function createRecipe(definitionId: string, id: string, side: 0 | 1): RecipeDefinition {
  return {
    id,
    nameKey: id,
    machineId: definitionId,
    durationSeconds: 1,
    inputs: [],
    outputs: [],
    recipeType: "reserved-item",
    tags: [CONSUMPTION_RECIPE_TAG],
    periodicRangeConversion: { side, rangeIds: ["primary"], program: PROGRAM },
  };
}

/** 每台炉子距离共享区域左侧 offsetX 格，保证设备本体不占入作用范围。 */
function createFixture(sources: readonly SourceSpec[], width = 2) {
  const base = createRegistryContract();
  const entityDefinitions: EntityDefinition[] = [];
  const recipeDefinitions: RecipeDefinition[] = [];
  const document = createWorldDocument({ baseId: "draft_box" });

  for (const source of sources) {
    const definition = createDefinition(source.id, -source.x + (source.rectOffsetX ?? 0), width);
    const recipeId = `fixture:${source.id}:${source.side === 0 ? "ming" : "hui"}`;
    entityDefinitions.push(definition);
    recipeDefinitions.push(createRecipe(definition.id, recipeId, source.side));
    document.entities[source.id] = {
      id: source.id,
      definitionId: definition.id,
      position: { x: source.x, y: 0 },
      rotation: 0,
      config: { channelRecipes: { phase: recipeId } },
      tags: [],
    };
    document.entityOrder.push(source.id);
  }

  return {
    document,
    registry: {
      ...base,
      entityDefinitions: [...base.entityDefinitions, ...entityDefinitions],
      recipeDefinitions: [...base.recipeDefinitions, ...recipeDefinitions],
      queries: createRegistryQuery({
        entityDefinitions: [...base.entityDefinitions, ...entityDefinitions],
        itemDefinitions: base.itemDefinitions,
        recipeDefinitions: [...base.recipeDefinitions, ...recipeDefinitions],
      }),
    },
  };
}

function createWorkspace(registry: ReturnType<typeof createFixture>["registry"], document: WorldDocument) {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(),
    registry,
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
    audio: null,
    blueprintPlanner: null,
  };
  const editor = createEditorTestHost(workspace, { persistence: "memory", initialDocument: document });
  const app = createAppTestHost(workspace);
  return { workspace, editor, app };
}

describe("明晦炉区域附属实体 Inspector", () => {
  let container: HTMLDivElement;
  let root: Root;
  let disposers: Array<() => void>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    disposers = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    for (const dispose of disposers.splice(0).reverse()) dispose();
    container.remove();
    window.localStorage?.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderPanel(app: AppHost, document: WorldDocument) {
    const editor = app.workspace.editor!;
    const regions = resolvePeriodicRangeRegions(app, editor);
    expect(regions).toHaveLength(1);
    const reference = createSceneAttachmentReference(regions[0]!);
    expect(reference.documentKey).toBe(document.documentKey);
    act(() => {
      root.render(
        <PeriodicRangeAttachmentInspector
          appHost={app}
          reference={reference}
          translate={(key) => lookupText("zh-CN", key) ?? key}
        />,
      );
      vi.advanceTimersByTime(50);
    });
    return reference;
  }

  it("仿真未启动时按全部关联来源聚合类型、层数与概率", () => {
    vi.useFakeTimers();
    const { registry, document } = createFixture([
      { id: "ming-1", x: 4, side: 0 },
      { id: "ming-2", x: 8, side: 0 },
      { id: "ming-3", x: 12, side: 0 },
      { id: "hui-1", x: 16, side: 1 },
    ]);
    const { app, editor } = createWorkspace(registry, document);
    disposers.push(() => editor.dispose(), () => app.dispose());
    renderPanel(app, document);

    expect(container.textContent).toContain(lookupText("zh-CN", "inspector.periodicRange.effect.heng"));
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("40%");
    expect(container.textContent).not.toContain(lookupText("zh-CN", "inspector.periodicRange.invalid"));
  });

  it("布局非法时只显示布局非法，不计算层数与概率", () => {
    vi.useFakeTimers();
    const { registry, document } = createFixture([
      { id: "left", x: 4, side: 0 },
      { id: "right", x: 7, side: 1, rectOffsetX: 1 },
    ], 3);
    const { app, editor: appEditor } = createWorkspace(registry, document);
    disposers.push(() => appEditor.dispose(), () => app.dispose());
    const editor = app.workspace.editor!;
    for (const entityId of ["left", "right"]) {
      expect(editor.queries.getEntityPlacementValidation(entityId).reasons.map((reason) => reason.code))
        .toContain("range-partial-overlap");
    }

    const regions = resolvePeriodicRangeRegions(app, editor);
    expect(regions).toHaveLength(2);
    const reference = createSceneAttachmentReference(regions[0]!);
    act(() => {
      root.render(
        <PeriodicRangeAttachmentInspector
          appHost={app}
          reference={reference}
          translate={(key) => lookupText("zh-CN", key) ?? key}
        />,
      );
      vi.advanceTimersByTime(50);
    });

    expect(container.textContent).toContain(lookupText("zh-CN", "inspector.periodicRange.invalid"));
    expect(container.textContent).not.toContain(lookupText("zh-CN", "inspector.periodicRange.effect.heng"));
    expect(container.textContent).not.toContain("40%");
  });

  it("关闭 Inspector 宿主即解除区域焦点", () => {
    vi.useFakeTimers();
    const { registry, document } = createFixture([{ id: "ming-1", x: 4, side: 0 }]);
    const { app, editor } = createWorkspace(registry, document);
    disposers.push(() => editor.dispose(), () => app.dispose());
    app.internalState.settings.gameUseInspectorPanel = true;
    app.internalActions.setRightDockActiveTab("selection");
    if (!app.internalState.workbench.rightDockOpen) app.internalActions.toggleRightDock();
    const reference = renderPanel(app, document);
    act(() => app.internalActions.setAttachmentFocus(reference));
    expect(app.internalState.runtime.attachmentFocus).toEqual(reference);

    act(() => {
      if (app.internalState.workbench.rightDockOpen) app.internalActions.toggleRightDock();
    });
    expect(app.internalState.runtime.attachmentFocus).toBeNull();
  });
});
