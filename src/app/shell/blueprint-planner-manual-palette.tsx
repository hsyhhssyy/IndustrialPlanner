import type { BlueprintPlannerManualFacilityTemplate, BlueprintPlannerManualLayout, BlueprintPlannerManualNode } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createEntityIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { manualBindingKey, matchManualPlacements } from "@/shared/planner-manual-binding";
import { isPlannerManualDeviceSupported } from "@/shared/planner-manual-devices";
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

export function BlueprintPlannerManualPalette({ layout, registry, selection, disabled, onSelect, t }: {
  layout: BlueprintPlannerManualLayout; registry: RegistryContract; selection: ManualPaletteSelection | null;
  disabled: boolean; onSelect: (selection: ManualPaletteSelection) => void; t: (key: string) => string;
}) {
  const groups = groupManualPaletteNodes(layout);
  const devices = new Map<string, BlueprintPlannerManualNode[][]>();
  for (const group of groups.values()) {
    const id = group[0]!.definitionId;
    const device = devices.get(id);
    if (device) device.push(group); else devices.set(id, [group]);
  }
  const templates = new Map<string, BlueprintPlannerManualFacilityTemplate[]>();
  for (const template of layout.preparation.facilityTemplates) {
    if (!isPlannerManualDeviceSupported(template.definitionId)) continue;
    const variants = templates.get(template.definitionId);
    if (variants) variants.push(template); else templates.set(template.definitionId, [template]);
  }
  const title = (id: string) => t(registry.queries.findEntityDefinition(id)?.nameKey ?? id);
  const itemName = (id: string) => t(registry.queries.findItemDefinition(id)?.nameKey ?? id);
  const deviceIcon = (id: string) => {
    const definition = registry.queries.findEntityDefinition(id);
    return definition ? <img className={styles.deviceIcon} alt="" src={createEntityIconAssetUrl(definition.iconPath)} /> : null;
  };
  const itemIcons = (ids: readonly string[]) => <span className={styles.itemIcons}>{[...new Set(ids)].map(id =>
    <img key={id} alt={itemName(id)} title={itemName(id)} src={createItemIconAssetUrl(registry.queries.findItemDefinition(id)?.iconId ?? id)} />)}</span>;
  const recipeTitle = (id: string) => {
    const recipe = registry.queries.findRecipeDefinition(id);
    if (!recipe) return id;
    const translated = t(recipe.nameKey);
    if (translated !== recipe.nameKey) return translated;
    // 部分配方不提供独立译名，按实际输入和输出区分同设备的不同用途。
    const output = (recipe.powerOutput ?? 0) > 0 ? `${recipe.powerOutput} kW` : recipe.outputs.map(flow => itemName(flow.itemId)).join(" + ");
    return `${recipe.inputs.map(flow => itemName(flow.itemId)).join(" + ")} → ${output}`;
  };
  const nodeCard = (group: BlueprintPlannerManualNode[]) => {
    const node = group[0]!;
    const ordinal = layout.preparation.nodes.filter(entry => entry.definitionId === node.definitionId).findIndex(entry => entry.id === node.id) + 1;
    const selected = !!selection && "node" in selection && group.some(entry => entry.id === selection.node.id);
    return <button key={manualBindingKey(node, layout.mode)} type="button" className={styles.deviceCard} draggable disabled={disabled}
      aria-pressed={selected} onClick={() => onSelect({ node })}
      onDragStart={event => { onSelect({ node }); event.dataTransfer.setData("application/x-planner-device", node.id); }}>
      {deviceIcon(node.definitionId)}
      <span className={styles.deviceText}>{title(node.definitionId)}{layout.mode === "topology" ? ` · ${ordinal}` : ""}
        {node.recipeId && layout.mode !== "device" ? <small>{recipeTitle(node.recipeId)}</small> : null}
        {itemIcons(group.flatMap(entry => (entry.outputs.length ? entry.outputs : entry.inputs).map(flow => flow.itemId)))}
      </span><span className={styles.count}>×{group.length}</span>
    </button>;
  };
  const templateCard = (template: BlueprintPlannerManualFacilityTemplate) => {
    const recipe = template.recipeId ? registry.queries.findRecipeDefinition(template.recipeId) : null;
    return <button key={`${template.definitionId}/${template.recipeId}`} type="button" className={styles.deviceCard} draggable disabled={disabled}
      aria-pressed={!!selection && "template" in selection && selection.template.definitionId === template.definitionId && selection.template.recipeId === template.recipeId}
      onClick={() => onSelect({ template })}
      onDragStart={event => { onSelect({ template }); event.dataTransfer.setData("application/x-planner-device", template.definitionId); }}>
      {deviceIcon(template.definitionId)}<span className={styles.deviceText}>{recipe?.environmentOutput ? itemName(recipe.environmentOutput.itemId) : title(template.definitionId)}
        {template.recipeId ? <small>{recipeTitle(template.recipeId)}</small> : null}
        {recipe?.environmentOutput ? itemIcons([recipe.environmentOutput.itemId]) : null}
      </span><span className={styles.count} title={t("eda.manual.unlimited")}>∞</span>
    </button>;
  };
  return <aside className={styles.palette} aria-label={t("eda.manual.pending")}>
    <strong>{t("eda.manual.pending")} · {[...groups.values()].reduce((count, nodes) => count + nodes.length, 0)}</strong>
    {[...devices].map(([id, variants]) => variants.length === 1 ? nodeCard(variants[0]!) : <details key={id} className={styles.deviceGroup}>
      <summary>{deviceIcon(id)}<span>{title(id)}</span><span className={styles.count}>×{variants.reduce((count, nodes) => count + nodes.length, 0)}</span></summary>
      <div>{variants.map(nodeCard)}</div>
    </details>)}
    <strong>{t("eda.manual.facilities")}</strong>
    {[...templates].map(([id, variants]) => variants.length === 1 ? templateCard(variants[0]!) : <details key={id} className={styles.deviceGroup}>
      <summary>{deviceIcon(id)}<span>{title(id)}</span><span className={styles.count} title={t("eda.manual.unlimited")}>∞</span></summary>
      <div>{variants.map(templateCard)}</div>
    </details>)}
  </aside>;
}
