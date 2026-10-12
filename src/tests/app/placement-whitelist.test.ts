import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canPlaceBlueprintDocumentInCurrentBase,
  canPlaceEntityDefinitionInBase,
  canPlaceEntityDefinitionInCurrentBase,
  hasPlaceableEntityDefinitionInCurrentBase,
} from "@/app/placement-zone-availability";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createWorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

const AGRICULTURAL_BASE_ID = "wuling_agricultural_land";
const RESTRICTED_PIPE_ID = "pipe_straight_1x1";

describe("设备地图与区域白名单", () => {
  let session: ReturnType<typeof createAppTestWorkspace>;
  let editor: EditorHost;

  beforeEach(async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    session = createAppTestWorkspace();
    session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) =>
      definition.id === RESTRICTED_PIPE_ID || definition.id === "grinder_1"
        ? { ...definition, placementWhitelist: [{ baseId: AGRICULTURAL_BASE_ID }] }
        : definition,
    );
    editor = createEditorHost(session.workspace);
    await editor.internalDocuments.ready();
  });

  afterEach(async () => {
    try {
      await editor.internalHistory.flush();
      await editor.internalDocuments.flush();
      await editor.internalDocuments.settleMaintenance();
    } finally {
      editor.dispose();
      session.app.dispose();
      localStorage.clear();
      vi.unstubAllGlobals();
    }
  });

  it("设备和含设备蓝图仅在目标地图可用，草稿箱与同地区地图也不能绕过", () => {
    const restricted = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "grinder_1")!;
    const blueprint = createPlacementBlueprint();

    for (const baseId of [AGRICULTURAL_BASE_ID, "wuling_protocol_core", "valley4_protocol_core", "draft_box"]) {
      editor.internalDocument.setSnapshot(createWorldDocument({ baseId }));
      const allowed = baseId === AGRICULTURAL_BASE_ID;
      expect(canPlaceEntityDefinitionInCurrentBase(session.app, restricted)).toBe(allowed);
      expect(canPlaceBlueprintDocumentInCurrentBase(session.app, blueprint)).toBe(allowed);
      expect(canPlaceEntityDefinitionInBase(session.app, restricted, baseId, "blueprint")).toBe(allowed);
    }
    expect(canPlaceEntityDefinitionInBase(session.app, restricted, null)).toBe(false);
    expect(canPlaceEntityDefinitionInBase(session.app, restricted, "unknown-base")).toBe(false);

    session.workspace.registry.entityDefinitions = [restricted];
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
    expect(hasPlaceableEntityDefinitionInCurrentBase(session.app, "basicProduction")).toBe(true);
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
    expect(hasPlaceableEntityDefinitionInCurrentBase(session.app, "basicProduction")).toBe(false);
  });

  it("多个地图白名单显式允许草稿箱，并在 App 与 Editor 同时生效", () => {
    session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) =>
      definition.id === RESTRICTED_PIPE_ID
        ? { ...definition, placementWhitelist: [{ baseId: AGRICULTURAL_BASE_ID }, { baseId: "draft_box" }] }
        : definition,
    );
    for (const baseId of [AGRICULTURAL_BASE_ID, "draft_box"]) {
      editor.internalDocument.setSnapshot(createWorldDocument({ baseId }));
      const pipe = session.workspace.registry.entityDefinitions.find((definition) => definition.id === RESTRICTED_PIPE_ID)!;
      expect(canPlaceEntityDefinitionInCurrentBase(session.app, pipe)).toBe(true);
      expect(canPlaceBlueprintDocumentInCurrentBase(session.app, createPlacementBlueprint())).toBe(true);
      editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 10, y: 10 });
      expect(editor.actions.applyPlacementDraft()).toBe(true);
    }
  });

  it("主区域、子区域与新增子区域均允许，外围仍按设备本身的放置规则判断", () => {
    session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) =>
      definition.id === "belt_straight_1x1"
        ? { ...definition, placementWhitelist: [{ baseId: AGRICULTURAL_BASE_ID }] }
        : definition,
    );
    session.workspace.registry.baseDefinitions = session.workspace.registry.baseDefinitions.map((base) =>
      base.id === AGRICULTURAL_BASE_ID
        ? { ...base, subAreas: [...(base.subAreas ?? []), {
          id: "test_future_area", position: { x: 200, y: 0 },
          placeableArea: { width: 10, height: 10 },
          outerRing: { top: 0, right: 0, bottom: 0, left: 0 },
        }] }
        : base,
    );
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));

    for (const position of [{ x: 10, y: 10 }, { x: 114, y: 10 }, { x: 201, y: 1 }, { x: -10, y: 10 }, { x: 90, y: 10 }]) {
      editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, position);
      const id = editor.state.collections[EntityCollectionType.preview][0]!;
      expect(editor.queries.getEntityPlacementValidation(id).canPlace).toBe(true);
      expect(editor.actions.applyPlacementDraft()).toBe(true);
    }
    expect(editor.document.getSnapshot().entityOrder).toHaveLength(5);

    editor.actions.createSinglePlacementDraft("belt_straight_1x1", { x: 10, y: 20 });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    editor.actions.createSinglePlacementDraft("belt_straight_1x1", { x: 90, y: 20 });
    const beltId = editor.state.collections[EntityCollectionType.preview][0]!;
    expect(editor.queries.getEntityPlacementValidation(beltId).reasons.map((reason) => reason.code)).toContain("outside-base");
    expect(editor.actions.applyPlacementDraft()).toBe(false);
    editor.actions.cancelPlacementDraft();
    editor.actions.createSinglePlacementDraft("grinder_1", { x: 90, y: 20 });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    expect(editor.document.getSnapshot().entityOrder).toHaveLength(7);
  });

  it("地图限定不放宽区域间空地、越界和完整占地限制", () => {
    session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) =>
      definition.id === "belt_straight_1x1"
        ? { ...definition, placementWhitelist: [{ baseId: AGRICULTURAL_BASE_ID }] }
        : definition,
    );
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
    for (const position of [{ x: 70, y: 10 }, { x: 170, y: 10 }]) {
      editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, position);
      const id = editor.state.collections[EntityCollectionType.preview][0]!;
      expect(editor.queries.getEntityPlacementValidation(id).reasons.map((reason) => reason.code)).toContain("outside-base");
      expect(editor.actions.applyPlacementDraft()).toBe(false);
      editor.actions.cancelPlacementDraft();
    }
    editor.actions.createSinglePlacementDraft("belt_straight_1x1", { x: 44, y: 10 });
    const beltId = editor.state.collections[EntityCollectionType.preview][0]!;
    expect(editor.queries.getEntityPlacementValidation(beltId).reasons.map((reason) => reason.code)).toContain("outside-base");
    expect(editor.actions.applyPlacementDraft()).toBe(false);
    editor.actions.cancelPlacementDraft();
    editor.actions.createSinglePlacementDraft("grinder_1", { x: 63, y: 10 });
    expect(editor.actions.applyPlacementDraft()).toBe(false);
    expect(editor.document.getSnapshot().entityOrder).toEqual([]);
  });

  it("Editor 直接放置及遗留虚影跨地图时仍拒绝提交", () => {
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
    editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 10, y: 10 });
    const id = editor.state.collections[EntityCollectionType.preview][0]!;
    expect(editor.queries.getEntityPlacementValidation(id).canPlace).toBe(true);

    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
    expect(editor.queries.getEntityPlacementValidation(id).reasons.map((reason) => reason.code)).toContain("outside-base");
    expect(editor.actions.applyPlacementDraft()).toBe(false);
    editor.actions.cancelPlacementDraft();
    editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 20, y: 20 });
    expect(editor.actions.applyPlacementDraft()).toBe(false);
    expect(editor.document.getSnapshot().entityOrder).toEqual([]);
  });

  it("直接提交混合蓝图保留合法设备，加载的错误地图设备进入非法放置集合", () => {
    const blueprint = createPlacementBlueprint();
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
    editor.actions.createBlueprintPlacementDraft?.(blueprint, { x: 10, y: 10 });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    expect(Object.values(editor.document.getSnapshot().entities).map((entity) => entity.definitionId)).toEqual(["belt_straight_1x1"]);

    editor.internalDocument.setSnapshot({
      ...createWorldDocument({ baseId: "draft_box" }),
      entities: blueprint.entities, entityOrder: blueprint.entityOrder,
    });
    expect([...editor.state.collections[EntityCollectionType.invalidPlacement]]).toEqual(["restricted"]);
  });

  it("指定地图的区域白名单只允许对应区域", () => {
    const restricted = session.workspace.registry.entityDefinitions.find((definition) => definition.id === RESTRICTED_PIPE_ID)!;
    session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) =>
      definition.id === restricted.id
        ? { ...definition, placementWhitelist: [{ baseId: AGRICULTURAL_BASE_ID, areaIds: ["wuling_yuanyuan_zhuang"] }] }
        : definition,
    );
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
    editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 10, y: 10 });
    expect(editor.actions.applyPlacementDraft()).toBe(false);
    editor.actions.cancelPlacementDraft();
    editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 114, y: 10 });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
  });
});

function createPlacementBlueprint() {
  return createBlueprintDocument({
    name: "地图限定放置测试", baseId: AGRICULTURAL_BASE_ID,
    initialGridPoint: { x: 0, y: 0 },
    entities: {
      restricted: { id: "restricted", definitionId: RESTRICTED_PIPE_ID, position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
      ordinary: { id: "ordinary", definitionId: "belt_straight_1x1", position: { x: 2, y: 0 }, rotation: 0, config: {}, tags: [] },
    },
    entityOrder: ["restricted", "ordinary"], slotLinks: [],
  });
}

// AI-REMOVED 2026-10-12:
// Reason: 标签资格测试迁为结构化白名单测试。
// Trigger: 用户确认地图/区域白名单与 UI 过滤方案。
// Evidence: EntityDefinition.placementWhitelist 已成为唯一资格来源。
// Replacement: 当前文件中的结构化白名单回归
// Risk: 原有草稿箱、外围和完整占地断言需要继续覆盖。
// Human Review: Required
//
// Original code:
// import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// import {
//   canPlaceBlueprintDocumentInCurrentBase,
//   canPlaceEntityDefinitionInBase,
//   canPlaceEntityDefinitionInCurrentBase,
//   hasPlaceableEntityDefinitionInCurrentBase,
// } from "@/app/placement-zone-availability";
// import { createBlueprintDocument } from "@/domain/document/blueprint-document";
// import { createWorldDocument } from "@/domain/document/world-document";
// import { EntityCollectionType } from "@/domain/editor/types/editor-types";
// import { createEditorHost, type EditorHost } from "@/editor/editor-host";
// import { BASE_AREA_ONLY_TAG_PREFIX, BASE_ONLY_TAG_PREFIX } from "@/shared/base-tags";
// import { createAppTestWorkspace } from "../helpers/app-test-workspace";
// import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
//
// const AGRICULTURAL_BASE_ID = "wuling_agricultural_land";
// const RESTRICTED_PIPE_ID = "pipe_straight_1x1";
//
// describe("baseOnly 地图限定", () => {
//   let session: ReturnType<typeof createAppTestWorkspace>;
//   let editor: EditorHost;
//
//   beforeEach(async () => {
//     vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
//     session = createAppTestWorkspace();
//     session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) =>
//       definition.id === RESTRICTED_PIPE_ID || definition.id === "grinder_1"
//         ? { ...definition, tags: [...definition.tags, `${BASE_ONLY_TAG_PREFIX}${AGRICULTURAL_BASE_ID}`] }
//         : definition,
//     );
//     editor = createEditorHost(session.workspace);
//     await editor.internalDocuments.ready();
//   });
//
//   afterEach(async () => {
//     try {
//       await editor.internalHistory.flush();
//       await editor.internalDocuments.flush();
//       await editor.internalDocuments.settleMaintenance();
//     } finally {
//       editor.dispose();
//       session.app.dispose();
//       localStorage.clear();
//       vi.unstubAllGlobals();
//     }
//   });
//
//   it("设备和含设备蓝图仅在目标地图可用，草稿箱与同地区地图也不能绕过", () => {
//     const restricted = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "grinder_1")!;
//     const blueprint = createPlacementBlueprint();
//
//     for (const baseId of [AGRICULTURAL_BASE_ID, "wuling_protocol_core", "valley4_protocol_core", "draft_box"]) {
//       editor.internalDocument.setSnapshot(createWorldDocument({ baseId }));
//       const allowed = baseId === AGRICULTURAL_BASE_ID;
//       expect(canPlaceEntityDefinitionInCurrentBase(session.app, restricted)).toBe(allowed);
//       expect(canPlaceBlueprintDocumentInCurrentBase(session.app, blueprint)).toBe(allowed);
//       expect(canPlaceEntityDefinitionInBase(session.app, restricted, baseId, "blueprint")).toBe(allowed);
//     }
//     expect(canPlaceEntityDefinitionInBase(session.app, restricted, null)).toBe(false);
//     expect(canPlaceEntityDefinitionInBase(session.app, restricted, "unknown-base")).toBe(false);
//
//     session.workspace.registry.entityDefinitions = [restricted];
//     editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
//     expect(hasPlaceableEntityDefinitionInCurrentBase(session.app, "basicProduction")).toBe(true);
//     editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
//     expect(hasPlaceableEntityDefinitionInCurrentBase(session.app, "basicProduction")).toBe(false);
//   });
//
//   it("主区域、子区域与新增子区域均允许，外围仍按设备本身的放置规则判断", () => {
//     session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) =>
//       definition.id === "belt_straight_1x1"
//         ? { ...definition, tags: [...definition.tags, `${BASE_ONLY_TAG_PREFIX}${AGRICULTURAL_BASE_ID}`] }
//         : definition,
//     );
//     session.workspace.registry.baseDefinitions = session.workspace.registry.baseDefinitions.map((base) =>
//       base.id === AGRICULTURAL_BASE_ID
//         ? { ...base, subAreas: [...(base.subAreas ?? []), {
//           id: "test_future_area", position: { x: 200, y: 0 },
//           placeableArea: { width: 10, height: 10 },
//           outerRing: { top: 0, right: 0, bottom: 0, left: 0 },
//         }] }
//         : base,
//     );
//     editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
//
//     for (const position of [{ x: 10, y: 10 }, { x: 114, y: 10 }, { x: 201, y: 1 }, { x: -10, y: 10 }, { x: 90, y: 10 }]) {
//       editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, position);
//       const id = editor.state.collections[EntityCollectionType.preview][0]!;
//       expect(editor.queries.getEntityPlacementValidation(id).canPlace).toBe(true);
//       expect(editor.actions.applyPlacementDraft()).toBe(true);
//     }
//     expect(editor.document.getSnapshot().entityOrder).toHaveLength(5);
//
//     editor.actions.createSinglePlacementDraft("belt_straight_1x1", { x: 10, y: 20 });
//     expect(editor.actions.applyPlacementDraft()).toBe(true);
//     editor.actions.createSinglePlacementDraft("belt_straight_1x1", { x: 90, y: 20 });
//     const beltId = editor.state.collections[EntityCollectionType.preview][0]!;
//     expect(editor.queries.getEntityPlacementValidation(beltId).reasons.map((reason) => reason.code)).toContain("outside-base");
//     expect(editor.actions.applyPlacementDraft()).toBe(false);
//     editor.actions.cancelPlacementDraft();
//     editor.actions.createSinglePlacementDraft("grinder_1", { x: 90, y: 20 });
//     expect(editor.actions.applyPlacementDraft()).toBe(true);
//     expect(editor.document.getSnapshot().entityOrder).toHaveLength(7);
//   });
//
//   it("地图限定不放宽区域间空地、越界和完整占地限制", () => {
//     session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) =>
//       definition.id === "belt_straight_1x1"
//         ? { ...definition, tags: [...definition.tags, `${BASE_ONLY_TAG_PREFIX}${AGRICULTURAL_BASE_ID}`] }
//         : definition,
//     );
//     editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
//     for (const position of [{ x: 70, y: 10 }, { x: 170, y: 10 }]) {
//       editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, position);
//       const id = editor.state.collections[EntityCollectionType.preview][0]!;
//       expect(editor.queries.getEntityPlacementValidation(id).reasons.map((reason) => reason.code)).toContain("outside-base");
//       expect(editor.actions.applyPlacementDraft()).toBe(false);
//       editor.actions.cancelPlacementDraft();
//     }
//     editor.actions.createSinglePlacementDraft("belt_straight_1x1", { x: 44, y: 10 });
//     const beltId = editor.state.collections[EntityCollectionType.preview][0]!;
//     expect(editor.queries.getEntityPlacementValidation(beltId).reasons.map((reason) => reason.code)).toContain("outside-base");
//     expect(editor.actions.applyPlacementDraft()).toBe(false);
//     editor.actions.cancelPlacementDraft();
//     editor.actions.createSinglePlacementDraft("grinder_1", { x: 63, y: 10 });
//     expect(editor.actions.applyPlacementDraft()).toBe(false);
//     expect(editor.document.getSnapshot().entityOrder).toEqual([]);
//   });
//
//   it("Editor 直接放置及遗留虚影跨地图时仍拒绝提交", () => {
//     editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
//     editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 10, y: 10 });
//     const id = editor.state.collections[EntityCollectionType.preview][0]!;
//     expect(editor.queries.getEntityPlacementValidation(id).canPlace).toBe(true);
//
//     editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
//     expect(editor.queries.getEntityPlacementValidation(id).reasons.map((reason) => reason.code)).toContain("outside-base");
//     expect(editor.actions.applyPlacementDraft()).toBe(false);
//     editor.actions.cancelPlacementDraft();
//     editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 20, y: 20 });
//     expect(editor.actions.applyPlacementDraft()).toBe(false);
//     expect(editor.document.getSnapshot().entityOrder).toEqual([]);
//   });
//
//   it("直接提交混合蓝图保留合法设备，加载的错误地图设备进入非法放置集合", () => {
//     const blueprint = createPlacementBlueprint();
//     editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
//     editor.actions.createBlueprintPlacementDraft?.(blueprint, { x: 10, y: 10 });
//     expect(editor.actions.applyPlacementDraft()).toBe(true);
//     expect(Object.values(editor.document.getSnapshot().entities).map((entity) => entity.definitionId)).toEqual(["belt_straight_1x1"]);
//
//     editor.internalDocument.setSnapshot({
//       ...createWorldDocument({ baseId: "draft_box" }),
//       entities: blueprint.entities, entityOrder: blueprint.entityOrder,
//     });
//     expect([...editor.state.collections[EntityCollectionType.invalidPlacement]]).toEqual(["restricted"]);
//   });
//
//   it("baseOnly 与 baseAreaOnly 同时配置时同时满足地图与区域限制", () => {
//     const restricted = session.workspace.registry.entityDefinitions.find((definition) => definition.id === RESTRICTED_PIPE_ID)!;
//     restricted.tags = [...restricted.tags, `${BASE_AREA_ONLY_TAG_PREFIX}wuling_yuanyuan_zhuang`];
//     editor.internalDocument.setSnapshot(createWorldDocument({ baseId: AGRICULTURAL_BASE_ID }));
//     editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 10, y: 10 });
//     expect(editor.actions.applyPlacementDraft()).toBe(false);
//     editor.actions.cancelPlacementDraft();
//     editor.actions.createSinglePlacementDraft(RESTRICTED_PIPE_ID, { x: 114, y: 10 });
//     expect(editor.actions.applyPlacementDraft()).toBe(true);
//   });
// });
//
// function createPlacementBlueprint() {
//   return createBlueprintDocument({
//     name: "地图限定放置测试", baseId: AGRICULTURAL_BASE_ID,
//     initialGridPoint: { x: 0, y: 0 },
//     entities: {
//       restricted: { id: "restricted", definitionId: RESTRICTED_PIPE_ID, position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
//       ordinary: { id: "ordinary", definitionId: "belt_straight_1x1", position: { x: 2, y: 0 }, rotation: 0, config: {}, tags: [] },
//     },
//     entityOrder: ["restricted", "ordinary"], slotLinks: [],
//   });
// }
