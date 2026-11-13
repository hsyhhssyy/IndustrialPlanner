import { AVAILABLE_OPERATION, guardEditorActions } from "./editor-operation-policy";
import type { SceneSpace } from "@/domain/shared/scene-space";
import { validateSceneSpace } from "@/shared/geometry/scene-space";
import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import { resolveEditorPlacementGeometry } from "./placement-space";
import type { WorldDocument } from "@/domain/document/world-document";
import { EditorContract } from "@/domain/editor/editor-contract";
import { WorkspaceContract } from "@/domain/document/workspace-contract";
import { runInAction } from "mobx";
import { createWorldDocument } from "@/domain/document/world-document";
import {
  // AI-REMOVED 2026-11-12: Reason: store 迁入 session-document；Trigger: REQ-048；Evidence: 上述迁移；Replacement: createSessionDocument；Risk: Low；Human Review: Required
  // createSnapshotStore,
  SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { createEditorActions } from "./actions";
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
// import { applyWorldDocumentViewportSettings, createViewportPersistence } from "./document-viewport";
// AI-REMOVED 2026-11-12: Reason: 冻结由会话 store 承担；Trigger: REQ-048；Evidence: createSessionDocument；Replacement: session-document.ts；Risk: Low；Human Review: Required
// import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import { createSnapshotSelector, shallowSnapshotEqual } from "@/shared/snapshot/snapshot-selector";
import { selectDocumentEntities } from "@/shared/snapshot/world-document-selection";
import { createEditorDocumentRepository, hookDocumentStorage } from "./document-storage";
import type { EditorDocumentRepository } from "./document-repository";
import {
  createEditorDocumentWriter,
  EditorDocumentWriter,
  EditorHistoryRuntime,
} from "./history";
import { createEditorQueries } from "./queries";
import { syncPlacementValidationState } from "./placement-validation";
import { syncPoweredEntityCollection } from "./actions/powered-collection";
import { hookLocalstorage } from "./storage-hook";
// AI-REMOVED 2026-10-08:
// Reason: 独立监听调度已由全局迁移接管。
// Trigger: REQ-041 全局迁移。
// Evidence: 启动、读取与同步调用链审查。
// Replacement: src/editor/data-migration.ts
// Risk: 需验证全库迁移与中断恢复。
// Human Review: Required
// Original code:
// import { hookLegacyDarkPipeMigration } from "./legacy-dark-pipe-migration";

import { hookDarkPipeLinkLifecycle, normalizeEditedDarkPipeLinks } from "./dark-pipe-link-lifecycle";
import { createEditorStateReadWrite, EditorStateReadWrite } from "./state-impl";
import type { EditorSessionWriter } from "./history/document-writer";
import type { EditorServices } from "./editor-services";
import type { EditorSessionPolicy, EditorDocumentTransition } from "@/domain/editor/types/editor-session-types";
import { createSessionDocument } from "./session-document";
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
// import type { ViewportBounds } from "./viewport-settings";

// state 和 document 都是外部使用的，editor组件内部使用internal来获取可写的state和document
export interface EditorRuntimeHost extends EditorContract {
  internalDocument: SnapshotStoreReadWrite<WorldDocument>;
  internalDocumentWriter: EditorDocumentWriter;
  internalHistory: EditorHistoryRuntime;
  internalDocuments: EditorDocumentRepository;
  services: EditorServices;
  internalState: EditorStateReadWrite;
  dispose: () => void;
}

export interface EditorHost extends EditorRuntimeHost {
  workspace: WorkspaceContract;
}

export interface EditorRuntimeOptions<TIntent = undefined> {
  persistence?: "browser" | "memory";
  initialDocument?: WorldDocument;
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
//   viewportBounds?: ViewportBounds;
  // AI-REMOVED 2026-11-12: Reason: 不能绕过校验；Trigger: REQ-048；Evidence: 无界应使用 null 边；Replacement: space；Risk: Low；Human Review: Required
  // placementBounds?: "base" | "unbounded";
  space?: SceneSpace;
  beforeDocumentChange?: () => void;
  /** 由交互 owner 捕获异步提交资格；Editor 不读取 App 工具状态。 */
  captureOperationGuard?: () => () => boolean;
  initialIntent?: TIntent;
  policy?: EditorSessionPolicy<TIntent>;
  reduceIntent?: (intent: TIntent, transition: EditorDocumentTransition) => TIntent;
}

export function createEditorHost(workspace: WorkspaceContract, options: EditorRuntimeOptions = {}): EditorHost {
  const host = createEditorRuntime(workspace, options);
  // 主工作台发布将在 A1 装配迁移中收敛到 main；内存会话不经过此入口。
  // AI-CORRECTION 2026-11-12: 发布已移到 main，工厂不再隐式覆盖 Workspace。
  // AI-REMOVED 2026-11-12: Reason: 装配职责归组合根；Trigger: REQ-048 A1；Evidence: 两个生产入口已显式发布；Replacement: main.tsx；Risk: 测试装配需同步；Human Review: Required
  // workspace.editor = host;
  return Object.assign(host, { workspace });
}

export function createEditorRuntime<TIntent = undefined>(services: EditorServices, options: EditorRuntimeOptions<TIntent> = {}) {
  const space = options.space === undefined ? undefined : freezeSnapshot(structuredClone(options.space));
  if (space !== undefined) validateSceneSpace(space);
  const workspace: EditorServices = space === undefined ? services : {
    registry: services.registry,
    includeBaseBuiltins: services.includeBaseBuiltins,
    get app() { return services.app; },
    get simulation() { return services.simulation; },
    placement: {
      space,
      resolvePlacementAreaIds: (entity, candidateSpace) => options.policy?.resolvePlacementAreaIds(entity, candidateSpace)
        ?? resolveEditorPlacementGeometry(services, sessionDocument.document.getSnapshot(), entity).allowedAreaIds,
    },
  };
  const persistence = options.persistence ?? "browser";
  const disposers: Array<() => void> = [];
  let disposed = false;
  // AI-REMOVED 2026-11-12:
  // Reason: 文档必须成为完整会话的只读投影。
  // Trigger: REQ-048 原子会话快照。
  // Evidence: 单独文档 store 无法同时发布意图。
  // Replacement: createSessionDocument。
  // Risk: 文档切换持久化需回归。
  // Human Review: Required
  // Original code:
  // let publishedDocument: WorldDocument | null = null;
  // const internalDocument = createSnapshotStore(options.initialDocument ?? createWorldDocument(), (nextDocument) => {
  // if (publishedDocument !== null && publishedDocument.documentKey !== nextDocument.documentKey) {
  // viewportPersistence?.flush();
  // }
  // publishedDocument = freezeSnapshot(nextDocument);
  // return publishedDocument;
  // });
  const sessionDocument = createSessionDocument(options.initialDocument ?? createWorldDocument(), options.initialIntent as TIntent, (): void => { options.beforeDocumentChange?.(); });
  const internalDocument = sessionDocument.document;
  const editorState = createEditorStateReadWrite();
  // AI-REMOVED 2026-11-12: Reason: 不再存储校验旁路；Trigger: REQ-048；Evidence: 统一几何校验；Replacement: services.placement；Risk: Low；Human Review: Required
  // runInAction(() => { editorState.internalTransientState.placementBounds = options.placementBounds ?? "base"; });
  const internalDocuments = createEditorDocumentRepository({
    document: internalDocument, state: editorState, workspace,
    persistence,
  });
  const getOperationAvailability = (operation: Parameters<EditorContract["queries"]["getOperationAvailability"]>[0]) => disposed ? { supported: false, enabled: false, reason: null }
    : options.policy?.getOperationAvailability(operation) ?? AVAILABLE_OPERATION;
  const internalHistory = new EditorHistoryRuntime(editorState.history, { persistence });
  const internalDocumentWriter: EditorSessionWriter<TIntent> = createEditorDocumentWriter({
    document: internalDocument,
    history: internalHistory,
    getOperationAvailability,
    isDisposed: () => disposed,
    session: {
      getIntent: () => sessionDocument.snapshot.getSnapshot().intent,
      reduceIntent: options.reduceIntent ?? ((intent) => intent),
      validateTransition: (transition, intent) => options.policy?.validateTransition(transition, intent) ?? [],
      publish: sessionDocument.publish,
    },
    normalizeEdit: (before, after) => normalizeEditedDarkPipeLinks(before, after,
      workspace.app?.state.settings.regionalMultiBaseEnabled === true),
  });
  // AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
// const viewportPersistence = persistence === "browser" ? createViewportPersistence({
//     document: internalDocument,
//     documentWriter: internalDocumentWriter,
//     state: editorState,
//   }) : null;
  const queries: EditorContract["queries"] = createEditorQueries({
    getOperationAvailability,
    history: internalHistory,
    document: internalDocument,
    documents: internalDocuments,
    state: editorState,
    workspace,
  });
  const actions: EditorContract["actions"] = guardEditorActions(createEditorActions({
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
//     viewportBounds: options.viewportBounds,
    document: internalDocument,
    documentWriter: internalDocumentWriter,
    documents: internalDocuments,
    history: internalHistory,
    state: editorState,
    workspace,
    queries,
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
//     persistViewportSettings: () => viewportPersistence?.schedule(),
    beforeDocumentChange: (): void => { options.beforeDocumentChange?.(); },
    captureOperationGuard: () => options.captureOperationGuard?.() ?? (() => true),
  }), { getOperationAvailability, isDisposed: () => disposed, allowDocumentMaintenance: persistence === "browser" });


  const publicState: EditorContract["state"] = {
    // AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
// viewport: editorState.viewport,
    get marqueeGridRect() {
      return editorState.marqueeGridRect;
    },
    history: editorState.history,
    regionAnnotations: editorState.regionAnnotations,
    collections: editorState.collections,
    get hoverTarget() {
      return editorState.hoverTarget;
    },
    get suppressBelts() {
      return editorState.suppressBelts;
    },
    get suppressPipes() {
      return editorState.suppressPipes;
    },
  };

  const host: EditorRuntimeHost = {
    document: {
      getSnapshot: internalDocument.getSnapshot,
      subscribe: internalDocument.subscribe,
    },
    state: publicState,
    internalDocument,
    internalDocuments,
    internalDocumentWriter,
    internalHistory,
    services: workspace,
    dispose: () => {
      if (disposed) return;
      options.beforeDocumentChange?.();
      disposed = true;
      internalHistory.dispose();
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
//       viewportPersistence?.dispose();
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
    queries,
    actions,
    internalState: editorState,
  };

  // AI-REMOVED 2026-11-12:
  // Reason: 纯 Editor runtime 不能发布或覆盖主工作台 Editor。
  // Trigger: REQ-048 无头内存会话。
  // Evidence: 创建第二个 Editor 会覆盖全局主 Editor。
  // Replacement: 当前主工作台 createEditorHost 的显式装配（A1 后移至 main）。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // workspace.editor = host;
  disposers.push(hookDocumentHistory(host));
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
//   disposers.push(hookDocumentViewport(host, options.viewportBounds));
  disposers.push(hookPlacementValidation(host));
  disposers.push(hookPoweredCollection(host));
  if (persistence === "browser") disposers.push(hookLocalstorage(host));
  disposers.push(hookDocumentStorage(host, { persistence, initialDocument: options.initialDocument }));
// AI-REMOVED 2026-10-08:
// Reason: 迁移必须在业务初始化前统一执行。
// Trigger: REQ-041 全局迁移。
// Evidence: 启动、读取与同步调用链审查。
// Replacement: src/editor/data-migration.ts
// Risk: 需验证全库迁移与中断恢复。
// Human Review: Required
// Original code:
//   disposers.push(hookLegacyDarkPipeMigration(host));

  if (persistence === "browser") disposers.push(hookDarkPipeLinkLifecycle(host));

  return Object.assign(host, { internalDocumentWriter, internalSessionSnapshot: sessionDocument.snapshot });
}

function hookPlacementValidation(editorHost: EditorRuntimeHost): () => void {
  return createSnapshotSelector(editorHost.internalDocument, selectDocumentEntities, shallowSnapshotEqual).subscribe(() => {
    const document = editorHost.internalDocument.getSnapshot();
    runInAction(() => {
      syncPlacementValidationState({
        document,
        state: editorHost.internalState,
        workspace: editorHost.services,
      });
    });
  });
}

function hookPoweredCollection(editorHost: EditorRuntimeHost): () => void {
  return createSnapshotSelector(editorHost.internalDocument, selectDocumentEntities, shallowSnapshotEqual).subscribe(() => {
    const document = editorHost.internalDocument.getSnapshot();
    runInAction(() => {
      syncPoweredEntityCollection({
        document,
        state: editorHost.internalState,
        workspace: editorHost.services,
      });
    });
  });
}

function hookDocumentHistory(editorHost: EditorRuntimeHost): () => void {
  let documentKey: string | null = null;

  return editorHost.internalDocument.subscribe((document) => {
    if (documentKey === document.documentKey) {
      return;
    }

    documentKey = document.documentKey;
    editorHost.internalHistory.loadDocumentHistory(document.documentKey);
  });
}

// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: main 的显式 View 持久化绑定
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// function hookDocumentViewport(editorHost: EditorRuntimeHost, viewportBounds: ViewportBounds = "base"): () => void {
//   let documentKey: string | null = null;
//
//   return editorHost.internalDocument.subscribe((document) => {
//     if (documentKey === document.documentKey) {
//       return;
//     }
//
//     documentKey = document.documentKey;
//     runInAction(() => {
//       applyWorldDocumentViewportSettings({
//         viewportBounds,
//         document,
//         state: editorHost.internalState,
//         workspace: editorHost.services,
//       });
//     });
//   });
// }
