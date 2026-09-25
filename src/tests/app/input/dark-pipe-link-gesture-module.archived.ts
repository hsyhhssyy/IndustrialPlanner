// AI-REMOVED 2026-09-25:
// Reason: 旧 fake App/context 用例由原生浏览器交互测试替代。
// Trigger: REQ-038 将关系权威迁入出口文档，Editor Action 改为异步持久化。
// Evidence: 旧测试直接调用同步 Action / App 资产，不能覆盖 IndexedDB 与后台文档。
// Replacement: src/tests/e2e/editor-regional-dark-pipe.test.ts
// Risk: 需以真实浏览器回归确认交互、互斥与关闭模式覆盖。
// Human Review: Required
// Original code:
// import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
// import { afterEach, describe, expect, it } from "vitest";
// import { runInAction } from "mobx";
//
// import { createAppHost, type AppHost } from "@/app/host/app-host";
// import {
//   createHypergryphDarkPipeLinkGestureModule,
//   type GestureActionContext,
// } from "@/app/input/gesture/actions";
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";
// import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
// import { createWorkspaceState } from "@/domain/document/workspace-state";
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";
// import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
// import { createEditorHost, type EditorHost } from "@/editor/editor-host";
// import { createRegistryContract } from "@/registry";
// import { createRegionalDarkPipeLink } from "@/shared/dark-pipe-link";
// import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";
//
// const disposers: Array<() => void> = [];
//
// afterEach(() => {
//   while (disposers.length > 0) {
//     disposers.pop()?.();
//   }
//   localStorage.clear();
// });
//
// describe("createHypergryphDarkPipeLinkGestureModule", () => {
//   it("creates a dark pipe link from a candidate tap and exits the temporary tool", () => {
//     const { appHost, context, editorHost } = createContext();
//     const module = createHypergryphDarkPipeLinkGestureModule();
//
//     // AI-REMOVED 2026-09-14:
//     // Reason: 场景构造已批量固化为带版本的蓝图文件。
//     // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
//     // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
//     // Replacement: src/tests/fixtures/blueprints/collections-extra/app/input/dark-pipe-link-gesture-module/index.json
//     // Risk: Low；断言与被测动作不变。
//     // Human Review: Required
//     // Original code:
//     // [
//     //       entity("inlet", "udpipe_loader_1"),
//     //       entity("outlet", "udpipe_unloader_1"),
//     //     ]
//     editorHost.internalDocument.setSnapshot(createDocument(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/dark-pipe-link-gesture-module/scene-01-variant-1.schema6.json"))));
//     enterDarkPipeLinkTool(appHost);
//
//     const result = module.handle({
//       type: "mouse tap",
//       gestureId: "dark-pipe-link-tap",
//       button: 0,
//       buttons: 0,
//       position: { x: 10, y: 10 },
//       longPress: false,
//       pointerEntity: entity("outlet", "udpipe_unloader_1"),
//       modifiers: emptyModifiers(),
//       sourceEvent: null,
//     }, context);
//
//     expect(result).toEqual({ status: "handled" });
//     expect(appHost.state.activeTool).toBe("select");
//     expect(appHost.state.toolInfo.darkPipeLink).toBeNull();
//     expect(editorHost.document.getSnapshot().slotLinks).toEqual([
//       expect.objectContaining({
//         id: "dark-pipe-link:outlet:inlet",
//         linkType: "share-all",
//       }),
//     ]);
//   });
//
//   it("cancels the temporary tool on Escape", () => {
//     const { appHost, context } = createContext();
//     const module = createHypergryphDarkPipeLinkGestureModule();
//     enterDarkPipeLinkTool(appHost);
//
//     expect(handleKeyboardShortcutThroughRouter({
//       module,
//       context,
//       event: {
//         type: "key down",
//         gestureId: "dark-pipe-link-escape",
//         code: "Escape",
//         key: "Escape",
//         keyCode: 27,
//         modifiers: emptyModifiers(),
//         sourceEvent: null,
//       },
//     })).toEqual({ status: "handled" });
//     expect(appHost.state.activeTool).toBe("select");
//     expect(appHost.state.toolInfo.darkPipeLink).toBeNull();
//   });
//
//   it("keeps a disabled cross-base link until a config edit replaces it", () => {
//     const { appHost, editorHost } = createContext();
//     editorHost.internalDocument.setSnapshot(createDocument([entity("inlet", "udpipe_loader_1")]));
//     const endpoint = { baseId: editorHost.document.getSnapshot().baseId, entityId: "inlet" };
//     const regionalLink = createRegionalDarkPipeLink({
//       inlet: endpoint,
//       outlet: { baseId: "wuling_tianwangping_aid", entityId: "remote-outlet" },
//     });
//     // AI-REMOVED 2026-09-24:
//     // Reason: 建链现为包含基地文档的异步事务；本用例测试已保存关系被编辑覆盖。
//     // Trigger: 用户要求跨基地建链与仓库来源互斥并原子保存。
//     // Evidence: addDarkPipeLink 新契约需要真实持久化端点；此处只需设置已保存关系。
//     // Replacement: 下方直接准备地区资产，建链事务另由真实浏览器验证。
//     // Risk: Low
//     // Human Review: Required
//     // Original code:
//     // expect(appHost.regionalSettings.addDarkPipeLink(regionalLink)).toBe(true);
//     appHost.regionalSettings.asset = { ...appHost.regionalSettings.asset, darkPipeLinks: [regionalLink] };
//     expect(appHost.regionalSettings.findDarkPipeLink(endpoint)).toEqual(regionalLink);
//
//     editorHost.actions.patchEntityConfig("inlet", { "loader_buffer.slot_1.itemType": "item_test" });
//
//     expect(appHost.regionalSettings.findDarkPipeLink(endpoint)).toBeNull();
//   });
//
//   it("replaces a disabled cross-base link when a local link is created", () => {
//     const { appHost, editorHost } = createContext();
//     editorHost.internalDocument.setSnapshot(createDocument([
//       entity("inlet", "udpipe_loader_1"),
//       entity("outlet", "udpipe_unloader_1"),
//     ]));
//     const endpoint = { baseId: editorHost.document.getSnapshot().baseId, entityId: "inlet" };
//     const regionalLink = createRegionalDarkPipeLink({
//       inlet: endpoint,
//       outlet: { baseId: "wuling_tianwangping_aid", entityId: "remote-outlet" },
//     });
//     // AI-REMOVED 2026-09-24:
//     // Reason: 建链现为包含基地文档的异步事务；本用例测试已保存关系被编辑覆盖。
//     // Trigger: 用户要求跨基地建链与仓库来源互斥并原子保存。
//     // Evidence: addDarkPipeLink 新契约需要真实持久化端点；此处只需设置已保存关系。
//     // Replacement: 下方直接准备地区资产，建链事务另由真实浏览器验证。
//     // Risk: Low
//     // Human Review: Required
//     // Original code:
//     // expect(appHost.regionalSettings.addDarkPipeLink(regionalLink)).toBe(true);
//     appHost.regionalSettings.asset = { ...appHost.regionalSettings.asset, darkPipeLinks: [regionalLink] };
//
//     expect(editorHost.actions.createDarkPipeLink({ sourceEntityId: "inlet", targetEntityId: "outlet" })).toBe(true);
//
//     expect(appHost.regionalSettings.findDarkPipeLink(endpoint)).toBeNull();
//     expect(editorHost.document.getSnapshot().slotLinks).toHaveLength(1);
//   });
//
//   it("replaces a disabled cross-base link when the endpoint warehouse link changes", () => {
//     const { appHost, editorHost } = createContext();
//     editorHost.internalDocument.setSnapshot(createDocument([entity("outlet", "udpipe_unloader_1")]));
//     const endpoint = { baseId: editorHost.document.getSnapshot().baseId, entityId: "outlet" };
//     const regionalLink = createRegionalDarkPipeLink({
//       inlet: { baseId: "wuling_tianwangping_aid", entityId: "remote-inlet" },
//       outlet: endpoint,
//     });
//     // AI-REMOVED 2026-09-24:
//     // Reason: 建链现为包含基地文档的异步事务；本用例测试已保存关系被编辑覆盖。
//     // Trigger: 用户要求跨基地建链与仓库来源互斥并原子保存。
//     // Evidence: addDarkPipeLink 新契约需要真实持久化端点；此处只需设置已保存关系。
//     // Replacement: 下方直接准备地区资产，建链事务另由真实浏览器验证。
//     // Risk: Low
//     // Human Review: Required
//     // Original code:
//     // expect(appHost.regionalSettings.addDarkPipeLink(regionalLink)).toBe(true);
//     appHost.regionalSettings.asset = { ...appHost.regionalSettings.asset, darkPipeLinks: [regionalLink] };
//     const document = editorHost.document.getSnapshot();
//
//     editorHost.internalDocument.setSnapshot({
//       ...document,
//       slotLinks: [{
//         id: "warehouse-link:outlet",
//         linkType: "share-all",
//         source: { entityId: "outlet", storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
//         target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "slot_1" },
//       }],
//     });
//
//     expect(appHost.regionalSettings.findDarkPipeLink(endpoint)).toBeNull();
//   });
// });
//
// function createContext(): {
//   appHost: AppHost;
//   context: GestureActionContext<AppHost>;
//   editorHost: EditorHost;
// } {
//   const workspace: WorkspaceContract = {
//     state: createWorkspaceState(),
//     registry: createRegistryContract(),
//     app: null,
//     editor: null,
//     render: null,
//     simulation: null,
//     sync: null,
//     blueprintPlanner: null,
//   };
//   const editorHost = createEditorHost(workspace);
//   const appHost = createAppHost(workspace);
//   disposers.push(appHost.regionalSettings.bindInactiveDarkPipeLinkEdits(
//     editorHost,
//     () => appHost.state.settings.regionalMultiBaseEnabled,
//   ));
//   disposers.push(() => appHost.dispose(), () => editorHost.dispose());
//
//   return {
//     appHost,
//     editorHost,
//     context: {
//       appHost,
//       workspace,
//       keyboard: emptyKeyboard(),
//     },
//   };
// }
//
// function createDocument(entities: readonly WorldEntity[]): WorldDocument {
//   const document = createDummyWorldDocument();
//   document.entities = Object.fromEntries(entities.map((candidate) => [candidate.id, candidate]));
//   document.entityOrder = entities.map((candidate) => candidate.id);
//   document.slotLinks = [];
//   return document;
// }
//
// function entity(id: string, definitionId: string): WorldEntity {
//   return {
//     id,
//     definitionId,
//     position: { x: 0, y: 0 },
//     rotation: 0,
//     config: {},
//     tags: [],
//   };
// }
//
// function enterDarkPipeLinkTool(appHost: AppHost): void {
//   runInAction(() => {
//     appHost.internalState.toolInfo.darkPipeLink = {
//       sourceBaseId: appHost.workspace.editor?.document.getSnapshot().baseId ?? "wuling_protocol_core",
//       sourceEntityId: "inlet",
//       sourceRole: "inlet",
//       candidateEntityIds: ["outlet"],
//       returnTool: "select",
//     };
//   });
//   appHost.internalActions.setActiveTool("dark-pipe-link");
// }
//
// function emptyKeyboard(): KeyboardSnapshot {
//   return {
//     pressedKeys: new Set(),
//     lastCode: null,
//     lastKey: null,
//     lastKeyCode: null,
//     modifiers: emptyModifiers(),
//   };
// }
//
// function emptyModifiers() {
//   return {
//     alt: false,
//     ctrl: false,
//     meta: false,
//     shift: false,
//   };
// }
