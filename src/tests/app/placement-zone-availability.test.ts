// AI-REMOVED 2026-10-12:
// Reason: 地区标签与假业务主机测试改为真实主机白名单回归。
// Trigger: 用户确认地图、区域资格统一收口。
// Evidence: App 与 Editor 共用结构化设备属性。
// Replacement: 本文件真实 App/Editor 用例。
// Risk: 手动核心、草稿箱与蓝图资格需保留断言。
// Human Review: Required
//
// Original code:
// import { describe, expect, it } from "vitest";
//
// import type { AppHost } from "@/app/host/app-host";
// import {
//   canPlaceEntityDefinitionInBase,
//   canPlaceBlueprintDocumentInCurrentBase,
//   canPlaceEntityDefinitionInCurrentBase,
//   hasPlaceableEntityDefinitionInCurrentBase,
// } from "@/app/placement-zone-availability";
// import type { BlueprintDocument } from "@/domain/document/blueprint-document";
// import type { EntityDefinition, UiGroup } from "@/domain/registry/types/entity-definition";
//
// describe("placement-zone-availability", () => {
//   it("only exposes manual protocol core placement in marked bases while retaining ordinary blueprint placement", () => {
//     const core = createEntityDefinition("sp_hub_1", [], "warehouse");
//     const ordinaryHost = createAppHostStub("wuling_protocol_core", [core]);
//     const draftHost = createAppHostStub("draft_box", [core]);
//     expect(canPlaceEntityDefinitionInCurrentBase(ordinaryHost, core)).toBe(false);
//     expect(canPlaceEntityDefinitionInCurrentBase(draftHost, core)).toBe(true);
//     expect(canPlaceEntityDefinitionInBase(draftHost, core, null)).toBe(false);
//     expect(canPlaceBlueprintDocumentInCurrentBase(ordinaryHost, createBlueprintDocumentStub([core.id]))).toBe(true);
//     expect(canPlaceBlueprintDocumentInCurrentBase(draftHost, createBlueprintDocumentStub([core.id]))).toBe(true);
//   });
//
//   it("blocks Wuling-only entities outside Wuling bases", () => {
//     const normalDefinition = createEntityDefinition("normal-device", [], "basicProduction");
//     const wulingDefinition = createEntityDefinition("wuling-device", ["武陵"], "basicProduction");
//
//     const valleyHost = createAppHostStub("valley4_protocol_core", [
//       normalDefinition,
//       wulingDefinition,
//     ]);
//     const wulingHost = createAppHostStub("wuling_protocol_core", [
//       normalDefinition,
//       wulingDefinition,
//     ]);
//
//     // AI-REMOVED 2026-09-25:
//     // Reason: 武陵专用开关已被注册表驱动的地区建筑规则替代。
//     // Trigger: 草稿箱支持现有及未来地区建筑。
//     // Evidence: 下方设备放置断言直接覆盖地区限制。
//     // Replacement: canPlaceEntityDefinitionInCurrentBase 断言。
//     // Risk: Low
//     // Human Review: Required
//     // Original code:
//     // expect(canCurrentBaseAcceptWulingOnlyEntities(valleyHost)).toBe(false);
//     expect(canPlaceEntityDefinitionInCurrentBase(valleyHost, normalDefinition)).toBe(true);
//     expect(canPlaceEntityDefinitionInCurrentBase(valleyHost, wulingDefinition)).toBe(false);
//     // AI-REMOVED 2026-09-25:
//     // Reason: 武陵专用开关已被通用地区规则替代。
//     // Trigger: 草稿箱跨区设备支持。
//     // Evidence: 下一行直接验证武陵设备可放置。
//     // Replacement: canPlaceEntityDefinitionInCurrentBase 断言。
//     // Risk: Low
//     // Human Review: Required
//     // Original code:
//     // expect(canCurrentBaseAcceptWulingOnlyEntities(wulingHost)).toBe(true);
//     expect(canPlaceEntityDefinitionInCurrentBase(wulingHost, wulingDefinition)).toBe(true);
//   });
//
//   it("checks entity availability against an explicit base id", () => {
//     const wulingDefinition = createEntityDefinition("wuling-device", ["武陵"], "basicProduction");
//     const appHost = createAppHostStub("valley4_protocol_core", [wulingDefinition]);
//
//     expect(canPlaceEntityDefinitionInBase(appHost, wulingDefinition, "valley4_protocol_core")).toBe(false);
//     expect(canPlaceEntityDefinitionInBase(appHost, wulingDefinition, "wuling_protocol_core")).toBe(true);
//     expect(canPlaceEntityDefinitionInBase(appHost, wulingDefinition, null)).toBe(true);
//   });
//
//   it("accepts existing and newly registered regional devices in the draft base", () => {
//     const wuling = createEntityDefinition("wuling-device", ["武陵"], "basicProduction");
//     const valley = createEntityDefinition("valley-device", ["四号谷地"], "basicProduction");
//     const future = createEntityDefinition("future-device", ["未来地区"], "basicProduction");
//     const appHost = createAppHostStub("draft_box", [wuling, valley, future]);
//
//     for (const definition of [wuling, valley, future]) {
//       expect(canPlaceEntityDefinitionInBase(appHost, definition, "draft_box")).toBe(true);
//     }
//     expect(canPlaceEntityDefinitionInBase(appHost, future, "wuling_protocol_core")).toBe(false);
//     expect(canPlaceEntityDefinitionInBase(appHost, future, "future_base")).toBe(true);
//   });
//
//   it("reports only visible and current-base-placeable groups as available", () => {
//     const hiddenPipe = createEntityDefinition("hidden-pipe", ["武陵", "不可摆放"], "pipeLogistics");
//     const pipe = createEntityDefinition("pipe", ["武陵"], "pipeLogistics");
//     const belt = createEntityDefinition("belt", [], "beltLogistics");
//     const valleyHost = createAppHostStub("valley4_protocol_core", [hiddenPipe, pipe, belt]);
//     const draftHost = createAppHostStub("draft_box", [hiddenPipe, pipe, belt]);
//
//     expect(hasPlaceableEntityDefinitionInCurrentBase(valleyHost, "pipeLogistics")).toBe(false);
//     expect(hasPlaceableEntityDefinitionInCurrentBase(valleyHost, "beltLogistics")).toBe(true);
//     expect(hasPlaceableEntityDefinitionInCurrentBase(draftHost, "pipeLogistics")).toBe(true);
//   });
//
//   it("blocks blueprints containing Wuling-only entities outside Wuling bases", () => {
//     const normalDefinition = createEntityDefinition("normal-device", [], "basicProduction");
//     const wulingDefinition = createEntityDefinition("wuling-device", ["武陵"], "basicProduction");
//     const blueprint = createBlueprintDocumentStub(["normal-device", "wuling-device"]);
//     const valleyHost = createAppHostStub("valley4_protocol_core", [
//       normalDefinition,
//       wulingDefinition,
//     ]);
//     const wulingHost = createAppHostStub("wuling_protocol_core", [
//       normalDefinition,
//       wulingDefinition,
//     ]);
//     const draftHost = createAppHostStub("draft_box", [
//       normalDefinition,
//       wulingDefinition,
//     ]);
//
//     expect(canPlaceBlueprintDocumentInCurrentBase(valleyHost, blueprint)).toBe(false);
//     expect(canPlaceBlueprintDocumentInCurrentBase(wulingHost, blueprint)).toBe(true);
//     expect(canPlaceBlueprintDocumentInCurrentBase(draftHost, blueprint)).toBe(true);
//   });
// });
//
// function createAppHostStub(
//   baseId: string,
//   entityDefinitions: EntityDefinition[],
// ): AppHost {
//   return {
//     workspace: {
//       registry: {
//         baseDefinitions: [
//           { id: "wuling_protocol_core", name: "协议核心区", tag: "武陵", tags: [] },
//           { id: "valley4_protocol_core", name: "协议核心区", tag: "四号谷地", tags: [] },
//           { id: "draft_box", name: "草稿箱", tag: "草稿箱", tags: ["allRegionEntities", "草稿箱"] },
//           { id: "future_base", name: "未来地区基地", tag: "未来地区", tags: [] },
//         ],
//         entityDefinitions,
//       },
//       editor: {
//         document: {
//           getSnapshot: () => ({ baseId }),
//         },
//       },
//     },
//   } as unknown as AppHost;
// }
//
// function createEntityDefinition(
//   id: string,
//   tags: string[],
//   uiGroup: UiGroup,
// ): EntityDefinition {
//   return {
//     id,
//     nameKey: `${id}.name`,
//     spriteId: id,
//     iconPath: `device-icons/${id}.webp`,
//     footprint: { width: 1, height: 1 },
//     uiGroup,
//     displayOrder: 0,
//     tags,
//     requiresPower: false,
//     powerDemand: 0,
//     inspectors: [],
//     placementBehaviors: [],
//     portGroups: [],
//     storageSlotGroups: [],
//     recipeChannels: [],
//     portStorageBindings: [],
//   };
// }
//
// function createBlueprintDocumentStub(definitionIds: string[]): BlueprintDocument {
//   return {
//     entities: Object.fromEntries(definitionIds.map((definitionId, index) => [
//       `entity-${index}`,
//       {
//         id: `entity-${index}`,
//         definitionId,
//         position: { x: index, y: 0 },
//         rotation: 0,
//         config: {},
//         tags: [],
//       },
//     ])),
//   } as unknown as BlueprintDocument;
// }
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorldDocument } from "@/domain/document/world-document";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import {
  canPlaceEntityDefinitionInBase, canPlaceEntityDefinitionInCurrentBase,
  canPlaceBlueprintDocumentInCurrentBase, hasPlaceableEntityDefinitionInCurrentBase,
} from "@/app/placement-zone-availability";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

describe("当前基地设备资格", () => {
  let session: ReturnType<typeof createAppTestWorkspace>;
  let editor: EditorHost;
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    session = createAppTestWorkspace();
    editor = createEditorHost(session.workspace);
    await editor.internalDocuments.ready();
  });
  afterEach(async () => {
    try {
      await editor.internalHistory.flush();
      await editor.internalDocuments.flush();
      await editor.internalDocuments.settleMaintenance();
    } finally {
      editor.dispose(); session.app.dispose(); localStorage.clear(); vi.unstubAllGlobals();
    }
  });
  const blueprint = (definitionId: string) => createBlueprintDocument({
    name: "设备资格回归", baseId: "wuling_protocol_core", initialGridPoint: { x: 0, y: 0 }, slotLinks: [],
    entities: {
    device: { id: "device", definitionId, position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
  }, entityOrder: ["device"] });

  it("协议核心继续区分手动入口与蓝图入口", () => {
    const core = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "sp_hub_1")!;
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "wuling_protocol_core" }));
    expect(canPlaceEntityDefinitionInCurrentBase(session.app, core)).toBe(false);
    expect(canPlaceBlueprintDocumentInCurrentBase(session.app, blueprint(core.id))).toBe(true);
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: "draft_box" }));
    expect(canPlaceEntityDefinitionInCurrentBase(session.app, core)).toBe(true);
  });
  it("真实地区设备白名单保留原资格，当前地图未确定时不开放入口", () => {
    const pipe = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "pipe_splitter")!;
    const ordinary = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "grinder_1")!;
    for (const baseId of ["valley4_protocol_core", "wuling_protocol_core", "draft_box"]) {
      expect(canPlaceEntityDefinitionInBase(session.app, pipe, baseId)).toBe(baseId !== "valley4_protocol_core");
      expect(canPlaceEntityDefinitionInBase(session.app, ordinary, baseId)).toBe(true);
    }
    expect(canPlaceEntityDefinitionInBase(session.app, pipe, null)).toBe(false);
    expect(canPlaceEntityDefinitionInBase(session.app, ordinary, "unknown-base")).toBe(false);
  });
  it("只允许子区域的型号在整个地图入口可用，地区标签不覆盖白名单", () => {
    const ordinary = session.workspace.registry.entityDefinitions.find((definition) => definition.id === "grinder_1")!;
    const restricted = { ...ordinary, tags: ["四号谷地"], placementWhitelist: [{ baseId: "wuling_agricultural_land", areaIds: ["wuling_yuanyuan_zhuang"] }] };
    expect(canPlaceEntityDefinitionInBase(session.app, restricted, "wuling_agricultural_land")).toBe(true);
    expect(canPlaceEntityDefinitionInBase(session.app, restricted, "valley4_protocol_core")).toBe(false);
    expect(canPlaceEntityDefinitionInBase(session.app, restricted, "draft_box")).toBe(false);
    expect(canPlaceEntityDefinitionInBase(session.app, { ...restricted, placementWhitelist: undefined }, "valley4_protocol_core")).toBe(true);
    expect(canPlaceEntityDefinitionInBase(session.app, { ...restricted, placementWhitelist: [] }, "wuling_agricultural_land")).toBe(false);
  });
  it("设备组和蓝图入口遵守相同地图资格", () => {
    for (const baseId of ["valley4_protocol_core", "wuling_protocol_core", "draft_box"]) {
      editor.internalDocument.setSnapshot(createWorldDocument({ baseId }));
      expect(hasPlaceableEntityDefinitionInCurrentBase(session.app, "pipeLogistics")).toBe(baseId !== "valley4_protocol_core");
      expect(canPlaceBlueprintDocumentInCurrentBase(session.app, blueprint("pipe_splitter"))).toBe(baseId !== "valley4_protocol_core");
    }
  });
});
