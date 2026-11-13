import { createAppHost } from "@/app/host/app-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSceneSessionFactories } from "@/editor/scene-session";
import { createWorldDocument } from "@/domain/document/world-document";
import { createEditorHost, type EditorRuntimeOptions } from "@/editor/editor-host";
import { bindEditorViewToDocument } from "@/editor/document-viewport";
import type { AppHost } from "@/app/host/app-host";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";

const views = new WeakMap<WorkspaceContract, EditorViewContract>();

/** 组合真实主机；未参与用例的模块保持未装配，不构造假的业务接口。 */
export function createAppTestWorkspace() {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null,
    sync: null, audio: null, blueprintPlanner: null,
  };
  const app = createAppTestHost(workspace);
  return { workspace, app };
}

/** 测试组合根显式装配真实 View 与工厂，不向生产主机补回已退出的字段。 */
export function createAppTestHost(workspace: WorkspaceContract, options: { mode?: "workbench" | "embed" } = {}): AppHost {
  const sceneFactories = createSceneSessionFactories(workspace.registry);
  const mainView = getTestView(workspace);
  const app = createAppHost(workspace, { ...options, mainView, sceneFactories });
  // AI-REMOVED 2026-11-12:
  // Reason: Editor 测试装配统一拥有文档绑定，App 构造顺序不应重复注册。
  // Trigger: REQ-048 测试组合根迁移。
  // Evidence: 编辑器可以先于工作台创建和设置相机。
  // Replacement: createEditorTestHost
  // Risk: Low
  // Human Review: Required
  // Original code:
  // const editor = workspace.editor;
  // const releaseBinding = editor !== null && "internalDocumentWriter" in editor
  //   ? bindTestMainView(editor as ReturnType<typeof createEditorHost>, mainView) : null;
  const dispose = app.dispose;
  app.dispose = () => { dispose(); mainView.dispose(); if (views.get(workspace) === mainView) views.delete(workspace); };
  return app;
}

/** 主工作区的发布责任与正式 main 一致，独立内存会话测试直接使用 SceneSession 工厂。 */
export function createEditorTestHost(workspace: WorkspaceContract, options: EditorRuntimeOptions = {}) {
  let binding: ReturnType<typeof bindEditorViewToDocument> | null = null;
  const editor = createEditorHost(workspace, { ...options,
    beforeDocumentChange: () => { binding?.flush(); options.beforeDocumentChange?.(); },
    captureOperationGuard: options.captureOperationGuard ?? (() => {
      const canvas = (workspace.app as AppHost | null)?.mainCanvas;
      const selection = canvas?.state.toolInfo.darkPipeLink;
      return () => selection == null || canvas?.state.toolInfo.darkPipeLink === selection;
    }),
  });
  workspace.editor = editor;
  const mainView = getTestView(workspace);
  binding = bindTestMainView(editor, mainView);
  const dispose = editor.dispose;
  editor.dispose = () => {
    binding?.dispose(); dispose(); mainView.dispose();
    if (views.get(workspace) === mainView) views.delete(workspace);
  };
  return editor;
}

export function createEditorTestFixture(workspace: WorkspaceContract, options: EditorRuntimeOptions = {}) {
  const editor = createEditorTestHost(workspace, options);
  const view = getTestView(workspace);
  return { editor, view };
}

/** 每个真实测试工作区一个相机；相机入口始终与 Editor 的文档入口分开。 */
export function getTestView(workspace: WorkspaceContract): EditorViewContract {
  const existing = views.get(workspace);
  if (existing !== undefined) return existing;
  const document = workspace.editor?.document.getSnapshot() ?? createWorldDocument();
  const space = { areas: workspace.registry.baseDefinitions.find(base => base.id === document.baseId)?.areas ?? [] };
  const view = createSceneSessionFactories(workspace.registry).createView({ id: "test-workbench",
    initialViewport: document.documentSettings.viewport,
    bounds: { kind: "space", bounds: resolveBaseOuterBounds(space)
      ?? { minX: null, maxX: null, minY: null, maxY: null }, padding: 2 },
    getOperationAvailability: operation => workspace.editor?.queries.getOperationAvailability(operation)
      ?? { supported: true, enabled: true, reason: null },
  });
  views.set(workspace, view);
  return view;
}

function bindTestMainView(editor: ReturnType<typeof createEditorHost>, view: EditorViewContract) {
  return bindEditorViewToDocument({ document: editor.document, documentWriter: editor.internalDocumentWriter, view,
    readSpace: () => ({ areas: editor.workspace.registry.baseDefinitions.find(base => base.id === editor.document.getSnapshot().baseId)?.areas ?? [] }),
  });
}
