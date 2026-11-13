import type { BlueprintPlannerManualFacilityTemplate, BlueprintPlannerManualLayout, BlueprintPlannerManualNode } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { manualBindingKey, matchManualPlacements } from "@/shared/planner-manual-binding";
import { isPlannerManualDeviceSupported } from "@/shared/planner-manual-devices";
import { PlacementPaletteRow, PlacementPaletteGroup, type PlacementPaletteRowProps } from "./shared";
import styles from "./blueprint-planner-manual.module.scss";

export type ManualPaletteSelection = { node: BlueprintPlannerManualNode } | { template: BlueprintPlannerManualFacilityTemplate };

/** 数量与规划器使用相同的匹配身份；视觉折叠不能扩大可互换范围。 */
export function groupManualPaletteNodes(layout: BlueprintPlannerManualLayout): Map<string, BlueprintPlannerManualNode[]> {
  const consumed = new Set([...matchManualPlacements(layout.preparation.nodes, layout.placements, layout.mode).assignments.values()].map(node => node.id));
  const groups = new Map<string, BlueprintPlannerManualNode[]>();
  for (const node of layout.preparation.nodes) {
    if (consumed.has(node.id) || !isPlannerManualDeviceSupported(node.definitionId)) continue;
    const key = manualBindingKey(node, layout.mode);
    const group = groups.get(key);
    if (group) group.push(node); else groups.set(key, [node]);
  }
  return groups;
}

/** 仅筛选展示入口；既有额外设施及规划器资格规则不因面板隐藏而被删除。 */
export function visibleManualFacilityTemplates(layout: BlueprintPlannerManualLayout, registry: RegistryContract): BlueprintPlannerManualFacilityTemplate[] {
  const required = new Set(layout.preparation.nodes.flatMap(node => node.recipeId
    ? registry.queries.findRecipeDefinition(node.recipeId)?.requiredEnvironmentAnyOf ?? [] : []));
  return layout.preparation.facilityTemplates.filter(template => isPlannerManualDeviceSupported(template.definitionId)
    && (template.purpose !== "environment" || (template.recipeId !== null
      && required.has(registry.queries.findRecipeDefinition(template.recipeId)?.environmentOutput?.itemId ?? ""))));
}

export function BlueprintPlannerManualPalette({ layout, registry, selection, disabled, onSelect, t }: {
  layout: BlueprintPlannerManualLayout; registry: RegistryContract; selection: ManualPaletteSelection | null;
  disabled: boolean; onSelect: (selection: ManualPaletteSelection, pointerMode: "mouse" | "touch") => void; t: (key: string) => string;
}) {
  const groups = groupManualPaletteNodes(layout);
  const devices = new Map<string, BlueprintPlannerManualNode[][]>();
  for (const group of groups.values()) {
    const id = group[0]!.definitionId;
    devices.set(id, [...devices.get(id) ?? [], group]);
  }
  const templates = new Map<string, BlueprintPlannerManualFacilityTemplate[]>();
  for (const template of visibleManualFacilityTemplates(layout, registry)) {
    templates.set(template.definitionId, [...templates.get(template.definitionId) ?? [], template]);
  }
  const title = (id: string) => t(registry.queries.findEntityDefinition(id)?.nameKey ?? id);
  const icon = (id: string) => {
    const definition = registry.queries.findEntityDefinition(id);
    return definition ? createEntityIconAssetUrl(definition.iconPath) : undefined;
  };
  const products = (ids: readonly string[]) => layout.mode === "device" ? [] : [...new Set(ids)].map(id => ({
    label: t(registry.queries.findItemDefinition(id)?.nameKey ?? id),
    src: createItemIconAssetUrl(registry.queries.findItemDefinition(id)?.iconId ?? id),
  }));
  const placementProps = (value: ManualPaletteSelection, selected: boolean): PlacementPaletteRowProps["buttonProps"] => ({
    draggable: true, disabled, "aria-pressed": selected,
    onClick: event => { if (event.detail === 0) onSelect(value, "mouse"); },
    onPointerUp: event => { if (event.button === 0) onSelect(value, event.pointerType === "mouse" ? "mouse" : "touch"); },
    onDragStart: event => {
      event.stopPropagation(); onSelect(value, "mouse");
      event.dataTransfer.setData("application/x-planner-device", "node" in value ? value.node.id : value.template.definitionId);
    },
  });
  const nodeCard = (group: BlueprintPlannerManualNode[]) => {
    const node = group[0]!;
    const ordinal = layout.preparation.nodes.filter(entry => entry.definitionId === node.definitionId).findIndex(entry => entry.id === node.id) + 1;
    const selected = !!selection && "node" in selection && group.some(entry => entry.id === selection.node.id);
    return <PlacementPaletteRow key={manualBindingKey(node, layout.mode)} appearance="compact" label={title(node.definitionId)}
      iconSrc={icon(node.definitionId)} count={group.length} products={products(group.flatMap(entry => entry.outputs.map(flow => flow.itemId)))}
      badge={layout.mode === "topology" ? t("eda.manual.node").replace("{number}", String(ordinal)) : undefined}
      buttonProps={placementProps({ node }, selected)} />;
  };
  const templateCard = (template: BlueprintPlannerManualFacilityTemplate) => {
    const recipe = template.recipeId ? registry.queries.findRecipeDefinition(template.recipeId) : null;
    return <PlacementPaletteRow key={`${template.definitionId}/${template.recipeId}`} appearance="compact" label={title(template.definitionId)}
      iconSrc={icon(template.definitionId)} products={products(recipe?.environmentOutput ? [recipe.environmentOutput.itemId] : recipe?.outputs.map(flow => flow.itemId) ?? [])}
      buttonProps={placementProps({ template }, !!selection && "template" in selection
        && selection.template.definitionId === template.definitionId && selection.template.recipeId === template.recipeId)} />;
  };
  return <aside className={styles.palette} aria-label={t("eda.manual.pending")}>
    <strong>{t("eda.manual.pending")} · {[...groups.values()].reduce((count, nodes) => count + nodes.length, 0)}</strong>
    {[...devices].map(([id, variants]) => variants.length === 1 ? nodeCard(variants[0]!)
      : <PlacementPaletteGroup key={id} appearance="compact" label={title(id)} iconSrc={icon(id)}
        count={variants.reduce((count, nodes) => count + nodes.length, 0)} buttonProps={{ disabled }}>
        {variants.map(nodeCard)}
      </PlacementPaletteGroup>)}
    {templates.size ? <strong>{t("eda.manual.facilities")}</strong> : null}
    {[...templates].map(([id, variants]) => variants.length === 1 ? templateCard(variants[0]!)
      : <PlacementPaletteGroup key={id} appearance="compact" label={title(id)} iconSrc={icon(id)} buttonProps={{ disabled }}>
        {variants.map(templateCard)}
      </PlacementPaletteGroup>)}
  </aside>;
}

// AI-REMOVED 2026-11-13:
// Reason: 人工摆放卡片的图标、计数和折叠布局改为共用放置条目组件。
// Trigger: 用户要求单行按钮、外置数量圆标、按绑定模式展示，以及隐藏无关环境。
// Evidence: 主放置面板已有独立展开动作；旧卡片的尾部数量与箭头挤占同一区域。
// Replacement: PlacementPaletteRow / PlacementPaletteGroup 与上方模式投影。
// Risk: 保留分组身份与原生放置事件；需验证触屏、键盘和拖放。Human Review: Required
// Original code:
// export function BlueprintPlannerManualPalette({ layout, registry, selection, disabled, onSelect, t }: {
//   layout: BlueprintPlannerManualLayout; registry: RegistryContract; selection: ManualPaletteSelection | null;
//   disabled: boolean; onSelect: (selection: ManualPaletteSelection, pointerMode: "mouse" | "touch") => void; t: (key: string) => string;
// }) {
//   const groups = groupManualPaletteNodes(layout);
//   const devices = new Map<string, BlueprintPlannerManualNode[][]>();
//   for (const group of groups.values()) {
//     const id = group[0]!.definitionId;
//     const device = devices.get(id);
//     if (device) device.push(group); else devices.set(id, [group]);
//   }
//   const templates = new Map<string, BlueprintPlannerManualFacilityTemplate[]>();
//   for (const template of layout.preparation.facilityTemplates) {
//     if (!isPlannerManualDeviceSupported(template.definitionId)) continue;
//     const variants = templates.get(template.definitionId);
//     if (variants) variants.push(template); else templates.set(template.definitionId, [template]);
//   }
//   const title = (id: string) => t(registry.queries.findEntityDefinition(id)?.nameKey ?? id);
//   const itemName = (id: string) => t(registry.queries.findItemDefinition(id)?.nameKey ?? id);
//   const deviceIcon = (id: string) => {
//     const definition = registry.queries.findEntityDefinition(id);
//     return definition ? <img className={styles.deviceIcon} alt="" src={createEntityIconAssetUrl(definition.iconPath)} /> : null;
//   };
//   const itemIcons = (ids: readonly string[]) => <span className={styles.itemIcons}>{[...new Set(ids)].map(id =>
//     <img key={id} alt={itemName(id)} title={itemName(id)} src={createItemIconAssetUrl(registry.queries.findItemDefinition(id)?.iconId ?? id)} />)}</span>;
//   const recipeTitle = (id: string) => {
//     const recipe = registry.queries.findRecipeDefinition(id);
//     if (!recipe) return id;
//     const translated = t(recipe.nameKey);
//     if (translated !== recipe.nameKey) return translated;
//     // 部分配方不提供独立译名，按实际输入和输出区分同设备的不同用途。
//     const output = (recipe.powerOutput ?? 0) > 0 ? `${recipe.powerOutput} kW` : recipe.outputs.map(flow => itemName(flow.itemId)).join(" + ");
//     return `${recipe.inputs.map(flow => itemName(flow.itemId)).join(" + ")} → ${output}`;
//   };
//   const nodeCard = (group: BlueprintPlannerManualNode[]) => {
//     const node = group[0]!;
//     const ordinal = layout.preparation.nodes.filter(entry => entry.definitionId === node.definitionId).findIndex(entry => entry.id === node.id) + 1;
//     const selected = !!selection && "node" in selection && group.some(entry => entry.id === selection.node.id);
//     return <button key={manualBindingKey(node, layout.mode)} type="button" className={styles.deviceCard} draggable disabled={disabled}
//       aria-pressed={selected} onClick={event => { if (event.detail === 0) onSelect({ node }, "mouse"); }}
//       onPointerUp={event => { if (event.button === 0) onSelect({ node }, event.pointerType === "mouse" ? "mouse" : "touch"); }}
//       onDragStart={event => { event.stopPropagation(); onSelect({ node }, "mouse"); event.dataTransfer.setData("application/x-planner-device", node.id); }}>
//       {deviceIcon(node.definitionId)}
//       <span className={styles.deviceText}>{title(node.definitionId)}{layout.mode === "topology" ? ` · ${ordinal}` : ""}
//         {node.recipeId && layout.mode !== "device" ? <small>{recipeTitle(node.recipeId)}</small> : null}
//         {itemIcons(group.flatMap(entry => (entry.outputs.length ? entry.outputs : entry.inputs).map(flow => flow.itemId)))}
//       </span><span className={styles.count}>×{group.length}</span>
//     </button>;
//   };
//   const templateCard = (template: BlueprintPlannerManualFacilityTemplate) => {
//     const recipe = template.recipeId ? registry.queries.findRecipeDefinition(template.recipeId) : null;
//     return <button key={`${template.definitionId}/${template.recipeId}`} type="button" className={styles.deviceCard} draggable disabled={disabled}
//       aria-pressed={!!selection && "template" in selection && selection.template.definitionId === template.definitionId && selection.template.recipeId === template.recipeId}
//       onClick={event => { if (event.detail === 0) onSelect({ template }, "mouse"); }}
//       onPointerUp={event => { if (event.button === 0) onSelect({ template }, event.pointerType === "mouse" ? "mouse" : "touch"); }}
//       onDragStart={event => { event.stopPropagation(); onSelect({ template }, "mouse"); event.dataTransfer.setData("application/x-planner-device", template.definitionId); }}>
//       {deviceIcon(template.definitionId)}<span className={styles.deviceText}>{recipe?.environmentOutput ? itemName(recipe.environmentOutput.itemId) : title(template.definitionId)}
//         {template.recipeId ? <small>{recipeTitle(template.recipeId)}</small> : null}
//         {recipe?.environmentOutput ? itemIcons([recipe.environmentOutput.itemId]) : null}
//       </span><span className={styles.count} title={t("eda.manual.unlimited")}>∞</span>
//     </button>;
//   };
//   return <aside className={styles.palette} aria-label={t("eda.manual.pending")}>
//     <strong>{t("eda.manual.pending")} · {[...groups.values()].reduce((count, nodes) => count + nodes.length, 0)}</strong>
//     {[...devices].map(([id, variants]) => variants.length === 1 ? nodeCard(variants[0]!) : <details key={id} className={styles.deviceGroup}>
//       <summary>{deviceIcon(id)}<span>{title(id)}</span><span className={styles.count}>×{variants.reduce((count, nodes) => count + nodes.length, 0)}</span></summary>
//       <div>{variants.map(nodeCard)}</div>
//     </details>)}
//     <strong>{t("eda.manual.facilities")}</strong>
//     {[...templates].map(([id, variants]) => variants.length === 1 ? templateCard(variants[0]!) : <details key={id} className={styles.deviceGroup}>
//       <summary>{deviceIcon(id)}<span>{title(id)}</span><span className={styles.count} title={t("eda.manual.unlimited")}>∞</span></summary>
//       <div>{variants.map(templateCard)}</div>
//     </details>)}
//   </aside>;
// }
