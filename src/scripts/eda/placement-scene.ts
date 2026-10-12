import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation";
import type { GridRectSize } from "@/domain/shared/grid";
import { createWorldDocument } from "@/domain/document/world-document";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";

/** 模板几何验收保留源地图及区域身份，临时面积只存在于独立的 Registry 副本。 */
export function createPlannerPlacementRegistry(registry: RegistryContract, baseId: string, placeableArea: GridRectSize): RegistryContract {
  const sourceBase = registry.baseDefinitions.find(base => base.id === baseId);
  if (sourceBase === undefined) throw new Error(`Unknown planner placement base: ${baseId}`);
  const outerRing = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    ...registry,
    baseDefinitions: registry.baseDefinitions.map(base => base.id !== baseId ? base : {
      ...sourceBase,
      placeableArea: { ...placeableArea },
      outerRing,
      builtinEntities: [],
      // 2026-10-12：每个真实区域在临时几何中均可容纳模板；实际落位仍由 Editor 按真实地图检查。
      subAreas: sourceBase.subAreas?.map(area => ({
        ...area, position: { x: 0, y: 0 }, placeableArea: { ...placeableArea }, outerRing,
      })),
    }),
  };
}

/** 施工验收包含用户需补齐的外部存取线；整体平移只适配验证地图，不修改交付或搜索坐标。 */
// AI-CORRECTION 2026-10-12: 验证地图沿用交付蓝图的真实地图 ID，临时几何由 createPlannerPlacementRegistry 提供。
export function createPlannerPlacementScene(registry: RegistryContract, execution: SimulationBlueprintRunRequest) {
  const blueprint = execution.blueprint;
  const entries = [...blueprint.entityOrder.map(id => blueprint.entities[id]!), ...execution.scene.externalEntities
    .filter(entity => entity.definitionId === "log_hongs_bus" || entity.definitionId === "log_hongs_bus_source")];
  const rects = entries.map(entity => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
  const x = Math.min(0, ...rects.map(rect => rect.x)), y = Math.min(0, ...rects.map(rect => rect.y));
  const entities = entries.map(entity => ({ ...entity, position: { x: entity.position.x - x, y: entity.position.y - y } }));
  const document = createWorldDocument({ baseId: blueprint.baseId });
  document.entities = Object.fromEntries(entities.map(entity => [entity.id, entity]));
  document.entityOrder = entities.map(entity => entity.id);
  document.slotLinks = blueprint.slotLinks;
  return document;
}
