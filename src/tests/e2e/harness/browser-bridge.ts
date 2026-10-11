import type { AppHost } from "@/app/host";
import type { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import type { GridPoint } from "@/domain/shared/grid";
import type { ensureProtocolCoreEntity } from "@/editor/ensure-protocol-core";

/** 由专用 Vite 插件注入组合根；只在函数内部引用注入的真实主机。 */
export function installE2eBridge(app: AppHost, normalize: typeof normalizeBlueprintDocument, ensureCore: typeof ensureProtocolCoreEntity) {
  const editor = app.workspace.editor;
  if (!editor || !app.workspace.render || !app.workspace.simulation) throw new Error("E2E 接口必须在主机装配完成后安装");
  const point = (gridPoint: GridPoint) => {
    const rect = editor.queries.findClientRectForGridCell(gridPoint);
    if (!rect) throw new Error("画布坐标尚未就绪");
    const result = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) throw new Error("画布坐标无效");
    return result;
  };
  const bridge = {
    readiness() {
      const viewport = editor.state.viewport;
      const canvas = app.workspace.render?.container.querySelector("canvas");
      return {
        assembled: true,
        canvasAttached: Boolean(canvas?.isConnected),
        viewportValid: viewport.clientRect.width > 0 && viewport.clientRect.height > 0
          && Number.isFinite(viewport.gridSize) && viewport.gridSize > 0
          && Number.isFinite(viewport.center.x) && Number.isFinite(viewport.center.y)
          && Number.isFinite(viewport.gridCellPixelSize) && viewport.gridCellPixelSize > 0,
        screen: { ...app.state.screenProfile },
      };
    },
    getAppState() {
      const document = editor.document.getSnapshot();
      return {
        baseId: document.baseId, documentKey: document.documentKey, entityCount: document.entityOrder.length,
        tool: app.state.activeTool, selection: [...editor.state.collections.selection],
        previewCount: editor.state.collections.preview.length,
        continuousPlacement: app.internalState.runtime.blueprintPlacementContinuous,
        engineKind: app.workspace.simulation?.engineKind,
        screen: { ...app.state.screenProfile },
        viewport: { center: { ...editor.state.viewport.center }, gridSize: editor.state.viewport.gridSize,
          gridCellPixelSize: editor.state.viewport.gridCellPixelSize },
        sync: app.workspace.sync ? {
          phase: app.workspace.sync.state.status.phase,
          saveState: app.workspace.sync.state.status.saveState,
          pendingLocalChangeCount: app.workspace.sync.state.status.pendingLocalChangeCount,
          lastError: app.workspace.sync.state.status.lastError,
        } : null,
      };
    },
    /** 只读快照，不执行 flush，避免观测改变真实持久化时序。 */
    document() { return JSON.parse(JSON.stringify(editor.document.getSnapshot())) as ReturnType<typeof editor.document.getSnapshot>; },
    entity(id: string) {
      const entity = editor.queries.getEntityById(id);
      return entity ? JSON.parse(JSON.stringify(entity)) as typeof entity : null;
    },
    gridPoint: point,
    entityPoint(id: string) {
      const entity = editor.queries.getEntityById(id);
      if (!entity) throw new Error(`场景中不存在实体 ${id}`);
      return point(entity.position);
    },
    /** 聚焦仅用于布景；选择、剪切和放置等被测动作必须走浏览器事件。 */
    async focusEntity(id: string) {
      const entity = editor.queries.getEntityById(id);
      if (!entity) throw new Error(`场景中不存在实体 ${id}`);
      const definition = app.workspace.registry.entityDefinitions.find(item => item.id === entity.definitionId);
      if (!definition) throw new Error(`未注册的场景实体 ${entity.definitionId}`);
      const rotated = entity.rotation === 90 || entity.rotation === 270;
      const x = entity.position.x + (rotated ? definition.footprint.height : definition.footprint.width) / 2;
      const y = entity.position.y + (rotated ? definition.footprint.width : definition.footprint.height) / 2;
      // focusOnEntity 是动画入口；duration=0 不代表同步完成，且会导致除零。
      editor.actions.focusOnEntity(id, { duration: 100 });
      const deadline = performance.now() + 3000;
      while (performance.now() < deadline) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 100);
          requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
        });
        if (Math.abs(editor.state.viewport.center.x - x) < 0.001
          && Math.abs(editor.state.viewport.center.y - y) < 0.001) return;
      }
      throw new Error(`实体聚焦未完成：${id}`);
    },
    async loadBlueprint(input: unknown) {
      const blueprint = normalize(input);
      if (!blueprint) throw new Error("无效的版本化测试蓝图");
      if (!app.workspace.registry.baseDefinitions.some(base => base.id === blueprint.baseId)) throw new Error(`未知基地 ${blueprint.baseId}`);
      await editor.actions.loadLatestBaseDocument(blueprint.baseId);
      const before = editor.document.getSnapshot();
      if (before.baseId !== blueprint.baseId) throw new Error("测试场景基地切换失败");
      const scene = ensureCore({ document: { ...before,
        entities: blueprint.entities, entityOrder: blueprint.entityOrder,
        slotLinks: blueprint.slotLinks, regions: blueprint.regions,
      }, queries: app.workspace.registry.queries, baseDefinitions: app.workspace.registry.baseDefinitions });
      await editor.actions.applySynchronizedDocument(scene);
      editor.actions.clearCollection("selection");
      const loaded = editor.document.getSnapshot();
      for (const id of blueprint.entityOrder) if (!loaded.entities[id]) throw new Error(`场景实体装载丢失：${id}`);
      return { baseId: loaded.baseId, entityIds: [...blueprint.entityOrder], slotLinkCount: loaded.slotLinks.length };
    },
  };
  window.__test__ = bridge;
}

declare global {
  interface Window {
    __test__?: {
      readiness(): { assembled: boolean; canvasAttached: boolean; viewportValid: boolean; screen: AppHost["state"]["screenProfile"] };
      getAppState(): {
        baseId: string; documentKey: string; entityCount: number; tool: AppHost["state"]["activeTool"];
        selection: string[]; previewCount: number; continuousPlacement: boolean;
        engineKind: string | undefined; screen: AppHost["state"]["screenProfile"];
        viewport: { center: GridPoint; gridSize: number; gridCellPixelSize: number };
        sync: { phase: string; saveState: string; pendingLocalChangeCount: number; lastError: unknown } | null;
      };
      document(): ReturnType<NonNullable<AppHost["workspace"]["editor"]>["document"]["getSnapshot"]>;
      entity(id: string): ReturnType<NonNullable<AppHost["workspace"]["editor"]>["queries"]["getEntityById"]>;
      gridPoint(point: GridPoint): { x: number; y: number };
      entityPoint(id: string): { x: number; y: number };
      focusEntity(id: string): Promise<void>;
      loadBlueprint(input: unknown): Promise<{ baseId: string; entityIds: string[]; slotLinkCount: number }>;
    };
  }
}
