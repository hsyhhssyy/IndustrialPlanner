import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerManualBoundarySide, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { isPlannerManualBoundaryDevice, manualBoundarySides, manualBusEdge } from "@/shared/planner-manual-devices";
import { matchManualPlacements } from "@/shared/planner-manual-binding";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { AppHost } from "../host";
import { InteractiveTooltip } from "./shared";
import styles from "./blueprint-planner-boundary.module.scss";

export const BlueprintPlannerBoundary = observer(function BlueprintPlannerBoundary({ appHost, request, disabled }: {
  appHost: AppHost; request: BlueprintPlannerRequest; disabled: boolean;
}) {
  const state = appHost.blueprintPlannerDialog.manual, layout = state.layout;
  const registry = appHost.workspace.registry, t = appHost.actions.translate;
  const currentRequest = useRef(request); currentRequest.current = request;
  const compatible = state.hasCurrentLayoutFormat;
  const preparationKey = compatible ? appHost.workspace.blueprintPlanner?.queries.getManualPreparationKey({ ...request, manualLayout: layout }) : undefined;
  useEffect(() => { if (compatible) void state.prepare(currentRequest.current); }, [state, compatible, preparationKey]);
  if (!layout) return null;
  if (!compatible) return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
    <p role="alert" className={styles.conflict}>{t("eda.manual.incompatibleFormat")}</p>
  </section>;
  const busy = disabled || state.loading, direction = layout.boundary.rotation;
  const free = layout.orientation === "free";
  const sides = manualBoundarySides(request.options.warehouseBus);
  const matched = matchManualPlacements(layout.preparation.nodes, layout.boundary.assignments, layout.mode).assignments;
  // 失效历史引用仅进入冲突提示，不得通过相同ID冒充当前节点的有效分配。
  const assignments = new Map(layout.boundary.assignments.flatMap(entry => {
    const node = matched.get(entry.referenceNode.id);
    return node ? [[node.id, entry] as const] : [];
  }));
  const nodes = layout.preparation.nodes.filter(node => {
    const definition = registry.queries.findEntityDefinition(node.definitionId);
    return definition && isPlannerManualBoundaryDevice(definition);
  });
  // AI-REMOVED 2026-11-21: Reason: 复用正式分段选择控件。Trigger: REQ-051选边。Evidence: BlueprintPlannerChoice已有键盘和响应式行为。
// Replacement: 上方BlueprintPlannerChoice。Risk: Low。Human Review: Required
// Original code:
//       <strong>{t("eda.manual.busEdges")}</strong>
//       {(["base", ...(request.options.warehouseBus === "corner" ? ["left"] : [])] as BlueprintPlannerManualBoundarySide[]).map(role => <div key={role} className={styles.busChoice}>
//         <span>{t(role === "base" ? "eda.manual.busBase" : "eda.manual.busBranch")}</span>
//         {(role === "left" ? ["left", "right"] : request.options.warehouseBus === "straight" ? ["bottom", "left", "top", "right"] : ["bottom", "top"]).map(value =>
//           <button key={value} type="button" data-bus-role={role} data-bus-edge={value} aria-pressed={edge(role) === value} disabled={busy}
//             onClick={() => state.setBusEdge(role, value as "top" | "right" | "bottom" | "left")}>{t(`eda.manual.busEdge.${value}`)}</button>)}
//       </div>)}
// AI-REMOVED 2026-11-21: Reason: 所属角色独立映射物理边。Trigger: REQ-051 存取线选边。
  // Evidence: 固定sideIndex无法表示顶边和右支段。Replacement: manualBusEdge。Risk: Low。Human Review: Required
  // Original code:
  // const sideIndex = (side: BlueprintPlannerManualBoundarySide) => (({ base: 2, left: 3, right: 1 })[side] + (diagramDirection ?? 0) / 90) % 4;
  // const sideLabel = (side: BlueprintPlannerManualBoundarySide) => t(`eda.manual.side.${side}`);
  const edge = (side: BlueprintPlannerManualBoundarySide) => manualBusEdge(request.options.warehouseBus, layout.boundary.busEdges, side);
  const sideIndex = (side: BlueprintPlannerManualBoundarySide) => ({ top: 0, right: 1, bottom: 2, left: 3 })[edge(side)];
  const sideLabel = (side: BlueprintPlannerManualBoundarySide) => t(`eda.manual.busEdge.${edge(side)}`);
  const title = (node: BlueprintPlannerManualNode) => t(registry.queries.findEntityDefinition(node.definitionId)?.nameKey ?? node.definitionId);
  const details = (node: BlueprintPlannerManualNode) => {
    const itemId = (node.outputs.length ? node.outputs : node.inputs)[0]?.itemId;
    return `${title(node)} #${nodes.indexOf(node) + 1}${itemId ? ` · ${t(registry.queries.findItemDefinition(itemId)?.nameKey ?? itemId)}` : ""} · ${assignments.has(node.id) ? sideLabel(assignments.get(node.id)!.side) : t("eda.manual.diagram.unassigned")}`;
  };
  const portIcon = (node: BlueprintPlannerManualNode) => {
    const definition = registry.queries.findEntityDefinition(node.definitionId)!;
    const itemId = (node.outputs.length ? node.outputs : node.inputs)[0]?.itemId;
    const item = itemId ? registry.queries.findItemDefinition(itemId) : undefined;
    return <InteractiveTooltip<HTMLSpanElement> key={node.id} text={`${details(node)}${assignments.has(node.id) && !sides.includes(assignments.get(node.id)!.side) ? ` · ${t("eda.manual.diagram.unavailable")}` : ""}`}>
      {trigger => <span {...trigger} tabIndex={0} className={styles.portChip} aria-label={details(node)}
        aria-invalid={assignments.has(node.id) && !sides.includes(assignments.get(node.id)!.side)} data-port-id={node.id} data-icon-kind={itemId ? "item" : "entity"}>
        <img src={itemId ? createItemIconAssetUrl(item?.iconId ?? itemId) : createEntityIconAssetUrl(definition.iconPath)} alt="" />
      </span>}
    </InteractiveTooltip>;
  };
  const unassigned = nodes.filter(node => !assignments.has(node.id) || !sides.includes(assignments.get(node.id)!.side));
  const invalid = layout.boundary.assignments.filter(entry => !matched.has(entry.referenceNode.id));
  return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
    {layout.orientation === "free" ? <p className={styles.explanation}>{t("eda.manual.diagram.free")}</p> : null}
    <div className={styles.busChoices}>
      {(["base", ...(request.options.warehouseBus === "corner" ? ["left"] : [])] as BlueprintPlannerManualBoundarySide[]).map(role => <div key={role} data-bus-role={role}>
        <BlueprintPlannerChoice label={t(request.options.warehouseBus === "straight" ? "eda.manual.busEdges" : role === "base" ? "eda.manual.busBase" : "eda.manual.busBranch")}
          value={edge(role)} disabled={busy} onChange={value => state.setBusEdge(role, value as "top" | "right" | "bottom" | "left")}
          choices={(role === "left" ? ["left", "right"] : request.options.warehouseBus === "straight" ? ["bottom", "left", "top", "right"] : ["bottom", "top"])
            .map(value => ({ value, label: t(`eda.manual.busEdge.${value}`) }))} />
      </div>)}
    </div>
    <div className={styles.assignmentPanel}>
      <div className={styles.portRows}>
        <strong className={styles.portHeading}>{t("eda.manual.side")}</strong>
        {nodes.map((node, index) => {
          const assignment = assignments.get(node.id);
          const itemIds = [...new Set((node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId))];
          const definition = registry.queries.findEntityDefinition(node.definitionId)!;
          const unavailable = assignment && !sides.includes(assignment.side);
          return <label key={node.id} className={styles.portRow} data-port-row={node.id}>
            <img src={createEntityIconAssetUrl(definition.iconPath)} alt="" />
            <span className={styles.portName}><strong>{title(node)} #{index + 1}</strong>
              {itemIds.length ? <span>{itemIds.map(id => t(registry.queries.findItemDefinition(id)?.nameKey ?? id)).join(" · ")}</span> : null}
              {unavailable ? <span role="alert" className={styles.conflict}>{t("eda.manual.diagram.unavailable")}</span> : null}
            </span>
            <select data-port-select={node.id} aria-label={`${title(node)} #${index + 1}${itemIds.length ? ` · ${itemIds.map(id => t(registry.queries.findItemDefinition(id)?.nameKey ?? id)).join(" · ")}` : ""} · ${t("eda.manual.side")}`}
              disabled={busy} value={assignment?.side ?? "auto"} aria-invalid={!!unavailable}
              onChange={event => state.setBoundarySide(node, event.currentTarget.value === "auto" ? null : event.currentTarget.value as BlueprintPlannerManualBoundarySide)}>
              <option value="auto">{t("eda.manual.auto")}</option>
              {sides.map(side => <option key={side} value={side}>{sideLabel(side)}</option>)}
              {unavailable ? <option value={assignment.side} disabled>{sideLabel(assignment.side)}</option> : null}
            </select>
          </label>;
        })}
      </div>
      <div className={styles.illustration}>
      <div className={styles.graph} role="group" aria-label={t("eda.manual.diagram.title")} data-direction={free ? "free" : direction ?? 0} data-shape={request.options.warehouseBus}>
        <svg viewBox="0 0 320 240" preserveAspectRatio="none" aria-hidden="true" className={styles.lines}>
          {sides.map(side => <path key={side} data-boundary-side={side} data-edge={sideIndex(side)}
            d={["M40 35H280", "M280 35V205", "M40 205H280", "M40 35V205"][sideIndex(side)]}
            className={side === "base" ? styles.baseLine : styles.sideLine} />)}
        </svg>
        {sides.map(side => <div key={side} className={styles.sideArea} data-edge={sideIndex(side)} data-side={side}>
          <span className={styles.edgeLabel} data-side={side}>{sideLabel(side)}</span>
          <div className={styles.edgePorts} data-port-side={side} role="group" aria-label={sideLabel(side)}>
            {nodes.filter(node => assignments.get(node.id)?.side === side).map(portIcon)}
          </div>
        </div>)}
      </div>
      {/* fixed旧null与显式0同为草稿下侧；free图仅示意固定布局，不读旧方向。 */}
      {unassigned.length ? <div className={styles.unassigned} aria-label={t("eda.manual.diagram.unassigned")}>
        <span>{t("eda.manual.auto")}</span>
        <div className={styles.portBand}>{unassigned.map(portIcon)}</div>
      </div> : null}
      </div>
      {invalid.map(entry => <div key={entry.referenceNode.id} className={styles.conflict} role="alert"><span>{title(entry.referenceNode)}</span>
        <button type="button" disabled={busy} onClick={() => state.removeBoundaryReference(entry.referenceNode.id)}>{t("eda.manual.remove")}</button></div>)}
    </div>
    {state.loading ? <span role="status">{t("eda.manual.preparing")}</span> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
  </section>;
});

// AI-REMOVED 2026-11-21:
// Reason: 用户恢复逐口原生所属边下拉，图仅只读美化，取消图上编辑。
// Trigger: 最新UI订正。Evidence: 下拉为唯一分配入口。
// Replacement: 上方默认展开逐口行与只读图。Risk: 需原生select三屏验证。Human Review: Required
// Original code:
// import { useEffect, useRef, useState } from "react";
// import { observer } from "mobx-react-lite";
// import type { BlueprintPlannerManualBoundarySide, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { GridRotation } from "@/domain/shared/grid";
// import { isPlannerManualBoundaryDevice, manualBoundarySides } from "@/shared/planner-manual-devices";
// import { matchManualPlacements } from "@/shared/planner-manual-binding";
// import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
// import type { AppHost } from "../host";
// import { InteractiveTooltip } from "./shared";
// import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
// import styles from "./blueprint-planner-boundary.module.scss";
//
// export const BlueprintPlannerBoundary = observer(function BlueprintPlannerBoundary({ appHost, request, disabled }: {
//   appHost: AppHost; request: BlueprintPlannerRequest; disabled: boolean;
// }) {
//   const state = appHost.blueprintPlannerDialog.manual, layout = state.layout;
//   const registry = appHost.workspace.registry, t = appHost.actions.translate;
//   const currentRequest = useRef(request); currentRequest.current = request;
//   const [selectedId, setSelectedId] = useState<string | null>(null);
//   const compatible = state.hasCurrentLayoutFormat;
//   const preparationKey = compatible ? appHost.workspace.blueprintPlanner?.queries.getManualPreparationKey({ ...request, manualLayout: layout }) : undefined;
//   useEffect(() => { if (compatible) void state.prepare(currentRequest.current); }, [state, compatible, preparationKey]);
//   if (!layout) return null;
//   if (!compatible) return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
//     <p role="alert" className={styles.conflict}>{t("eda.manual.incompatibleFormat")}</p>
//   </section>;
//   const busy = disabled || state.loading, direction = layout.boundary.rotation;
//   const sides = manualBoundarySides(request.options.warehouseBus);
//   const matched = matchManualPlacements(layout.preparation.nodes, layout.boundary.assignments, layout.mode).assignments;
//   // 失效历史引用仅进入冲突提示，不得通过相同ID冒充当前节点的有效分配。
//   const assignments = new Map(layout.boundary.assignments.flatMap(entry => {
//     const node = matched.get(entry.referenceNode.id);
//     return node ? [[node.id, entry] as const] : [];
//   }));
//   const nodes = layout.preparation.nodes.filter(node => {
//     const definition = registry.queries.findEntityDefinition(node.definitionId);
//     return definition && isPlannerManualBoundaryDevice(definition);
//   });
//   const selected = nodes.find(node => node.id === selectedId);
//   const sideIndex = (side: BlueprintPlannerManualBoundarySide) => (({ base: 2, left: 3, right: 1 })[side] + (direction ?? 0) / 90) % 4;
//   const sideLabel = (side: BlueprintPlannerManualBoundarySide) => t(`eda.manual.side.${side}`);
//   const title = (node: BlueprintPlannerManualNode) => t(registry.queries.findEntityDefinition(node.definitionId)?.nameKey ?? node.definitionId);
//   const details = (node: BlueprintPlannerManualNode) => {
//     const itemId = (node.outputs.length ? node.outputs : node.inputs)[0]?.itemId;
//     return `${title(node)} #${nodes.indexOf(node) + 1}${itemId ? ` · ${t(registry.queries.findItemDefinition(itemId)?.nameKey ?? itemId)}` : ""} · ${assignments.has(node.id) ? sideLabel(assignments.get(node.id)!.side) : t("eda.manual.diagram.unassigned")}`;
//   };
//   const portIcon = (node: BlueprintPlannerManualNode) => {
//     const definition = registry.queries.findEntityDefinition(node.definitionId)!;
//     const itemId = (node.outputs.length ? node.outputs : node.inputs)[0]?.itemId;
//     const item = itemId ? registry.queries.findItemDefinition(itemId) : undefined;
//     return <InteractiveTooltip<HTMLButtonElement> key={node.id} text={`${details(node)}${assignments.has(node.id) && !sides.includes(assignments.get(node.id)!.side) ? ` · ${t("eda.manual.diagram.unavailable")}` : ""}`}>
//       {trigger => <button {...trigger} type="button" className={styles.portChip} disabled={busy} aria-label={details(node)}
//         aria-pressed={selectedId === node.id} aria-invalid={assignments.has(node.id) && !sides.includes(assignments.get(node.id)!.side)} data-port-id={node.id} data-icon-kind={itemId ? "item" : "entity"}
//         onClick={event => { trigger.onClick(event); setSelectedId(node.id); }}>
//         <img src={itemId ? createItemIconAssetUrl(item?.iconId ?? itemId) : createEntityIconAssetUrl(definition.iconPath)} alt="" />
//       </button>}
//     </InteractiveTooltip>;
//   };
//   const unassigned = nodes.filter(node => !assignments.has(node.id) || !sides.includes(assignments.get(node.id)!.side));
//   const canRelease = selected !== undefined && assignments.has(selected.id);
//   const invalid = layout.boundary.assignments.filter(entry => !matched.has(entry.referenceNode.id));
//   return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
//     <BlueprintPlannerChoice label={t(layout.orientation === "free" ? "eda.manual.direction.relative" : "eda.manual.direction")} value={direction === null ? "auto" : String(direction)} disabled={busy}
//       disabledReason={appHost.blueprintPlannerDialog.taskLocked ? t("eda.manual.reasonTaskLocked") : t("eda.manual.reasonBusy")}
//       choices={[{ value: "auto", label: t("eda.manual.auto") }, ...([0, 90, 180, 270] as const)
//         .map(rotation => ({ value: String(rotation), label: t(`eda.manual.edge.${(2 + rotation / 90) % 4}`) }))]}
//       onChange={value => state.setBoundaryRotation(value === "auto" ? null : Number(value) as GridRotation)} />
//     {layout.orientation === "free" ? <p className={styles.explanation}>{t("eda.manual.diagram.free")}</p> : null}
//     <div className={styles.assignmentPanel}>
//       <div className={styles.graph} role="group" aria-label={t("eda.manual.diagram.title")} data-direction={direction ?? "auto"} data-shape={request.options.warehouseBus}>
//         <svg viewBox="0 0 320 240" preserveAspectRatio="none" aria-hidden="true" className={styles.lines}>
//           {sides.map(side => <g key={side}>
//             <path data-boundary-side={side} data-edge={sideIndex(side)}
//               d={["M40 35H280", "M280 35V205", "M40 205H280", "M40 35V205"][sideIndex(side)]}
//               className={side === "base" ? styles.baseLine : styles.sideLine} />
//             <path data-boundary-hit={side} data-active={!busy && !!selected} className={styles.edgeHit}
//               d={["M40 35H280", "M280 35V205", "M40 205H280", "M40 35V205"][sideIndex(side)]}
//               onClick={event => { event.stopPropagation(); if (!busy && selected) state.setBoundarySide(selected, side); }} />
//           </g>)}
//         </svg>
//         {sides.map(side => <div key={side} className={styles.sideArea} data-edge={sideIndex(side)} data-side={side}>
//           <button type="button" className={styles.edgeTarget} data-edge={sideIndex(side)} data-side={side} disabled={busy || !selected}
//             aria-label={`${t("eda.manual.diagram.assign")} · ${sideLabel(side)}`}
//             onClick={() => { if (selected) state.setBoundarySide(selected, side); }}>{sideLabel(side)}</button>
//           <div className={styles.edgePorts} data-port-side={side} role="group" aria-label={sideLabel(side)}>
//             {nodes.filter(node => assignments.get(node.id)?.side === side).map(portIcon)}
//           </div>
//         </div>)}
//       </div>
//       {direction === null ? <p className={styles.automatic}>{t("eda.manual.diagram.automaticCompact")}</p> : null}
//       {unassigned.length || canRelease ? <div className={styles.unassigned} aria-label={t("eda.manual.diagram.unassigned")}>
//         <span>{t("eda.manual.diagram.unassigned")}</span>
//         <div className={styles.portBand}>{unassigned.map(portIcon)}
//           {canRelease ? <button type="button" className={styles.release} disabled={busy} onClick={() => state.setBoundarySide(selected, null)}>
//             {t("eda.manual.diagram.release")}</button> : null}
//         </div>
//       </div> : null}
//       <p className={styles.selection} role="status">{selected ? details(selected) : t("eda.manual.diagram.selectPort")}</p>
//       {selected && assignments.has(selected.id) && !sides.includes(assignments.get(selected.id)!.side)
//         ? <p role="alert" className={styles.conflict}>{t("eda.manual.diagram.unavailable")}</p> : null}
//       {invalid.map(entry => <div key={entry.referenceNode.id} className={styles.conflict} role="alert"><span>{title(entry.referenceNode)}</span>
//         <button type="button" disabled={busy} onClick={() => state.removeBoundaryReference(entry.referenceNode.id)}>{t("eda.manual.remove")}</button></div>)}
//     </div>
//     {state.loading ? <span role="status">{t("eda.manual.preparing")}</span> : null}
//     {state.error ? <p role="alert">{state.error}</p> : null}
//   </section>;
// });

// AI-CORRECTION 2026-11-21：归档内批量替换产生的两处Map续行已完整注释，禁止组件外执行。

// AI-REMOVED 2026-11-21:
// Reason: 单图分配取消重复方向入口、模式切换、设备列表及select；每口使用圆形物品图标。
// Trigger: 用户UI美化要求。Evidence: 顶部方向组已经覆盖唯一方向操作。
// Replacement: 上方紧凑图、图标带和边分配按钮。Risk: 需重验原生交互。Human Review: Required
// Original code:
// import { useEffect, useRef, useState } from "react";
// import { observer } from "mobx-react-lite";
// import type { BlueprintPlannerManualBoundarySide, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { GridRotation } from "@/domain/shared/grid";
// import { isPlannerManualBoundaryDevice, manualBoundarySides } from "@/shared/planner-manual-devices";
// import { matchManualPlacements } from "@/shared/planner-manual-binding";
// import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
// import type { AppHost } from "../host";
// import { PlacementPaletteGroup, PlacementPaletteRow } from "./shared";
// import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
// import styles from "./blueprint-planner-boundary.module.scss";
//
// export const BlueprintPlannerBoundary = observer(function BlueprintPlannerBoundary({ appHost, request, disabled }: {
//   appHost: AppHost; request: BlueprintPlannerRequest; disabled: boolean;
// }) {
//   const state = appHost.blueprintPlannerDialog.manual, layout = state.layout;
//   const registry = appHost.workspace.registry, t = appHost.actions.translate;
//   const currentRequest = useRef(request); currentRequest.current = request;
//   const [selectedId, setSelectedId] = useState<string | null>(null);
//   const [assigning, setAssigning] = useState(false);
//   const compatible = state.hasCurrentLayoutFormat;
//   const preparationKey = compatible ? appHost.workspace.blueprintPlanner?.queries.getManualPreparationKey({ ...request, manualLayout: layout }) : undefined;
//   useEffect(() => { if (compatible) void state.prepare(currentRequest.current); }, [state, compatible, preparationKey]);
//   if (!layout) return null;
//   if (!compatible) return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
//     <p role="alert" className={styles.conflict}>{t("eda.manual.incompatibleFormat")}</p>
//   </section>;
//   const busy = disabled || state.loading;
//   const sides = manualBoundarySides(request.options.warehouseBus);
//   const matched = matchManualPlacements(layout.preparation.nodes, layout.boundary.assignments, layout.mode).assignments;
//   // 失效历史引用仅进入冲突提示，不得通过相同ID冒充当前节点的有效分配。
//   const assignments = new Map(layout.boundary.assignments.flatMap(entry => {
//     const node = matched.get(entry.referenceNode.id);
//     return node ? [[node.id, entry] as const] : [];
//   }));
//   const groups = new Map<string, BlueprintPlannerManualNode[]>();
//   for (const node of layout.preparation.nodes) {
//     const definition = registry.queries.findEntityDefinition(node.definitionId);
//     if (!definition || !isPlannerManualBoundaryDevice(definition)) continue;
//     groups.set(node.definitionId, [...groups.get(node.definitionId) ?? [], node]);
//   }
//   const nodes = [...groups.values()].flat();
//   const selected = nodes.find(node => node.id === selectedId);
//   const assigningPort = assigning && selected !== undefined;
//   const invalid = layout.boundary.assignments.filter(entry => !matched.has(entry.referenceNode.id));
//   const direction = layout.boundary.rotation;
//   const edgeLabel = (edge: number) => t(`eda.manual.edge.${edge}`);
//   // 0/90/180/270 对应屏幕下/左/上/右；图固定于屏幕，不旋转设备或画布。
//   // AI-CORRECTION 2026-11-21：下方四条SVG路径共享矩形角点，直角/U形连续相接。
//   const sideIndex = (side: BlueprintPlannerManualBoundarySide) => (({ base: 2, left: 3, right: 1 })[side] + (direction ?? 0) / 90) % 4;
//   const sideLabel = (side: BlueprintPlannerManualBoundarySide) => t(`eda.manual.side.${side}`)
//     + (direction === null ? "" : ` (${edgeLabel(sideIndex(side))})`);
//   const title = (node: BlueprintPlannerManualNode) => t(registry.queries.findEntityDefinition(node.definitionId)?.nameKey ?? node.definitionId);
//   const selectNode = (node: BlueprintPlannerManualNode) => { setSelectedId(node.id); setAssigning(true); };
//   const portIcon = (node: BlueprintPlannerManualNode) => {
//     const definition = registry.queries.findEntityDefinition(node.definitionId)!;
//     const itemId = (node.outputs.length ? node.outputs : node.inputs)[0]?.itemId;
//     const item = itemId ? registry.queries.findItemDefinition(itemId) : undefined;
//     return <button type="button" key={node.id} className={styles.portChip} disabled={busy}
//       aria-label={`${title(node)} #${nodes.indexOf(node) + 1} · ${assignments.get(node.id) ? sideLabel(assignments.get(node.id)!.side) : t("eda.manual.diagram.unassigned")}`}
//       aria-pressed={selectedId === node.id && assigning} onClick={() => selectNode(node)} data-port-id={node.id}>
//       <img src={createEntityIconAssetUrl(definition.iconPath)} alt={title(node)} />
//       {itemId ? <img className={styles.itemIcon} src={createItemIconAssetUrl(item?.iconId ?? itemId)} alt={t(item?.nameKey ?? itemId)} /> : null}
//       <span>#{nodes.indexOf(node) + 1} {title(node)}</span>
//     </button>;
//   };
//   const nodeRow = (node: BlueprintPlannerManualNode) => {
//     const definition = registry.queries.findEntityDefinition(node.definitionId)!;
//     const assignment = assignments.get(node.id), name = title(node);
//     const items = [...new Set((node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId))];
//     return <div key={node.id} className={styles.assignment} data-invalid={assignment && !sides.includes(assignment.side)}>
//       <button type="button" className={styles.selectPort} aria-label={`${name} #${nodes.indexOf(node) + 1}`} aria-pressed={selectedId === node.id && assigning} disabled={busy}
//         onClick={() => selectNode(node)}>
//         <PlacementPaletteRow appearance="compact" interactive={false} label={`${name} #${nodes.indexOf(node) + 1}`} iconSrc={createEntityIconAssetUrl(definition.iconPath)}
//           products={items.map(id => ({ label: t(registry.queries.findItemDefinition(id)?.nameKey ?? id),
//             src: createItemIconAssetUrl(registry.queries.findItemDefinition(id)?.iconId ?? id) }))} />
//       </button>
//       <select aria-label={`${name} · ${t("eda.manual.side")}`} disabled={busy} value={assignment?.side ?? "auto"}
//         onChange={event => state.setBoundarySide(node, event.target.value === "auto" ? null : event.target.value as BlueprintPlannerManualBoundarySide)}>
//         <option value="auto">{t("eda.manual.auto")}</option>
//         {sides.map(side => <option key={side} value={side}>{sideLabel(side)}</option>)}
//         {assignment && !sides.includes(assignment.side) ? <option value={assignment.side} disabled>{sideLabel(assignment.side)}</option> : null}
//       </select>
//       {assignment && !sides.includes(assignment.side) ? <span className={styles.conflict}>{t("eda.manual.diagram.unavailable")}</span> : null}
//     </div>;
//   };
//   const unassigned = nodes.filter(node => !assignments.has(node.id));
//   return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
//     <BlueprintPlannerChoice label={t(layout.orientation === "free" ? "eda.manual.direction.relative" : "eda.manual.direction")} value={direction === null ? "auto" : String(direction)} disabled={busy}
//       disabledReason={appHost.blueprintPlannerDialog.taskLocked ? t("eda.manual.reasonTaskLocked") : t("eda.manual.reasonBusy")}
//       choices={[{ value: "auto", label: t("eda.manual.auto") }, ...([0, 90, 180, 270] as const)
//         .map(rotation => ({ value: String(rotation), label: edgeLabel((2 + rotation / 90) % 4) }))]}
//       onChange={value => state.setBoundaryRotation(value === "auto" ? null : Number(value) as GridRotation)} />
//     {layout.orientation === "free" ? <p className={styles.explanation}>{t("eda.manual.diagram.free")}</p> : null}
//     <div className={styles.content}>
//       <div className={styles.ports} aria-label={t("eda.manual.side")}>
//         <strong>{t("eda.manual.side")}</strong>
//         {[...groups].map(([key, entries]) => entries.length === 1 ? nodeRow(entries[0]!) : <PlacementPaletteGroup key={key}
//           appearance="compact" label={title(entries[0]!)} count={entries.length}
//           iconSrc={createEntityIconAssetUrl(registry.queries.findEntityDefinition(entries[0]!.definitionId)!.iconPath)}>{entries.map(nodeRow)}</PlacementPaletteGroup>)}
//         {invalid.map(entry => <div key={entry.referenceNode.id} className={styles.conflict} role="alert"><span>{title(entry.referenceNode)}</span>
//           <button type="button" disabled={busy} onClick={() => state.removeBoundaryReference(entry.referenceNode.id)}>{t("eda.manual.remove")}</button></div>)}
//       </div>
//       <div className={styles.interactive}>
//         <div className={styles.actions}>
//           <button type="button" disabled={busy} aria-pressed={!assigningPort} onClick={() => setAssigning(false)}>{t("eda.manual.diagram.direction")}</button>
//           {selected ? <button type="button" disabled={busy} aria-pressed={assigningPort} onClick={() => setAssigning(true)}>{t("eda.manual.diagram.assign")} · #{nodes.indexOf(selected) + 1} {title(selected)}</button> : null}
//           <button type="button" disabled={busy} onClick={() => assigningPort ? state.setBoundarySide(selected, null) : state.setBoundaryRotation(null)}>
//             {t(assigningPort ? "eda.manual.diagram.release" : "eda.manual.auto")}</button>
//         </div>
//         <div className={styles.graph} role="group" aria-label={t("eda.manual.diagram.title")} data-direction={direction ?? "auto"} data-shape={request.options.warehouseBus}>
//           <svg viewBox="0 0 320 240" preserveAspectRatio="none" aria-hidden="true" className={styles.lines}>
//             {sides.map(side => <path key={side} data-boundary-side={side} data-edge={sideIndex(side)}
//               d={["M40 35H280", "M280 35V205", "M40 205H280", "M40 35V205"][sideIndex(side)]}
//               className={side === "base" ? styles.baseLine : styles.sideLine} />)}
//           </svg>
//           {[0, 1, 2, 3].map(edge => {
//             const side = sides.find(value => sideIndex(value) === edge);
//             if (assigningPort && !side) return null;
//             return <button type="button" key={edge} className={styles.edgeTarget} data-edge={edge} data-side={side ?? ""} disabled={busy}
//               aria-label={assigningPort ? `${t("eda.manual.diagram.assign")} · ${title(selected)} · ${sideLabel(side!)}` : `${t("eda.manual.diagram.direction")} · ${edgeLabel(edge)}`}
//               onClick={() => assigningPort ? state.setBoundarySide(selected, side!) : state.setBoundaryRotation(((edge + 2) % 4 * 90) as GridRotation)}>
//               {side ? sideLabel(side) : edgeLabel(edge)}
//             </button>;
//           })}
//           <div className={styles.center}><strong>{t(assigningPort ? "eda.manual.diagram.chooseSide" : "eda.manual.diagram.chooseDirection")}</strong>
//             {direction === null ? <span>{t("eda.manual.diagram.automatic")}</span> : null}</div>
//           {sides.map(side => <div key={side} className={styles.edgePorts} data-edge={sideIndex(side)} data-port-side={side} role="group" aria-label={`${sideLabel(side)} · ${nodes.filter(node => assignments.get(node.id)?.side === side).length}`}>
//             {nodes.some(node => assignments.get(node.id)?.side === side) ? <span className={styles.portCount}>{nodes.filter(node => assignments.get(node.id)?.side === side).length}</span> : null}
//             {nodes.filter(node => assignments.get(node.id)?.side === side).map(portIcon)}
//           </div>)}
//         </div>
//         <div className={styles.unassigned}><strong>{t("eda.manual.diagram.unassigned")} · {unassigned.length}</strong>
//           <div>{unassigned.map(portIcon)}</div></div>
//       </div>
//     </div>
//     {state.loading ? <span role="status">{t("eda.manual.preparing")}</span> : null}
//     {state.error ? <p role="alert">{state.error}</p> : null}
//   </section>;
// });

// AI-REMOVED 2026-11-21:
// Reason: 第二步统一固定屏幕交互说明图，移除真实设备Canvas及双帧旋转暗示。
// Trigger: 用户要求图上直接选择方向与分配存取口。
// Evidence: 原useReadonlyCanvas挂载实体预览，relative双帧重复；均不属于本步编辑职责。
// Replacement: 上方单图与同源setBoundarySide/setBoundaryRotation。
// Risk: 交互入口变化，需三屏及历史验证。Human Review: Required
// Original code:
// import { BlueprintPlannerRelativeDirectionPreview } from "./blueprint-planner-relative-direction";
// import { BlueprintPlannerBoundaryPositionControls } from "./blueprint-planner-boundary-position";
// import { manualDeviceItemIds } from "@/shared/planner-manual-presentation";
// import { useEffect, useMemo, useRef } from "react";
// import { observer } from "mobx-react-lite";
// import type { BlueprintPlannerManualBoundarySide, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createWorldDocument } from "@/domain/document/world-document";
// import type { SceneOverlay } from "@/domain/document/scene-view-input";
// import type { GridRotation } from "@/domain/shared/grid";
// import { isPlannerManualBoundaryDevice, manualBoundarySides } from "@/shared/planner-manual-devices";
// import { matchManualPlacements } from "@/shared/planner-manual-binding";
// import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
// import type { AppHost } from "../host";
// import { useReadonlyCanvas } from "../canvas";
// import { PlacementPaletteGroup, PlacementPaletteRow } from "./shared";
// import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
// import styles from "./blueprint-planner-boundary.module.scss";
//
// export const BlueprintPlannerBoundary = observer(function BlueprintPlannerBoundary({ appHost, request, disabled }: {
//   appHost: AppHost; request: BlueprintPlannerRequest; disabled: boolean;
// }) {
//   const state = appHost.blueprintPlannerDialog.manual, layout = state.layout;
//   const registry = appHost.workspace.registry, t = appHost.actions.translate;
//   const container = useRef<HTMLDivElement>(null), currentRequest = useRef(request);
//   currentRequest.current = request;
//   const compatible = state.hasCurrentLayoutFormat;
//   const preparationKey = compatible ? appHost.workspace.blueprintPlanner?.queries.getManualPreparationKey({ ...request, manualLayout: layout }) : undefined;
//   useEffect(() => { if (compatible) void state.prepare(currentRequest.current); }, [state, compatible, preparationKey]);
//   const document = useMemo(() => {
//     const value = createWorldDocument({ baseId: request.plan.sourceBaseId });
//     for (const placement of layout?.placements ?? []) {
//       const id = placement.referenceNode.id;
//       value.entityOrder.push(id);
//       value.entities[id] = { id, definitionId: placement.referenceNode.definitionId, position: placement.position,
//         rotation: placement.rotation, config: {}, tags: [] };
//     }
//     return value;
//   }, [layout?.placements, request.plan.sourceBaseId]);
//   const overlay: SceneOverlay = { selectedEntityIds: [], invalidEntityIds: [], links: [],
//     deviceItemIds: layout && compatible ? manualDeviceItemIds(layout, registry) : {} };
//   const hasActualPreview = (layout?.placements.length ?? 0) > 0;
//   const preview = useReadonlyCanvas({ appHost, container, document, overlay, enabled: hasActualPreview,
//     settings: { gameShowDeviceNames: appHost.state.settings.gameShowDeviceNames,
//       gameShowDeviceIcons: appHost.state.settings.gameShowDeviceIcons, gameAlwaysShowGridLines: appHost.state.settings.gameAlwaysShowGridLines } });
//   if (!layout) return null;
//   if (!compatible) return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
//     <p role="alert" className={styles.conflict}>{t("eda.manual.incompatibleFormat")}</p>
//   </section>;
//   const sides = manualBoundarySides(request.options.warehouseBus);
//   const matched = matchManualPlacements(layout.preparation.nodes, layout.boundary.assignments, layout.mode).assignments;
//   // 失效历史引用仅进入冲突提示，不得通过相同ID冒充当前节点的有效分配。
//   const assignments = new Map(layout.boundary.assignments.flatMap(entry => {
//     const node = matched.get(entry.referenceNode.id);
//     return node ? [[node.id, entry] as const] : [];
//   }));
//   const groups = new Map<string, BlueprintPlannerManualNode[]>();
//   for (const node of layout.preparation.nodes) {
//     const definition = registry.queries.findEntityDefinition(node.definitionId);
//     if (!definition || !isPlannerManualBoundaryDevice(definition)) continue;
//     const key = node.definitionId;
//     groups.set(key, [...groups.get(key) ?? [], node]);
//   }
//   const invalid = layout.boundary.assignments.filter(entry => !matched.has(entry.referenceNode.id));
//   const direction = layout.boundary.rotation;
//   const relativeDirection = layout.orientation === "free";
//   const showDirectionDiagram = hasActualPreview || !relativeDirection && direction !== null;
//   const directionLabel = t(relativeDirection ? "eda.manual.direction.relative" : "eda.manual.direction");
//   const edgeLabel = (edge: number) => t(`eda.manual.${relativeDirection ? "relativeEdge" : "edge"}.${edge}`);
//   const sideIndex = (side: BlueprintPlannerManualBoundarySide) => (({ base: 2, left: 3, right: 1 })[side] + (direction ?? 0) / 90) % 4;
//   const sideLabel = (side: BlueprintPlannerManualBoundarySide) => t(`eda.manual.side.${side}`)
//     + (direction === null ? "" : ` (${edgeLabel(sideIndex(side))})`);
//   const nodeRow = (node: BlueprintPlannerManualNode) => {
//     const definition = registry.queries.findEntityDefinition(node.definitionId)!;
//     const assignment = assignments.get(node.id);
//     const name = t(definition.nameKey);
//     const items = layout.mode === "device" ? [] : [...new Set((node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId))];
//     return <div key={node.id} className={styles.assignment} data-invalid={assignment && !sides.includes(assignment.side)}>
//       <PlacementPaletteRow appearance="compact" interactive={false} label={`${name} #${nodes.indexOf(node) + 1}`} iconSrc={createEntityIconAssetUrl(definition.iconPath)}
//         products={items.map(id => ({ label: t(registry.queries.findItemDefinition(id)?.nameKey ?? id),
//           src: createItemIconAssetUrl(registry.queries.findItemDefinition(id)?.iconId ?? id) }))}
//       />
//       <select data-relative-direction={relativeDirection} aria-label={`${name} · ${t("eda.manual.side")}`} disabled={disabled || state.loading}
//         value={assignment?.side ?? "auto"} onChange={event => state.setBoundarySide(node,
//           event.target.value === "auto" ? null : event.target.value as BlueprintPlannerManualBoundarySide)}>
//         <option value="auto">{t("eda.manual.auto")}</option>
//         {sides.map(side => <option key={side} value={side}>{sideLabel(side)}</option>)}
//         {assignment && !sides.includes(assignment.side) ? <option value={assignment.side} disabled>{sideLabel(assignment.side)}</option> : null}
//       </select>
//     </div>;
//   };
//   return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
//     <div className={styles.controls}>
//       {/* AI-REMOVED 2026-11-20:
//           Reason: 形态只在前序布局配置，不能在边界步骤重复。
//           Trigger: REQ-051 用户验收订正。Evidence: 向导职责。
//           Replacement: 前序布局设置。Risk: Low。Human Review: Required
//           Original code:
//       <BlueprintPlannerChoice label={t("eda.warehouseBus")} value={request.options.warehouseBus} disabled={disabled}
//         choices={(["straight", "corner", "u-shaped"] as const).map(value => ({ value,
//           label: t(value === "straight" ? "eda.straight" : value === "corner" ? "eda.corner" : "eda.uShaped") }))}
//         onChange={warehouseBus => appHost.blueprintPlannerDialog.updateOptions({ warehouseBus })} />
//       */}
//       {/* AI-REMOVED 2026-11-20: Reason: 整体朝向前置；Trigger: REQ-051。
//           Evidence: 选项页先于存取口步骤；Replacement: BlueprintPlannerManualOptions。
//           Risk: Low；Human Review: Required。Original code:
//       <BlueprintPlannerChoice label={t("eda.manual.orientation")} value={layout.orientation} disabled={disabled}
//         choices={[{ value: "free", label: t("eda.manual.orientation.free") }, { value: "fixed", label: t("eda.manual.orientation.fixed") }]}
//         onChange={state.setOrientation} />
//       */}
//       <BlueprintPlannerChoice label={directionLabel} value={direction === null ? "auto" : String(direction)} disabled={disabled}
//         disabledReason={appHost.blueprintPlannerDialog.taskLocked ? t("eda.manual.reasonTaskLocked") : t("eda.manual.reasonBusy")}
//         choices={[{ value: "auto", label: t("eda.manual.auto") }, ...([0, 90, 180, 270] as const)
//           .map(rotation => ({ value: String(rotation), label: edgeLabel((2 + rotation / 90) % 4) }))]}
//         onChange={value => state.setBoundaryRotation(value === "auto" ? null : Number(value) as GridRotation)} />
//     </div>
//     {relativeDirection ? <BlueprintPlannerRelativeDirectionPreview direction={direction} translate={t} /> : null}
//     <BlueprintPlannerBoundaryPositionControls appHost={appHost} disabled={disabled || state.loading} />
//     <div className={styles.content} data-has-preview={showDirectionDiagram}>
//       <div className={styles.ports} aria-label={t("eda.manual.side")}>
//         <strong>{t("eda.manual.side")}</strong>
//         {[...groups].map(([key, nodes]) => nodes.length === 1 ? nodeRow(nodes[0]!) : <PlacementPaletteGroup key={key}
//           appearance="compact" label={t(registry.queries.findEntityDefinition(nodes[0]!.definitionId)!.nameKey)} count={nodes.length}
//           iconSrc={createEntityIconAssetUrl(registry.queries.findEntityDefinition(nodes[0]!.definitionId)!.iconPath)}>{nodes.map(nodeRow)}</PlacementPaletteGroup>)}
//         {invalid.map(entry => <div key={entry.referenceNode.id} className={styles.conflict} role="alert">
//           <span>{t(registry.queries.findEntityDefinition(entry.referenceNode.definitionId)?.nameKey ?? entry.referenceNode.definitionId)}</span>
//           <button type="button" disabled={disabled} onClick={() => state.removeBoundaryReference(entry.referenceNode.id)}>{t("eda.manual.remove")}</button>
//         </div>)}
//         {/* AI-REMOVED 2026-11-19:
//             Reason: 朝向与所属边由用户直接重新选择，无需独立历史操作按钮。
//             Trigger: 用户要求移除本步骤的撤销和重做。
//             Evidence: 本步骤仅包含选择控件与只读预览。
//             Replacement: 上方朝向、方向和所属边选择控件。
//             Risk: Low；共享人工会话仍由原有状态管理。Human Review: Required
//             Original code:
//             <div className={styles.history}>
//               <button type="button" disabled={disabled || !state.canUndo} onClick={state.undo}>{t("eda.manual.undo")}</button>
//               <button type="button" disabled={disabled || !state.canRedo} onClick={state.redo}>{t("action.redo")}</button>
//             </div>
//         */}
//       </div>
//       {showDirectionDiagram ? <div className={styles.diagram} aria-label={t(hasActualPreview ? "eda.manual.direction.actualLayout" : "eda.manual.direction.fixedExample")} data-automatic={direction === null}>
//         {hasActualPreview ? <div ref={container} className={styles.preview} /> : null}
//         {direction === null ? null : sides.map(side => <div key={side} className={styles.edge} data-edge={sideIndex(side)}><span>{sideLabel(side)}</span></div>)}
//       </div> : null}
//     </div>
//     {state.loading ? <span role="status">{t("eda.manual.preparing")}</span> : null}
//     {state.error || preview.error ? <p role="alert">{state.error ?? preview.error}</p> : null}
//     {/* AI-REMOVED 2026-11-20: Reason: 设备摆放在此步骤之后；Trigger: REQ-051 步骤前置。
//         Evidence: 未摆设备不能阻断进入画布；Replacement: 最终人工布局步骤完整校验。
//         Risk: Low；Human Review: Required。Original code:
//     {state.blocked() && !state.loading && !state.error ? <p role="alert">{t("eda.wizard.manualReview")}</p> : null}
//     */}
//   </section>;
// });
//
// // AI-REMOVED 2026-11-13:
// // Reason: 编辑与方向预览统一职责标签投影。Trigger: 新步骤复用设备标签。
// // Evidence: 两处重复构造物品集合。Replacement: shared/planner-manual-presentation.ts。
// // Risk: Low。Human Review: Required。
// // Original code:
// //     deviceItemIds: Object.fromEntries((layout?.placements ?? []).map(({ referenceNode: node }) => [node.id,
// //       node.recipeId ? registry.queries.findRecipeDefinition(node.recipeId)?.primaryOutputs ?? []
// //         : [...new Set((node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId))]])) };

// AI-REMOVED 2026-11-21:
// Reason: 双轴定位替代四向与旧侧边选项。
// Trigger: REQ-051 用户订正。
// Evidence: 画布手动旋转设备，X/Y独立定位。
// Replacement: 当前双轴控件。
// Risk: Low。
// Human Review: Required
// Original code:
//     {!free ? <BlueprintPlannerChoice label={t("eda.manual.direction.facing")} value={direction === null ? "auto" : String(direction)} disabled={busy}
//       disabledReason={appHost.blueprintPlannerDialog.taskLocked ? t("eda.manual.reasonTaskLocked") : t("eda.manual.reasonBusy")}
//       choices={[{ value: "auto", label: t("eda.manual.direction.draftDefault") }, ...([0, 90, 180, 270] as const)
//         .map(rotation => ({ value: String(rotation), label: t(`eda.manual.edge.${(2 + rotation / 90) % 4}`) }))]}
//       onChange={value => state.setBoundaryRotation(value === "auto" ? null : Number(value) as GridRotation)} /> : null}
