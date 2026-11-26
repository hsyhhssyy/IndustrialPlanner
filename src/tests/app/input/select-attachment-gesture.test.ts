import { afterEach, describe, expect, it } from "vitest";

import { createHypergryphSelectGestureModule } from "@/app/input/gesture/actions";
import { resolveClientRectForGridCell } from "@/editor/queries";
import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { MAGIC_SPAWNER_FORMATION } from "@/shared/magic-spawner-range";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { createSceneAttachmentReference, resolvePeriodicRangeRegions } from "@/app/canvas";
import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

const MACHINE_ID = "fixture:periodic-transmuter";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
});

function createRegistry() {
  const base = createRegistryContract();
  const definition: EntityDefinition = {
    id: MACHINE_ID,
    nameKey: MACHINE_ID,
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
      localRect: { x: -4, y: 0, width: 2, height: 2 },
      coverage: "contains",
      visualId: "fixture:primary",
    }],
  };
  const recipe: RecipeDefinition = {
    id: "fixture:ming",
    nameKey: "fixture:ming",
    machineId: MACHINE_ID,
    durationSeconds: 1,
    inputs: [],
    outputs: [],
    recipeType: "reserved-item",
    tags: [CONSUMPTION_RECIPE_TAG],
    periodicRangeConversion: { side: 0, rangeIds: ["primary"], programId: MAGIC_SPAWNER_FORMATION.id },
  };
  const entityDefinitions = [...base.entityDefinitions, definition];
  const recipeDefinitions = [...base.recipeDefinitions, recipe];
  return {
    ...base,
    entityDefinitions,
    recipeDefinitions,
    queries: createRegistryQuery({
      entityDefinitions,
      itemDefinitions: base.itemDefinitions,
      recipeDefinitions,
    }),
  };
}

function createDocument(options: { beltAt?: { x: number; y: number } } = {}): WorldDocument {
  const document = createWorldDocument({ baseId: "draft_box" });
  document.entities["transmuter"] = {
    id: "transmuter",
    definitionId: MACHINE_ID,
    position: { x: 4, y: 0 },
    rotation: 0,
    config: { channelRecipes: { phase: "fixture:ming" } },
    tags: [],
  };
  document.entityOrder.push("transmuter");
  if (options.beltAt !== undefined) {
    document.entities.belt = {
      id: "belt",
      definitionId: "belt_straight_1x1",
      position: options.beltAt,
      rotation: 0,
      config: {},
      tags: [],
    };
    document.entityOrder.push("belt");
  }
  return document;
}

function createSession(document: WorldDocument) {
  const session = createCanvasTestSession({
    document,
    registry: createRegistry(),
    viewport: { center: { x: 0, y: 0 }, gridSize: 32, displayRotation: 0 },
  });
  cleanups.push(session.dispose);
  session.view.actions.setViewportClientRect({ left: 0, top: 0, width: 400, height: 400 });
  const position = clientPointForGridCell(session.view.state, { x: 0, y: 0 });
  return { ...session, position };
}

function clientPointForGridCell(
  viewportState: Parameters<typeof resolveClientRectForGridCell>[0]["viewportState"],
  gridCell: { x: number; y: number },
) {
  const rect = resolveClientRectForGridCell({ gridCell, viewportState });
  expect(rect).not.toBeNull();
  return { x: rect!.left + rect!.width / 2, y: rect!.top + rect!.height / 2 };
}

function attachmentReference(app: AppHost, editor: EditorContract) {
  return createSceneAttachmentReference(resolvePeriodicRangeRegions(app, editor)[0]!);
}

function tap(position: { x: number; y: number }, pointerEntity: WorldDocument["entities"][string] | null) {
  return {
    type: "mouse tap" as const,
    gestureId: `mouse-tap-${Math.random()}`,
    button: 0,
    buttons: 0,
    position,
    longPress: false,
    pointerEntity,
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
    sourceEvent: null,
  };
}

describe("选择工具附属实体点选", () => {
  it("仅命中区域空格时直接打开查看焦点", () => {
    const session = createSession(createDocument());
    const expected = attachmentReference(session.app, session.editor);
    expect(session.canvas.view.queries.findGridCellForClientPixelPoint(session.position)).toEqual({ x: 0, y: 0 });

    const result = createHypergryphSelectGestureModule().handle(tap(session.position, null), session.context);

    expect(result).toEqual({ status: "handled" });
    expect(session.app.internalState.runtime.attachmentFocus).toEqual(expected);
    expect(session.editor.state.collections.selection.length).toBe(0);
  });

  it("设备与区域重合时复用重叠菜单，两者都可选中", () => {
    const session = createSession(createDocument({ beltAt: { x: 0, y: 0 } }));
    const expected = attachmentReference(session.app, session.editor);
    const belt = session.editor.queries.getEntityById("belt")!;
    const result = createHypergryphSelectGestureModule().handle(tap(session.position, belt), session.context);

    expect(result).toEqual({ status: "handled" });
    const menu = session.canvas.overlapEntityMenu;
    expect(menu.visible).toBe(true);
    expect(menu.candidates.map((candidate) => candidate.kind)).toEqual(["entity", "attachment"]);

    menu.select(`attachment:${expected.regionId}`);
    expect(menu.visible).toBe(false);
    expect(session.app.internalState.runtime.attachmentFocus).toEqual(expected);
    expect(session.editor.state.collections.selection.length).toBe(0);
  });

  it("查看区域后选择设备会解除区域焦点", () => {
    const session = createSession(createDocument({ beltAt: { x: 2, y: 2 } }));
    const module = createHypergryphSelectGestureModule();
    session.app.internalActions.setAttachmentFocus(attachmentReference(session.app, session.editor));
    const belt = session.editor.queries.getEntityById("belt")!;
    const beltPosition = clientPointForGridCell(session.view.state, { x: 2, y: 2 });

    expect(module.handle(tap(beltPosition, belt), session.context)).toEqual({ status: "handled" });
    expect(session.app.internalState.runtime.attachmentFocus).toBeNull();
    expect(session.editor.state.collections.selection.length).toBe(1);
  });

  it("点击空白取消查看，无焦点时保持原有忽略语义", () => {
    const session = createSession(createDocument());
    const module = createHypergryphSelectGestureModule();
    const outside = { x: 1, y: 1 };
    expect(session.canvas.view.queries.findGridCellForClientPixelPoint(outside)).not.toEqual({ x: 0, y: 0 });

    expect(module.handle(tap(outside, null), session.context)).toEqual({ status: "ignored" });
    session.app.internalActions.setAttachmentFocus(attachmentReference(session.app, session.editor));
    expect(module.handle(tap(outside, null), session.context)).toEqual({ status: "handled" });
    expect(session.app.internalState.runtime.attachmentFocus).toBeNull();
  });

  it("选择工具按 Escape 解除区域焦点", () => {
    const session = createSession(createDocument());
    session.app.internalActions.setAttachmentFocus(attachmentReference(session.app, session.editor));
    session.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "transmuter" });

    const result = handleKeyboardShortcutThroughRouter({
      module: createHypergryphSelectGestureModule(),
      context: session.context,
      event: {
        type: "key down",
        gestureId: "attachment-escape",
        code: "Escape",
        key: "Escape",
        keyCode: 0,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
        sourceEvent: null,
      },
      activeTool: "select",
    });

    expect(result).toEqual({ status: "handled" });
    expect(session.app.internalState.runtime.attachmentFocus).toBeNull();
    expect(session.editor.state.collections.selection.length).toBe(0);
  });
});

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 测试夹具及断言改为读取配方行为、独立投影口和真实工序维度。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: 本文件中对应测试及 src/tests/simulation/formation-projections.test.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
// import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
//
// const PROGRAM: PeriodicRangeConversionProgram = {
//   id: "fixture:program",
//   periodSeconds: 10,
//   effects: [
//     { probabilityByLayer: [1], outputItemByInputId: {} },
//     { probabilityByLayer: [1], outputItemByInputId: {} },
//     { probabilityByLayer: [0.4], outputItemByInputId: {} },
//   ],
// };
//
//     periodicRangeConversion: { side: 0, rangeIds: ["primary"], program: PROGRAM },
