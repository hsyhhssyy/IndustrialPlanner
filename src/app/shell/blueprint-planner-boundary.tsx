import { BlueprintPlannerBoundaryPositionControls } from "./blueprint-planner-boundary-position";
import { manualDeviceItemIds } from "@/shared/planner-manual-presentation";
import { useEffect, useMemo, useRef } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerManualBoundarySide, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createWorldDocument } from "@/domain/document/world-document";
import type { SceneOverlay } from "@/domain/document/scene-view-input";
import type { GridRotation } from "@/domain/shared/grid";
import { isPlannerManualBoundaryDevice, manualBoundarySides } from "@/shared/planner-manual-devices";
import { matchManualPlacements } from "@/shared/planner-manual-binding";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { AppHost } from "../host";
import { useReadonlyCanvas } from "../canvas";
import { PlacementPaletteGroup, PlacementPaletteRow } from "./shared";
import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
import styles from "./blueprint-planner-boundary.module.scss";

export const BlueprintPlannerBoundary = observer(function BlueprintPlannerBoundary({ appHost, request, disabled }: {
  appHost: AppHost; request: BlueprintPlannerRequest; disabled: boolean;
}) {
  const state = appHost.blueprintPlannerDialog.manual, layout = state.layout;
  const registry = appHost.workspace.registry, t = appHost.actions.translate;
  const container = useRef<HTMLDivElement>(null), currentRequest = useRef(request);
  currentRequest.current = request;
  const compatible = state.hasCurrentLayoutFormat;
  const preparationKey = compatible ? appHost.workspace.blueprintPlanner?.queries.getManualPreparationKey({ ...request, manualLayout: layout }) : undefined;
  useEffect(() => { if (compatible) void state.prepare(currentRequest.current); }, [state, compatible, preparationKey]);
  const document = useMemo(() => {
    const value = createWorldDocument({ baseId: request.plan.sourceBaseId });
    for (const placement of layout?.placements ?? []) {
      const id = placement.referenceNode.id;
      value.entityOrder.push(id);
      value.entities[id] = { id, definitionId: placement.referenceNode.definitionId, position: placement.position,
        rotation: placement.rotation, config: {}, tags: [] };
    }
    return value;
  }, [layout?.placements, request.plan.sourceBaseId]);
  const overlay: SceneOverlay = { selectedEntityIds: [], invalidEntityIds: [], links: [],
    deviceItemIds: layout && compatible ? manualDeviceItemIds(layout, registry) : {} };
  const preview = useReadonlyCanvas({ appHost, container, document, overlay,
    settings: { gameShowDeviceNames: appHost.state.settings.gameShowDeviceNames,
      gameShowDeviceIcons: appHost.state.settings.gameShowDeviceIcons, gameAlwaysShowGridLines: appHost.state.settings.gameAlwaysShowGridLines } });
  if (!layout) return null;
  if (!compatible) return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
    <p role="alert" className={styles.conflict}>{t("eda.manual.incompatibleFormat")}</p>
  </section>;
  const sides = manualBoundarySides(request.options.warehouseBus);
  const matched = matchManualPlacements(layout.preparation.nodes, layout.boundary.assignments, layout.mode).assignments;
  const assignments = new Map(layout.boundary.assignments.map(entry => [matched.get(entry.referenceNode.id)?.id ?? entry.referenceNode.id, entry]));
  const groups = new Map<string, BlueprintPlannerManualNode[]>();
  for (const node of layout.preparation.nodes) {
    const definition = registry.queries.findEntityDefinition(node.definitionId);
    if (!definition || !isPlannerManualBoundaryDevice(definition)) continue;
    const key = node.definitionId;
    groups.set(key, [...groups.get(key) ?? [], node]);
  }
  const invalid = layout.boundary.assignments.filter(entry => !matched.has(entry.referenceNode.id));
  const direction = layout.boundary.rotation;
  const sideIndex = (side: BlueprintPlannerManualBoundarySide) => (({ base: 2, left: 3, right: 1 })[side] + (direction ?? 0) / 90) % 4;
  const sideLabel = (side: BlueprintPlannerManualBoundarySide) => t(`eda.manual.side.${side}`)
    + (direction === null ? "" : ` (${t(`eda.manual.edge.${sideIndex(side)}`)})`);
  const nodeRow = (node: BlueprintPlannerManualNode) => {
    const definition = registry.queries.findEntityDefinition(node.definitionId)!;
    const assignment = assignments.get(node.id);
    const name = t(definition.nameKey);
    const items = layout.mode === "device" ? [] : [...new Set((node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId))];
    return <div key={node.id} className={styles.assignment} data-invalid={assignment && !sides.includes(assignment.side)}>
      <PlacementPaletteRow appearance="compact" interactive={false} label={name} iconSrc={createEntityIconAssetUrl(definition.iconPath)}
        products={items.map(id => ({ label: t(registry.queries.findItemDefinition(id)?.nameKey ?? id),
          src: createItemIconAssetUrl(registry.queries.findItemDefinition(id)?.iconId ?? id) }))}
      />
      <select aria-label={`${name} · ${t("eda.manual.side")}`} disabled={disabled || state.loading}
        value={assignment?.side ?? "auto"} onChange={event => state.setBoundarySide(node,
          event.target.value === "auto" ? null : event.target.value as BlueprintPlannerManualBoundarySide)}>
        <option value="auto">{t("eda.manual.auto")}</option>
        {sides.map(side => <option key={side} value={side}>{sideLabel(side)}</option>)}
        {assignment && !sides.includes(assignment.side) ? <option value={assignment.side} disabled>{sideLabel(assignment.side)}</option> : null}
      </select>
    </div>;
  };
  return <section className={styles.boundary} aria-label={t("eda.wizard.boundary")}>
    <div className={styles.controls}>
      {/* AI-REMOVED 2026-11-20:
          Reason: 形态只在前序布局配置，不能在边界步骤重复。
          Trigger: REQ-051 用户验收订正。Evidence: 向导职责。
          Replacement: 前序布局设置。Risk: Low。Human Review: Required
          Original code:
      <BlueprintPlannerChoice label={t("eda.warehouseBus")} value={request.options.warehouseBus} disabled={disabled}
        choices={(["straight", "corner", "u-shaped"] as const).map(value => ({ value,
          label: t(value === "straight" ? "eda.straight" : value === "corner" ? "eda.corner" : "eda.uShaped") }))}
        onChange={warehouseBus => appHost.blueprintPlannerDialog.updateOptions({ warehouseBus })} />
      */}
      {/* AI-REMOVED 2026-11-20: Reason: 整体朝向前置；Trigger: REQ-051。
          Evidence: 选项页先于存取口步骤；Replacement: BlueprintPlannerManualOptions。
          Risk: Low；Human Review: Required。Original code:
      <BlueprintPlannerChoice label={t("eda.manual.orientation")} value={layout.orientation} disabled={disabled}
        choices={[{ value: "free", label: t("eda.manual.orientation.free") }, { value: "fixed", label: t("eda.manual.orientation.fixed") }]}
        onChange={state.setOrientation} />
      */}
      <BlueprintPlannerChoice label={t("eda.manual.direction")} value={direction === null ? "auto" : String(direction)} disabled={disabled}
        choices={[{ value: "auto", label: t("eda.manual.auto") }, ...([0, 90, 180, 270] as const)
          .map(rotation => ({ value: String(rotation), label: t(`eda.manual.edge.${(2 + rotation / 90) % 4}`) }))]}
        onChange={value => state.setBoundaryRotation(value === "auto" ? null : Number(value) as GridRotation)} />
    </div>
    <BlueprintPlannerBoundaryPositionControls appHost={appHost} disabled={disabled || state.loading} />
    <div className={styles.content}>
      <div className={styles.ports} aria-label={t("eda.manual.side")}>
        <strong>{t("eda.manual.side")}</strong>
        {[...groups].map(([key, nodes]) => nodes.length === 1 ? nodeRow(nodes[0]!) : <PlacementPaletteGroup key={key}
          appearance="compact" label={t(registry.queries.findEntityDefinition(nodes[0]!.definitionId)!.nameKey)} count={nodes.length}
          iconSrc={createEntityIconAssetUrl(registry.queries.findEntityDefinition(nodes[0]!.definitionId)!.iconPath)}>{nodes.map(nodeRow)}</PlacementPaletteGroup>)}
        {invalid.map(entry => <div key={entry.referenceNode.id} className={styles.conflict} role="alert">
          <span>{t(registry.queries.findEntityDefinition(entry.referenceNode.definitionId)?.nameKey ?? entry.referenceNode.definitionId)}</span>
          <button type="button" disabled={disabled} onClick={() => state.removeBoundaryReference(entry.referenceNode.id)}>{t("eda.manual.remove")}</button>
        </div>)}
        {/* AI-REMOVED 2026-11-19:
            Reason: 朝向与所属边由用户直接重新选择，无需独立历史操作按钮。
            Trigger: 用户要求移除本步骤的撤销和重做。
            Evidence: 本步骤仅包含选择控件与只读预览。
            Replacement: 上方朝向、方向和所属边选择控件。
            Risk: Low；共享人工会话仍由原有状态管理。Human Review: Required
            Original code:
            <div className={styles.history}>
              <button type="button" disabled={disabled || !state.canUndo} onClick={state.undo}>{t("eda.manual.undo")}</button>
              <button type="button" disabled={disabled || !state.canRedo} onClick={state.redo}>{t("action.redo")}</button>
            </div>
        */}
      </div>
      <div className={styles.diagram} aria-label={t("eda.manual.direction")} data-automatic={direction === null}>
        <div ref={container} className={styles.preview} />
        {sides.map(side => <div key={side} className={styles.edge} data-edge={sideIndex(side)}><span>{sideLabel(side)}</span></div>)}
      </div>
    </div>
    {state.loading ? <span role="status">{t("eda.manual.preparing")}</span> : null}
    {state.error || preview.error ? <p role="alert">{state.error ?? preview.error}</p> : null}
    {/* AI-REMOVED 2026-11-20: Reason: 设备摆放在此步骤之后；Trigger: REQ-051 步骤前置。
        Evidence: 未摆设备不能阻断进入画布；Replacement: 最终人工布局步骤完整校验。
        Risk: Low；Human Review: Required。Original code:
    {state.blocked() && !state.loading && !state.error ? <p role="alert">{t("eda.wizard.manualReview")}</p> : null}
    */}
  </section>;
});

// AI-REMOVED 2026-11-13:
// Reason: 编辑与方向预览统一职责标签投影。Trigger: 新步骤复用设备标签。
// Evidence: 两处重复构造物品集合。Replacement: shared/planner-manual-presentation.ts。
// Risk: Low。Human Review: Required。
// Original code:
//     deviceItemIds: Object.fromEntries((layout?.placements ?? []).map(({ referenceNode: node }) => [node.id,
//       node.recipeId ? registry.queries.findRecipeDefinition(node.recipeId)?.primaryOutputs ?? []
//         : [...new Set((node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId))]])) };
