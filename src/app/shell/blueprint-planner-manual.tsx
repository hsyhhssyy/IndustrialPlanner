import { manualDeviceItemIds } from "@/shared/planner-manual-presentation";
// AI-REMOVED 2026-11-12:
// Reason: 人工布局不再独立实现相机、拖动、键盘和历史。
// Trigger: REQ-048 统一交互画布。
// Evidence: 原组件维护第二套 moving/view/drag 状态并调用专用 preview API。
// Replacement: CanvasPanel、CanvasInteractionController 与 EditableSceneSession。
// Risk: 需验证三种 Screen Profile、触控与键盘焦点。
// Human Review: Required
// Original code:
// import { BlueprintPlannerManualPalette, type ManualPaletteSelection as PaletteSelection } from "./blueprint-planner-manual-palette";
// import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
// import { isPlannerManualDeviceSupported } from "@/shared/planner-manual-devices";
// import plannerStyles from "./blueprint-planner-dialog.module.scss";
// import { matchManualPlacements } from "@/shared/planner-manual-binding";
// import { useEffect, useMemo, useRef, useState } from "react";
// import { observer } from "mobx-react-lite";
// import type { BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createBlueprintDocument } from "@/domain/document/blueprint-document";
// import type { BlueprintPreviewHandle, BlueprintPreviewScene, BlueprintPreviewViewport } from "@/domain/renderer";
// import type { GridPoint } from "@/domain/shared/grid";
// import { resolveEntityGridRect } from "@/shared/geometry/power-range";
//
// import type { AppHost } from "../host";
// import styles from "./blueprint-planner-manual.module.scss";
//
//
//
// export const BlueprintPlannerManual = observer(function BlueprintPlannerManual({ appHost, request, disabled }: {
//   appHost: AppHost; request: BlueprintPlannerRequest; disabled: boolean;
// }) {
//   const state = appHost.blueprintPlannerDialog.manual, layout = state.layout;
//   const renderer = appHost.workspace.render, registry = appHost.workspace.registry, t = appHost.actions.translate;
//   const stage = useRef<HTMLDivElement>(null), canvasHost = useRef<HTMLDivElement>(null), handle = useRef<BlueprintPreviewHandle | null>(null);
//   const dimensions = useRef({ width: 0, height: 0 });
//   const [ready, setReady] = useState(false), [renderError, setRenderError] = useState<string | null>(null);
//   const [palette, setPalette] = useState<PaletteSelection | null>(null);
//   const [view, setView] = useState<BlueprintPreviewViewport>({ zoom: 1, offsetX: 0, offsetY: 0 });
//   const [moving, setMoving] = useState<{ id: string; point: GridPoint } | null>(null);
//   const drag = useRef<{ pointer: number; node: BlueprintPlannerManualNode | null; offset: GridPoint; start: GridPoint; moved: boolean; point?: GridPoint } | null>(null);
//   const requestRef = useRef(request); requestRef.current = request;
//   const prepareKey = JSON.stringify([request.plan, request.options, layout?.enabled, layout?.mode, layout?.facilities, layout?.placements]);
//   useEffect(() => { void state.prepare(requestRef.current); }, [state, prepareKey]);
//   const invalidPositions = useMemo(() => layout ? state.invalidPositions(registry) : [], [state, registry, layout]);
//   const unsupported = useMemo(() => layout?.placements.filter(entry => !isPlannerManualDeviceSupported(entry.referenceNode.definitionId))
//     .map(entry => entry.referenceNode.id) ?? [], [layout]);
//   const invalid = useMemo(() => [...new Set([...unsupported, ...invalidPositions,
//     ...layout?.preparation.placementIssues.flatMap(issue => issue.nodeIds) ?? []])], [unsupported, invalidPositions, layout]);
//   const assignments = useMemo(() => layout ? matchManualPlacements(layout.preparation.nodes, layout.placements, layout.mode).assignments
//     : new Map<string, BlueprintPlannerManualNode>(), [layout]);
//   const scene = useMemo<BlueprintPreviewScene>(() => {
//     const placements = layout?.placements ?? [];
//     const entities = placements.map(entry => ({ id: entry.referenceNode.id, definitionId: entry.referenceNode.definitionId,
//       position: moving?.id === entry.referenceNode.id ? moving.point : entry.position,
//       rotation: entry.rotation, config: {}, tags: [] }));
//     const references = new Map([...assignments].map(([reference, node]) => [node.id, reference]));
//     return { blueprint: createBlueprintDocument({ blueprintId: "manual-layout", name: request.plan.name, baseId: request.plan.sourceBaseId,
//       initialGridPoint: { x: 0, y: 0 }, entityOrder: entities.map(entity => entity.id), entities: Object.fromEntries(entities.map(entity => [entity.id, entity])), slotLinks: [] }),
//     overlay: { selectedEntityIds: state.selectedId ? [state.selectedId] : [], invalidEntityIds: invalid,
//       productionItemIds: Object.fromEntries(placements.map(({ referenceNode }) => [referenceNode.id,
//         (assignments.get(referenceNode.id) ?? referenceNode).outputs.map(flow => flow.itemId)])),
//       links: layout?.preparation.connections.filter(edge => references.has(edge.sourceNodeId) && references.has(edge.targetNodeId))
//         .map(edge => ({ sourceEntityId: references.get(edge.sourceNodeId)!, targetEntityId: references.get(edge.targetNodeId)!, binding: layout.mode === "topology" })) ?? [] } };
//     // 布局快照与选择决定场景；纯计算进度不会重建画布。
//   }, [layout, moving, state.selectedId, request.plan.name, request.plan.sourceBaseId, invalid, assignments]);
//   const sceneRef = useRef(scene); sceneRef.current = scene;
//   const viewRef = useRef(view); viewRef.current = view;
//   useEffect(() => {
//     const element = stage.current;
//     if (!element || !layout?.enabled) return;
//     const measure = () => {
//       const bounds = element.getBoundingClientRect();
//       dimensions.current = { width: Math.max(0, Math.floor(bounds.width)), height: Math.max(0, Math.floor(bounds.height)) };
//       setReady(dimensions.current.width > 0 && dimensions.current.height > 0);
//       if (renderer && handle.current) renderer.actions.resizeBlueprintPreview(handle.current, dimensions.current.width, dimensions.current.height);
//     };
//     const observer = new ResizeObserver(measure); measure(); observer.observe(element);
//     return () => observer.disconnect();
//   }, [renderer, layout?.enabled]);
//   useEffect(() => {
//     const element = canvasHost.current;
//     if (!renderer || !ready || !element || !layout?.enabled) return;
//     let alive = true, mounted: BlueprintPreviewHandle | null = null;
//     void renderer.actions.mountBlueprintPreview({ blueprint: sceneRef.current.blueprint, ...dimensions.current,
//       viewportBounds: { left: 0, top: 0, width: 30, height: 20 }, viewport: viewRef.current }).then(value => {
//       if (!alive) { renderer.actions.disposeBlueprintPreview(value); return; }
//       mounted = value; handle.current = value;
//       const canvas = renderer.queries.getBlueprintPreviewCanvas(value);
//       if (canvas) { canvas.ariaHidden = "true"; canvas.style.touchAction = "none"; element.replaceChildren(canvas); }
//       renderer.actions.updateBlueprintPreviewScene(value, sceneRef.current);
//       renderer.actions.resizeBlueprintPreview(value, dimensions.current.width, dimensions.current.height);
//     }).catch(error => { if (alive) setRenderError(error instanceof Error ? error.message : String(error)); });
//     return () => { alive = false; handle.current = null; element.replaceChildren(); if (mounted) renderer.actions.disposeBlueprintPreview(mounted); };
//   }, [renderer, ready, layout?.enabled]);
//   useEffect(() => { if (renderer && handle.current) renderer.actions.updateBlueprintPreviewScene(handle.current, scene); }, [renderer, scene]);
//   useEffect(() => { if (renderer && handle.current) renderer.actions.updateBlueprintPreviewViewport(handle.current, view); }, [renderer, view]);
//   const point = (clientX: number, clientY: number) => {
//     const rect = stage.current?.getBoundingClientRect();
//     return rect && renderer && handle.current ? renderer.queries.blueprintPreviewScreenToGrid(handle.current,
//       { x: clientX - rect.left, y: clientY - rect.top }) : null;
//   };
//   const drop = (selection: PaletteSelection, position: GridPoint) => {
//     if (disabled || state.loading) return;
//     if ("node" in selection) { state.place(selection.node, position); setPalette(null); }
//     else state.addFacility(selection.template, position);
//   };
//   const title = (node: { definitionId: string }) => t(registry.queries.findEntityDefinition(node.definitionId)?.nameKey ?? node.definitionId);
//   const selected = layout?.placements.find(entry => entry.referenceNode.id === state.selectedId);
//   return <section className={styles.manual} aria-label={t("eda.wizard.manual")}>
//     <div className={styles.heading}>
//       <label className={plannerStyles.parallel}><span>{t("eda.wizard.manualPreset")}</span><input type="checkbox" role="switch"
//         checked={layout?.enabled ?? false} disabled={disabled} onChange={event => state.setEnabled(event.target.checked)} /></label>
//       {layout?.enabled ? <BlueprintPlannerChoice label={t("eda.manual.binding")} value={layout.mode} disabled={disabled || state.loading}
//         choices={(["device", "recipe", "topology"] as const).map(value => ({ value, label: t(`eda.manual.${value}`) }))}
//         onChange={mode => { setPalette(null); state.setMode(mode); }} /> : null}
//     </div>
//     {layout?.enabled ? <>
//       <div className={styles.toolbar}>
//         <span>{t("eda.manual.placed").replace("{count}", String(layout.placements.length))}</span>
//         <button type="button" disabled={disabled || !selected || state.loading} onClick={state.rotate}>{t("eda.manual.rotate")}</button>
//         <button type="button" disabled={disabled || !selected || state.loading} onClick={state.remove}>{t("eda.manual.remove")}</button>
//         <button type="button" disabled={disabled || !state.canUndo} onClick={state.undo}>{t("eda.manual.undo")}</button>
//         <button type="button" aria-label={t("eda.previewZoomOut")} onClick={() => setView(view => ({ ...view, zoom: Math.max(.2, view.zoom / 1.3) }))}>−</button>
//         <button type="button" onClick={() => setView({ zoom: 1, offsetX: 0, offsetY: 0 })}>{t("eda.manual.resetView")}</button>
//         <button type="button" aria-label={t("eda.previewZoomIn")} onClick={() => setView(view => ({ ...view, zoom: Math.min(6, view.zoom * 1.3) }))}>+</button>
//         {state.loading ? <span role="status">{t("eda.manual.preparing")}</span> : null}
//       </div>
//       <div className={styles.editor}>
//         <BlueprintPlannerManualPalette layout={layout} registry={registry} selection={palette}
//           disabled={disabled || state.loading} onSelect={setPalette} t={t} />
//
//         <div ref={stage} className={styles.stage} tabIndex={0} role="application" aria-label={t("eda.manual.canvas")}
//           onKeyDown={event => {
//             // 画布快捷键只作用于人工布局，避免 Escape 继续关闭整个向导。
//             event.stopPropagation();
//             if (disabled || state.loading) return;
//             if (event.key.toLowerCase() === "r") { event.preventDefault(); state.rotate(); }
//             if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); state.remove(); }
//             if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); state.undo(); }
//             if (event.key === "Escape") { setPalette(null); state.select(null); }
//           }}
//           onDragOver={event => event.preventDefault()} onDrop={event => {
//             event.preventDefault(); const position = point(event.clientX, event.clientY);
//             if (palette && position) drop(palette, position);
//           }}
//           onPointerDown={event => {
//             if (event.button !== 0 || disabled || state.loading) return;
//             event.currentTarget.focus();
//             const position = point(event.clientX, event.clientY);
//             if (!position) return;
//             if (palette) { drop(palette, position); return; }
//             const hit = [...layout.placements].reverse().find(entry => {
//               const definition = registry.queries.findEntityDefinition(entry.referenceNode.definitionId);
//               if (!definition) return false;
//               const rect = resolveEntityGridRect({ entity: { ...entry, id: entry.referenceNode.id, definitionId: entry.referenceNode.definitionId, config: {}, tags: [] }, definition });
//               return position.x >= rect.x && position.y >= rect.y && position.x < rect.x + rect.width && position.y < rect.y + rect.height;
//             });
//             state.select(hit?.referenceNode.id ?? null); event.currentTarget.setPointerCapture(event.pointerId);
//             drag.current = { pointer: event.pointerId, node: hit?.referenceNode ?? null,
//               offset: hit ? { x: position.x - hit.position.x, y: position.y - hit.position.y } : { x: 0, y: 0 },
//               start: { x: event.clientX, y: event.clientY }, moved: false };
//           }} onPointerMove={event => {
//             const previous = drag.current; if (!previous || previous.pointer !== event.pointerId) return;
//             const position = point(event.clientX, event.clientY); if (!position) return;
//             previous.moved ||= Math.hypot(event.clientX - previous.start.x, event.clientY - previous.start.y) > 3;
//             if (previous.node && previous.moved) {
//               previous.point = { x: Math.max(0, Math.round(position.x - previous.offset.x)), y: Math.max(0, Math.round(position.y - previous.offset.y)) };
//               setMoving({ id: previous.node.id, point: previous.point });
//             }
//             else if (!previous.node) {
//               setView(view => ({ ...view, offsetX: view.offsetX + event.clientX - previous.start.x, offsetY: view.offsetY + event.clientY - previous.start.y }));
//               previous.start = { x: event.clientX, y: event.clientY };
//             }
//           }} onPointerUp={() => {
//             // 高频触控的 move/up 可以落在同一帧，提交手势事实而非尚未渲染的 React 状态。
//             if (drag.current?.node && drag.current.point) state.place(drag.current.node, drag.current.point);
//             drag.current = null; setMoving(null);
//           }} onPointerCancel={() => { drag.current = null; setMoving(null); }} onLostPointerCapture={() => { drag.current = null; setMoving(null); }}>
//           <div ref={canvasHost} className={styles.canvas} />
//           {palette ? <div className={styles.selection}>{title("node" in palette ? palette.node : palette.template)}
//             <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => setPalette(null)}>×</button></div> : null}
//         </div>
//       </div>
//       {layout.preparation.placementIssues.map((issue, index) => <p key={index} role="alert" className={styles.error}>
//         {[...new Set(layout.placements.filter(entry => issue.nodeIds.includes(entry.referenceNode.id)).map(entry => title(entry.referenceNode)))].join("、")} · {" "}
//         {t(`eda.manual.issue.${issue.kind}`).replace("{count}", String(issue.kind === "excess" ? issue.excessCount : issue.nodeIds.length))}</p>)}
//       {unsupported.length ? <p role="alert" className={styles.error}>{t("eda.manual.unsupported")}</p> : null}
//       {invalidPositions.length ? <p role="alert" className={styles.error}>{t("eda.manual.collision")}</p> : null}
//       {state.error || renderError ? <p role="alert" className={styles.error}>{state.error ?? renderError}
//         <button type="button" onClick={() => { void state.prepare(requestRef.current); }}>{t("eda.manual.retry")}</button></p> : null}
//     </> : null}
//   </section>;
// });
//
// // AI-REMOVED 2026-11-11:
// // Reason: 物品与设备图标移交设备列表组件。
// // Trigger: 用户确认按绑定方式折叠设备并显示图标和数量。
// // Evidence: 原列表逐节点渲染，不按可互换范围计数。
// // Replacement: blueprint-planner-manual-palette.tsx
// // Risk: Low。Human Review: Required
// // Original code:
// // import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
//
// // AI-REMOVED 2026-11-11:
// // Reason: 选择对象随设备列表组件归属。
// // Trigger: 用户确认按绑定方式折叠设备并显示图标和数量。
// // Evidence: 原列表逐节点渲染，不按可互换范围计数。
// // Replacement: ManualPaletteSelection
// // Risk: Low。Human Review: Required
// // Original code:
// // type PaletteSelection = { node: BlueprintPlannerManualNode } | { template: BlueprintPlannerManualFacilityTemplate };
//
// // AI-REMOVED 2026-11-11:
// // Reason: 配方名称、物品图标与待摆数量统一由设备列表计算。
// // Trigger: 用户确认按绑定方式折叠设备并显示图标和数量。
// // Evidence: 原列表逐节点渲染，不按可互换范围计数。
// // Replacement: blueprint-planner-manual-palette.tsx
// // Risk: Low。Human Review: Required
// // Original code:
// //   const recipeTitle = (id: string) => {
// //     const recipe = registry.queries.findRecipeDefinition(id);
// //     if (!recipe) return id;
// //     const translated = t(recipe.nameKey);
// //     if (translated !== recipe.nameKey) return translated;
// //     // 部分配方不提供独立译名，按实际输入和输出区分同设备的不同用途。
// //     const names = (flows: typeof recipe.inputs) => flows.map(flow => t(registry.queries.findItemDefinition(flow.itemId)?.nameKey ?? flow.itemId)).join(" + ");
// //     return `${names(recipe.inputs)} → ${(recipe.powerOutput ?? 0) > 0 ? `${recipe.powerOutput} kW` : names(recipe.outputs)}`;
// //   };
// //   const placed = new Set([...assignments.values()].map(node => node.id));
// //   const nodes = layout?.preparation.nodes.filter(node => !placed.has(node.id)) ?? [];
// //   const icon = (node: BlueprintPlannerManualNode) => {
// //     const item = node.outputs[0]?.itemId, definition = item && registry.queries.findItemDefinition(item);
// //     return item ? <img alt="" src={createItemIconAssetUrl(definition ? definition.iconId : item)} /> : null;
// //   };
//
// // AI-REMOVED 2026-11-11:
// // Reason: 开关和三档绑定统一采用 Switch 与 Button Group。
// // Trigger: 用户确认按绑定方式折叠设备并显示图标和数量。
// // Evidence: 原列表逐节点渲染，不按可互换范围计数。
// // Replacement: 本文件 heading
// // Risk: Low。Human Review: Required
// // Original code:
// //     <div className={styles.heading}><label><input type="checkbox" checked={layout?.enabled ?? false} disabled={disabled}
// //       onChange={event => state.setEnabled(event.target.checked)} />{t("eda.wizard.manualPreset")}</label>
// //       {layout?.enabled ? <select aria-label={t("eda.manual.binding")} value={layout.mode} disabled={disabled || state.loading}
// //         onChange={event => state.setMode(event.target.value as "device" | "recipe" | "topology")}>
// //         {["device", "recipe", "topology"].map(mode => <option key={mode} value={mode}>{t(`eda.manual.${mode}`)}</option>)}
// //       </select> : null}</div>
//
// // AI-REMOVED 2026-11-11:
// // Reason: 逐设备列表替换为设备族折叠与绑定分组卡片。
// // Trigger: 用户确认按绑定方式折叠设备并显示图标和数量。
// // Evidence: 原列表逐节点渲染，不按可互换范围计数。
// // Replacement: BlueprintPlannerManualPalette
// // Risk: Low。Human Review: Required
// // Original code:
// //         <aside className={styles.palette} aria-label={t("eda.manual.pending")}>
// //           <strong>{t("eda.manual.pending")} · {nodes.length}</strong>
// //           {nodes.map(node => <button key={node.id} type="button" draggable disabled={disabled || state.loading}
// //             aria-pressed={!!palette && "node" in palette && palette.node.id === node.id} onClick={() => setPalette({ node })}
// //             onDragStart={event => { setPalette({ node }); event.dataTransfer.setData("application/x-planner-device", node.id); }}>
// //             {icon(node)}<span>{title(node)}{node.recipeId ? <small>{recipeTitle(node.recipeId)}</small> : null}</span>
// //           </button>)}
// //           <strong>{t("eda.manual.facilities")}</strong>
// //           {layout.preparation.facilityTemplates.map(template => <button key={`${template.definitionId}/${template.recipeId}`} type="button" draggable
// //             disabled={disabled || state.loading} onClick={() => setPalette({ template })}
// //             aria-pressed={!!palette && "template" in palette && palette.template === template}
// //             onDragStart={event => { setPalette({ template }); event.dataTransfer.setData("application/x-planner-device", template.definitionId); }}>
// //             <span>＋ {title(template)}{template.recipeId ? <small>{recipeTitle(template.recipeId)}</small> : null}</span>
// //           </button>)}
// //         </aside>

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SceneOverlay } from "@/domain/document/scene-view-input";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { isPlannerManualDeviceSupported } from "@/shared/planner-manual-devices";
import { manualBindingKey, matchManualPlacements } from "@/shared/planner-manual-binding";
import { createEditableCanvasScene, type PlacementPaletteEntry } from "../canvas";
import type { AppHost } from "../host";
import { CanvasPanel, CanvasFloatingToolbar, CanvasRightDockToolbar, CanvasTopLeftCornerToolbar, OverlapEntityMenu } from "./canvas";
import { BlueprintPlannerManualPalette, groupManualPaletteNodes, visibleManualFacilityTemplates, type ManualPaletteSelection } from "./blueprint-planner-manual-palette";
import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
import plannerStyles from "./blueprint-planner-dialog.module.scss";
import styles from "./blueprint-planner-manual.module.scss";

export const BlueprintPlannerManual = observer(function BlueprintPlannerManual({ appHost, request, disabled }: {
  appHost: AppHost; request: BlueprintPlannerRequest; disabled: boolean;
}) {
  const state = appHost.blueprintPlannerDialog.manual, layout = state.layout;
  const registry = appHost.workspace.registry, planner = appHost.workspace.blueprintPlanner, t = appHost.actions.translate;
  const [owner, setOwner] = useState<ReturnType<typeof createEditableCanvasScene> | null>(null);
  const [selection, setSelection] = useState<ManualPaletteSelection | null>(null);
  const requestRef = useRef(request); requestRef.current = request;
  const prepareKey = planner?.queries.getManualPreparationKey({ ...request, manualLayout: layout }) ?? "";
  const enabled = layout?.enabled === true;
  const sessionEpoch = state.sessionEpoch;
  useEffect(() => { if (enabled) void state.prepare(requestRef.current); }, [state, enabled, prepareKey, sessionEpoch]);

  useEffect(() => {
    if (!enabled || planner === null) return;
    const session = state.ensureSession(requestRef.current);
    const readPalette = (): readonly PlacementPaletteEntry[] => {
      const current = state.layout;
      if (current === undefined) return [];
      return [
        ...[...groupManualPaletteNodes(current, registry)].map(([id, nodes]) => ({ id, definitionId: nodes[0]!.definitionId,
          availableCount: nodes.length, createRequest: (point: { x: number; y: number }) => state.reservePlacement({ node: nodes[0]! }, point) })),
        ...visibleManualFacilityTemplates(current, registry).map(template => ({ id: "facility:" + JSON.stringify([template.definitionId, template.recipeId]),
          definitionId: template.definitionId, availableCount: null,
          createRequest: (point: { x: number; y: number }) => state.reservePlacement({ template }, point) })),
      ];
    };
    const readOverlay = (): SceneOverlay | null => {
      const current = state.layout;
      if (current === undefined) return null;
      const assignments = matchManualPlacements(current.preparation.nodes, current.placements, current.mode).assignments;
      const references = new Map([...assignments].map(([reference, node]) => [node.id, reference]));
      return { selectedEntityIds: [...session.editor.state.collections.selection],
        invalidEntityIds: [...new Set([...state.invalidPositions(), ...current.preparation.placementIssues.flatMap(issue => issue.nodeIds),
          ...current.placements.filter(placement => !isPlannerManualDeviceSupported(placement.referenceNode.definitionId)).map(placement => placement.referenceNode.id)])],
        deviceItemIds: manualDeviceItemIds(current, registry),
        links: current.mode === "topology" ? current.preparation.connections.filter(edge => references.has(edge.sourceNodeId) && references.has(edge.targetNodeId))
          .map(edge => ({ sourceEntityId: references.get(edge.sourceNodeId)!, targetEntityId: references.get(edge.targetNodeId)!, binding: true })) : [],
      };
    };
    const next = createEditableCanvasScene({ appHost, session, readPalette, readOverlay,
      preparePlacement: () => state.prepare(requestRef.current) });
    setOwner(next);
    setSelection(null);
    return () => { next.dispose(); setOwner(current => current === next ? null : current); };
  }, [appHost, state, planner, registry, enabled, sessionEpoch]);

  const choose = (value: ManualPaletteSelection, pointerMode: "mouse" | "touch"): void => {
    if (owner === null || disabled || state.loading) return;
    setSelection(value);
    const definitionId = "node" in value ? value.node.definitionId : value.template.definitionId;
    owner.canvas.selectedPaletteEntryId = "node" in value ? manualBindingKey(value.node, layout!.mode)
      : "facility:" + JSON.stringify([value.template.definitionId, value.template.recipeId]);
    // 新的职责选择可以使用同一设备定义；先撤销旧虚影，再从统一单体入口保留新身份。
    owner.canvas.editor?.actions.cancelPlacementDraft();
    owner.canvas.actions.setActiveTool("select");
    const event = { uiButtonId: `ui-left-dock-placement-mode-${definitionId}-${pointerMode}-tap`,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    if (pointerMode === "mouse") owner.canvas.gestureAdapter.handleUiButtonMouseTap({ ...event, button: 0 });
    else owner.canvas.gestureAdapter.handleUiButtonTouchTap(event);
  };
  const selected = layout?.placements.find(placement => placement.referenceNode.id === state.selectedId);
  const title = (node: BlueprintPlannerManualNode): string => t(registry.queries.findEntityDefinition(node.definitionId)?.nameKey ?? node.definitionId);
  const toolbar = owner?.canvas.state.runtime.canvasFloatingToolbar;
  const compact = appHost.state.screenProfile.deviceClass !== "desktop";
  const paletteHidden = compact && owner?.canvas.state.placementPanelSuppressed === true;
  return <section className={styles.manual} aria-label={t("eda.wizard.manual")}>
    <div className={styles.heading}>
      <label className={plannerStyles.parallel}><span>{t("eda.wizard.manualPreset")}</span><input type="checkbox" role="switch"
        checked={enabled} disabled={disabled} onChange={event => state.setEnabled(event.target.checked)} /></label>
      {enabled ? <BlueprintPlannerChoice hideLabel label={t("eda.manual.binding")} value={layout!.mode} disabled={disabled || state.loading}
        choices={(["device", "recipe", "topology"] as const).map(value => ({ value, label: t(`eda.manual.${value}`) }))}
        onChange={mode => { owner?.canvas.editor?.actions.cancelPlacementDraft(); owner?.canvas.actions.setActiveTool("select"); setSelection(null); state.setMode(mode); }} /> : null}
    </div>
    {enabled && state.loading ? <span className={styles.preparing} role="status">{t("eda.manual.preparing")}</span> : null}
    {enabled && layout !== undefined ? <div className={styles.editor} data-palette-hidden={paletteHidden}>
      <BlueprintPlannerManualPalette layout={layout} registry={registry} selection={selection}
        disabled={disabled || state.loading} onSelect={choose} t={t} />
      <div className={styles.stage}>
        {owner === null ? null : <CanvasPanel appHost={appHost} canvas={owner.canvas} scene={owner.scene} scopedKeyboard ariaLabel={t("eda.manual.canvas")} onDrop={event => {
          event.preventDefault(); event.stopPropagation();
          if (selection === null || disabled || state.loading) return;
          const point = owner.canvas.view.queries.findGridCellForClientPixelPoint({ x: event.clientX, y: event.clientY });
          const definitionId = "node" in selection ? selection.node.definitionId : selection.template.definitionId;
          if (point === null || !owner.canvas.createPlacementDraft({ definitionId, centerGridPoint: point })) return;
          owner.canvas.editor?.actions.moveCollectionCenterPointTo(EntityCollectionType.preview, { x: event.clientX, y: event.clientY }, owner.canvas.view.state);
          owner.canvas.gestureAdapter.handleUiButtonTouchTap({ uiButtonId: "canvas-floating-toolbar-button-ok", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
        }} />}
        {selected ? <div className={styles.selection}>{title(selected.referenceNode)} · {selected.position.x}, {selected.position.y} · {selected.rotation}°</div> : null}
        {owner?.canvas.state.runtime.canvasRightDockToolbar.visible ? <CanvasRightDockToolbar canvas={owner.canvas}
          items={owner.canvas.state.runtime.canvasRightDockToolbar.items} /> : null}
        {owner?.canvas.state.runtime.canvasTopLeftCornerToolbar.visible ? <CanvasTopLeftCornerToolbar canvas={owner.canvas}
          buttonIds={owner.canvas.state.runtime.canvasTopLeftCornerToolbar.buttonIds}
          initialOffButtonIds={owner.canvas.state.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds} /> : null}
      </div>
    </div> : null}
    {owner !== null && toolbar?.visible && toolbar.anchor !== null ? <CanvasFloatingToolbar canvas={owner.canvas}
      buttonIds={toolbar.buttonIds} anchor={toolbar.anchor} /> : null}
    {owner === null ? null : <OverlapEntityMenu appHost={appHost} canvas={owner.canvas} />}
    {state.error === null ? null : <p role="alert" className={styles.error}>{state.error}</p>}
    {enabled && state.blocked() && !state.loading && state.error === null ? <p role="alert" className={styles.error}>{t("eda.wizard.manualReview")}</p> : null}
  </section>;
});

/* AI-REMOVED 2026-11-13:
Reason: 重复操作栏占用人工布局画布空间。
Trigger: 用户明确要求移除绑定按钮组下面的旧操作区。
Evidence: 共享画布已有原生操作工具栏与键盘命令。
Replacement: CanvasFloatingToolbar / CanvasRightDockToolbar / CanvasTopLeftCornerToolbar
Risk: Low；需要复核触屏确认、旋转、取消及键盘撤销。
Human Review: Required
Original code:
    <div className={styles.toolbar}>
      {enabled ? <span>{t("eda.manual.placed").replace("{count}", String(layout!.placements.length))}</span> : null}
      <button type="button" disabled={disabled || !state.canUndo} onClick={state.undo}>{t("eda.manual.undo")}</button>
      <button type="button" disabled={disabled || !state.canRedo} onClick={state.redo}>{t("action.redo")}</button>
      {enabled ? <>
        <button type="button" disabled={disabled || !selected} onClick={state.rotate}>{t("eda.manual.rotate")}</button>
        <button type="button" disabled={disabled || !selected} onClick={state.remove}>{t("eda.manual.remove")}</button>
        <button type="button" aria-label={t("eda.previewZoomOut")} onClick={() => owner?.canvas.view.actions.zoom(-1)}>−</button>
        <button type="button" onClick={() => owner?.canvas.view.actions.focusOnBounds({ x: 0, y: 0, width: 30, height: 20 }, { gridSize: 1, durationMs: 0 })}>{t("eda.manual.resetView")}</button>
        <button type="button" aria-label={t("eda.previewZoomIn")} onClick={() => owner?.canvas.view.actions.zoom(1)}>+</button>
        {state.loading ? <span role="status">{t("eda.manual.preparing")}</span> : null}
      </> : null}
    </div>
*/

// AI-REMOVED 2026-11-13:
// Reason: 编辑与方向预览统一职责标签投影。Trigger: 新步骤复用设备标签。
// Evidence: 两处重复构造物品集合。Replacement: shared/planner-manual-presentation.ts。
// Risk: Low。Human Review: Required。
// Original code:
//         deviceItemIds: Object.fromEntries(current.placements.map(({ referenceNode }) => {
//           const node = assignments.get(referenceNode.id) ?? referenceNode;
//           const items = node.recipeId ? registry.queries.findRecipeDefinition(node.recipeId)?.primaryOutputs ?? []
//             : (node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId);
//           return [referenceNode.id, [...new Set(items)]];
//         })),
