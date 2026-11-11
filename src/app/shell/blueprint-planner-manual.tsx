import { matchManualPlacements } from "@/shared/planner-manual-binding";
import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerManualFacilityTemplate, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPreviewHandle, BlueprintPreviewScene, BlueprintPreviewViewport } from "@/domain/renderer";
import type { GridPoint } from "@/domain/shared/grid";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { AppHost } from "../host";
import styles from "./blueprint-planner-manual.module.scss";

type PaletteSelection = { node: BlueprintPlannerManualNode } | { template: BlueprintPlannerManualFacilityTemplate };

export const BlueprintPlannerManual = observer(function BlueprintPlannerManual({ appHost, request, disabled }: {
  appHost: AppHost; request: BlueprintPlannerRequest; disabled: boolean;
}) {
  const state = appHost.blueprintPlannerDialog.manual, layout = state.layout;
  const renderer = appHost.workspace.render, registry = appHost.workspace.registry, t = appHost.actions.translate;
  const stage = useRef<HTMLDivElement>(null), canvasHost = useRef<HTMLDivElement>(null), handle = useRef<BlueprintPreviewHandle | null>(null);
  const dimensions = useRef({ width: 0, height: 0 });
  const [ready, setReady] = useState(false), [renderError, setRenderError] = useState<string | null>(null);
  const [palette, setPalette] = useState<PaletteSelection | null>(null);
  const [view, setView] = useState<BlueprintPreviewViewport>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [moving, setMoving] = useState<{ id: string; point: GridPoint } | null>(null);
  const drag = useRef<{ pointer: number; node: BlueprintPlannerManualNode | null; offset: GridPoint; start: GridPoint; moved: boolean; point?: GridPoint } | null>(null);
  const requestRef = useRef(request); requestRef.current = request;
  const prepareKey = JSON.stringify([request.plan, request.options, layout?.enabled, layout?.mode, layout?.facilities, layout?.placements]);
  useEffect(() => { void state.prepare(requestRef.current); }, [state, prepareKey]);
  const invalidPositions = useMemo(() => layout ? state.invalidPositions(registry) : [], [state, registry, layout]);
  const invalid = useMemo(() => [...new Set([...invalidPositions, ...layout?.preparation.placementIssues.flatMap(issue => issue.nodeIds) ?? []])], [invalidPositions, layout]);
  const assignments = useMemo(() => layout ? matchManualPlacements(layout.preparation.nodes, layout.placements, layout.mode).assignments
    : new Map<string, BlueprintPlannerManualNode>(), [layout]);
  const scene = useMemo<BlueprintPreviewScene>(() => {
    const placements = layout?.placements ?? [];
    const entities = placements.map(entry => ({ id: entry.referenceNode.id, definitionId: entry.referenceNode.definitionId,
      position: moving?.id === entry.referenceNode.id ? moving.point : entry.position,
      rotation: entry.rotation, config: {}, tags: [] }));
    const references = new Map([...assignments].map(([reference, node]) => [node.id, reference]));
    return { blueprint: createBlueprintDocument({ blueprintId: "manual-layout", name: request.plan.name, baseId: request.plan.sourceBaseId,
      initialGridPoint: { x: 0, y: 0 }, entityOrder: entities.map(entity => entity.id), entities: Object.fromEntries(entities.map(entity => [entity.id, entity])), slotLinks: [] }),
    overlay: { selectedEntityIds: state.selectedId ? [state.selectedId] : [], invalidEntityIds: invalid,
      productionItemIds: Object.fromEntries(placements.map(({ referenceNode }) => [referenceNode.id,
        (assignments.get(referenceNode.id) ?? referenceNode).outputs.map(flow => flow.itemId)])),
      links: layout?.preparation.connections.filter(edge => references.has(edge.sourceNodeId) && references.has(edge.targetNodeId))
        .map(edge => ({ sourceEntityId: references.get(edge.sourceNodeId)!, targetEntityId: references.get(edge.targetNodeId)!, binding: layout.mode === "topology" })) ?? [] } };
    // 布局快照与选择决定场景；纯计算进度不会重建画布。
  }, [layout, moving, state.selectedId, request.plan.name, request.plan.sourceBaseId, invalid, assignments]);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const viewRef = useRef(view); viewRef.current = view;
  useEffect(() => {
    const element = stage.current;
    if (!element || !layout?.enabled) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      dimensions.current = { width: Math.max(0, Math.floor(bounds.width)), height: Math.max(0, Math.floor(bounds.height)) };
      setReady(dimensions.current.width > 0 && dimensions.current.height > 0);
      if (renderer && handle.current) renderer.actions.resizeBlueprintPreview(handle.current, dimensions.current.width, dimensions.current.height);
    };
    const observer = new ResizeObserver(measure); measure(); observer.observe(element);
    return () => observer.disconnect();
  }, [renderer, layout?.enabled]);
  useEffect(() => {
    const element = canvasHost.current;
    if (!renderer || !ready || !element || !layout?.enabled) return;
    let alive = true, mounted: BlueprintPreviewHandle | null = null;
    void renderer.actions.mountBlueprintPreview({ blueprint: sceneRef.current.blueprint, ...dimensions.current,
      viewportBounds: { left: 0, top: 0, width: 30, height: 20 }, viewport: viewRef.current }).then(value => {
      if (!alive) { renderer.actions.disposeBlueprintPreview(value); return; }
      mounted = value; handle.current = value;
      const canvas = renderer.queries.getBlueprintPreviewCanvas(value);
      if (canvas) { canvas.ariaHidden = "true"; canvas.style.touchAction = "none"; element.replaceChildren(canvas); }
      renderer.actions.updateBlueprintPreviewScene(value, sceneRef.current);
      renderer.actions.resizeBlueprintPreview(value, dimensions.current.width, dimensions.current.height);
    }).catch(error => { if (alive) setRenderError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; handle.current = null; element.replaceChildren(); if (mounted) renderer.actions.disposeBlueprintPreview(mounted); };
  }, [renderer, ready, layout?.enabled]);
  useEffect(() => { if (renderer && handle.current) renderer.actions.updateBlueprintPreviewScene(handle.current, scene); }, [renderer, scene]);
  useEffect(() => { if (renderer && handle.current) renderer.actions.updateBlueprintPreviewViewport(handle.current, view); }, [renderer, view]);
  const point = (clientX: number, clientY: number) => {
    const rect = stage.current?.getBoundingClientRect();
    return rect && renderer && handle.current ? renderer.queries.blueprintPreviewScreenToGrid(handle.current,
      { x: clientX - rect.left, y: clientY - rect.top }) : null;
  };
  const drop = (selection: PaletteSelection, position: GridPoint) => {
    if (disabled || state.loading) return;
    if ("node" in selection) { state.place(selection.node, position); setPalette(null); }
    else state.addFacility(selection.template, position);
  };
  const title = (node: { definitionId: string }) => t(registry.queries.findEntityDefinition(node.definitionId)?.nameKey ?? node.definitionId);
  const recipeTitle = (id: string) => {
    const recipe = registry.queries.findRecipeDefinition(id);
    if (!recipe) return id;
    const translated = t(recipe.nameKey);
    if (translated !== recipe.nameKey) return translated;
    // 部分配方不提供独立译名，按实际输入和输出区分同设备的不同用途。
    const names = (flows: typeof recipe.inputs) => flows.map(flow => t(registry.queries.findItemDefinition(flow.itemId)?.nameKey ?? flow.itemId)).join(" + ");
    return `${names(recipe.inputs)} → ${(recipe.powerOutput ?? 0) > 0 ? `${recipe.powerOutput} kW` : names(recipe.outputs)}`;
  };
  const placed = new Set([...assignments.values()].map(node => node.id));
  const nodes = layout?.preparation.nodes.filter(node => !placed.has(node.id)) ?? [];
  const icon = (node: BlueprintPlannerManualNode) => {
    const item = node.outputs[0]?.itemId, definition = item && registry.queries.findItemDefinition(item);
    return item ? <img alt="" src={createItemIconAssetUrl(definition ? definition.iconId : item)} /> : null;
  };
  const selected = layout?.placements.find(entry => entry.referenceNode.id === state.selectedId);
  return <section className={styles.manual} aria-label={t("eda.wizard.manual")}>
    <div className={styles.heading}><label><input type="checkbox" checked={layout?.enabled ?? false} disabled={disabled}
      onChange={event => state.setEnabled(event.target.checked)} />{t("eda.wizard.manualPreset")}</label>
      {layout?.enabled ? <select aria-label={t("eda.manual.binding")} value={layout.mode} disabled={disabled || state.loading}
        onChange={event => state.setMode(event.target.value as "device" | "recipe" | "topology")}>
        {["device", "recipe", "topology"].map(mode => <option key={mode} value={mode}>{t(`eda.manual.${mode}`)}</option>)}
      </select> : null}</div>
    {layout?.enabled ? <>
      <div className={styles.toolbar}>
        <span>{t("eda.manual.placed").replace("{count}", String(layout.placements.length))}</span>
        <button type="button" disabled={disabled || !selected || state.loading} onClick={state.rotate}>{t("eda.manual.rotate")}</button>
        <button type="button" disabled={disabled || !selected || state.loading} onClick={state.remove}>{t("eda.manual.remove")}</button>
        <button type="button" disabled={disabled || !state.canUndo} onClick={state.undo}>{t("eda.manual.undo")}</button>
        <button type="button" aria-label={t("eda.previewZoomOut")} onClick={() => setView(view => ({ ...view, zoom: Math.max(.2, view.zoom / 1.3) }))}>−</button>
        <button type="button" onClick={() => setView({ zoom: 1, offsetX: 0, offsetY: 0 })}>{t("eda.manual.resetView")}</button>
        <button type="button" aria-label={t("eda.previewZoomIn")} onClick={() => setView(view => ({ ...view, zoom: Math.min(6, view.zoom * 1.3) }))}>+</button>
        {state.loading ? <span role="status">{t("eda.manual.preparing")}</span> : null}
      </div>
      <div className={styles.editor}>
        <aside className={styles.palette} aria-label={t("eda.manual.pending")}>
          <strong>{t("eda.manual.pending")} · {nodes.length}</strong>
          {nodes.map(node => <button key={node.id} type="button" draggable disabled={disabled || state.loading}
            aria-pressed={!!palette && "node" in palette && palette.node.id === node.id} onClick={() => setPalette({ node })}
            onDragStart={event => { setPalette({ node }); event.dataTransfer.setData("application/x-planner-device", node.id); }}>
            {icon(node)}<span>{title(node)}{node.recipeId ? <small>{recipeTitle(node.recipeId)}</small> : null}</span>
          </button>)}
          <strong>{t("eda.manual.facilities")}</strong>
          {layout.preparation.facilityTemplates.map(template => <button key={`${template.definitionId}/${template.recipeId}`} type="button" draggable
            disabled={disabled || state.loading} onClick={() => setPalette({ template })}
            aria-pressed={!!palette && "template" in palette && palette.template === template}
            onDragStart={event => { setPalette({ template }); event.dataTransfer.setData("application/x-planner-device", template.definitionId); }}>
            <span>＋ {title(template)}{template.recipeId ? <small>{recipeTitle(template.recipeId)}</small> : null}</span>
          </button>)}
        </aside>
        <div ref={stage} className={styles.stage} tabIndex={0} role="application" aria-label={t("eda.manual.canvas")}
          onKeyDown={event => {
            // 画布快捷键只作用于人工布局，避免 Escape 继续关闭整个向导。
            event.stopPropagation();
            if (disabled || state.loading) return;
            if (event.key.toLowerCase() === "r") { event.preventDefault(); state.rotate(); }
            if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); state.remove(); }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); state.undo(); }
            if (event.key === "Escape") { setPalette(null); state.select(null); }
          }}
          onDragOver={event => event.preventDefault()} onDrop={event => {
            event.preventDefault(); const position = point(event.clientX, event.clientY);
            if (palette && position) drop(palette, position);
          }}
          onPointerDown={event => {
            if (event.button !== 0 || disabled || state.loading) return;
            event.currentTarget.focus();
            const position = point(event.clientX, event.clientY);
            if (!position) return;
            if (palette) { drop(palette, position); return; }
            const hit = [...layout.placements].reverse().find(entry => {
              const definition = registry.queries.findEntityDefinition(entry.referenceNode.definitionId);
              if (!definition) return false;
              const rect = resolveEntityGridRect({ entity: { ...entry, id: entry.referenceNode.id, definitionId: entry.referenceNode.definitionId, config: {}, tags: [] }, definition });
              return position.x >= rect.x && position.y >= rect.y && position.x < rect.x + rect.width && position.y < rect.y + rect.height;
            });
            state.select(hit?.referenceNode.id ?? null); event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointer: event.pointerId, node: hit?.referenceNode ?? null,
              offset: hit ? { x: position.x - hit.position.x, y: position.y - hit.position.y } : { x: 0, y: 0 },
              start: { x: event.clientX, y: event.clientY }, moved: false };
          }} onPointerMove={event => {
            const previous = drag.current; if (!previous || previous.pointer !== event.pointerId) return;
            const position = point(event.clientX, event.clientY); if (!position) return;
            previous.moved ||= Math.hypot(event.clientX - previous.start.x, event.clientY - previous.start.y) > 3;
            if (previous.node && previous.moved) {
              previous.point = { x: Math.max(0, Math.round(position.x - previous.offset.x)), y: Math.max(0, Math.round(position.y - previous.offset.y)) };
              setMoving({ id: previous.node.id, point: previous.point });
            }
            else if (!previous.node) {
              setView(view => ({ ...view, offsetX: view.offsetX + event.clientX - previous.start.x, offsetY: view.offsetY + event.clientY - previous.start.y }));
              previous.start = { x: event.clientX, y: event.clientY };
            }
          }} onPointerUp={() => {
            // 高频触控的 move/up 可以落在同一帧，提交手势事实而非尚未渲染的 React 状态。
            if (drag.current?.node && drag.current.point) state.place(drag.current.node, drag.current.point);
            drag.current = null; setMoving(null);
          }} onPointerCancel={() => { drag.current = null; setMoving(null); }} onLostPointerCapture={() => { drag.current = null; setMoving(null); }}>
          <div ref={canvasHost} className={styles.canvas} />
          {palette ? <div className={styles.selection}>{title("node" in palette ? palette.node : palette.template)}
            <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => setPalette(null)}>×</button></div> : null}
        </div>
      </div>
      {layout.preparation.placementIssues.map((issue, index) => <p key={index} role="alert" className={styles.error}>
        {[...new Set(layout.placements.filter(entry => issue.nodeIds.includes(entry.referenceNode.id)).map(entry => title(entry.referenceNode)))].join("、")} · {" "}
        {t(`eda.manual.issue.${issue.kind}`).replace("{count}", String(issue.kind === "excess" ? issue.excessCount : issue.nodeIds.length))}</p>)}
      {invalidPositions.length ? <p role="alert" className={styles.error}>{t("eda.manual.collision")}</p> : null}
      {state.error || renderError ? <p role="alert" className={styles.error}>{state.error ?? renderError}
        <button type="button" onClick={() => { void state.prepare(requestRef.current); }}>{t("eda.manual.retry")}</button></p> : null}
    </> : null}
  </section>;
});
