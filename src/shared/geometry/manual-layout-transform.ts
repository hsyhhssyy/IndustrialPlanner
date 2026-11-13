import type { BlueprintPlannerManualPlacement, BlueprintPlannerManualTransform } from "@/domain/blueprint-planner";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridPoint, GridRotation } from "@/domain/shared/grid";
import { resolveEntityGridRect } from "./power-range";

/** 屏幕坐标系顺时针旋转格点，实体锚点需另外处理占地宽高。 */
export function rotateManualPoint(point: GridPoint, rotation: GridRotation): GridPoint {
  if (rotation === 90) return { x: -point.y, y: point.x };
  if (rotation === 180) return { x: -point.x, y: -point.y };
  if (rotation === 270) return { x: point.y, y: -point.x };
  return { ...point };
}

export function transformManualPlacement(placement: BlueprintPlannerManualPlacement, definition: EntityDefinition,
  transform: BlueprintPlannerManualTransform): BlueprintPlannerManualPlacement {
  const rect = resolveEntityGridRect({ definition, entity: { ...placement,
    id: placement.referenceNode.id, definitionId: definition.id, config: {}, tags: [] } });
  const corners = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]
    .map(point => rotateManualPoint(point, transform.rotation));
  const position = { x: Math.min(...corners.map(point => point.x)) + transform.translation.x,
    y: Math.min(...corners.map(point => point.y)) + transform.translation.y };
  if (!Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y)) throw new Error("人工布局变换超出安全坐标范围。");
  return { ...placement, position, rotation: ((placement.rotation + transform.rotation) % 360) as GridRotation };
}
