import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  PLACEMENT_BEHAVIOR_TYPE,
  type EntityPlacementBehaviorDeclaration,
} from "@/domain/registry/types/entity-placement-behavior";
import type { GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveGridEdgeDelta, rotateGridEdge, rotateLocalPortCell } from "@/shared/geometry/port";

type AutoRotateAlignPortsBehavior = Extract<
  EntityPlacementBehaviorDeclaration,
  { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.autoRotateAlignPorts }
>;

export function resolveAutoRotateAlignPortsBehavior(
  definition: EntityDefinition,
): AutoRotateAlignPortsBehavior | null {
  return definition.placementBehaviors.find(
    (behavior): behavior is AutoRotateAlignPortsBehavior =>
      behavior.type === PLACEMENT_BEHAVIOR_TYPE.autoRotateAlignPorts,
  ) ?? null;
}

export interface PortAlignmentContext {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly listedEntities: readonly WorldEntity[];
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}

/**
 * 找到最佳对齐旋转角度。
 * 遍历 0°/90°/180°/270°，对每个角度检查所有端口是否「空置或正确对接」，
 * 且至少有一个端口实际对接（不能全部空置）。
 * 返回旋转步数最少的有效角度；若所有角度都不满足，返回 null。
 */
export function findBestAlignedRotation(
  context: PortAlignmentContext,
): GridRotation | null {
  // 计算幽灵设备占据的格子，用于排除与其重叠的实体
  const ghostFootprint = getRotatedGridFootprint(
    context.definition.footprint,
    context.entity.rotation,
  );
  const ghostRect: GridRect = {
    x: context.entity.position.x,
    y: context.entity.position.y,
    width: ghostFootprint.width,
    height: ghostFootprint.height,
  };

  const candidates: GridRotation[] = [];

  for (const rotation of [0, 90, 180, 270] as const) {
    if (areAllPortsIdleOrConnected({ ...context, candidateRotation: rotation, ghostRect })) {
      candidates.push(rotation);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // 优先当前角度，其次按旋转步数从小到大
  if (candidates.includes(context.entity.rotation)) {
    return context.entity.rotation;
  }

  const steps = candidates.map((r) => ({
    rotation: r,
    steps: rotationSteps(context.entity.rotation, r),
  }));
  steps.sort((a, b) => a.steps - b.steps);
  return steps[0]?.rotation ?? null;
}

function areAllPortsIdleOrConnected(options: {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly listedEntities: readonly WorldEntity[];
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  readonly candidateRotation: GridRotation;
  readonly ghostRect: GridRect;
}): boolean {
  // 相邻格上的所有设备（允许一格有多个设备，如物流段和建筑重叠）
  let hasAnyConnection = false;

  for (const portGroup of options.definition.portGroups) {
    for (const port of portGroup.ports) {
      // 在 candidateRotation 下计算端口世界坐标与世界边方向
      const worldEdge = rotateGridEdge(port.edge, options.candidateRotation);
      const localCell = rotateLocalPortCell({
        footprint: options.definition.footprint,
        port,
        rotation: options.candidateRotation,
      });
      const portWorldCell: GridPoint = {
        x: options.entity.position.x + localCell.x,
        y: options.entity.position.y + localCell.y,
      };
      const delta = resolveGridEdgeDelta(worldEdge);
      const adjacentCell: GridPoint = {
        x: portWorldCell.x + delta.x,
        y: portWorldCell.y + delta.y,
      };

      // 收集相邻格上所有设备（排除与幽灵重叠的实体）
      const occupyingEntities = findEntitiesAtCell({
        listedEntities: options.listedEntities,
        entityDefinitionMap: options.entityDefinitionMap,
        cell: adjacentCell,
        excludeEntityId: options.entity.id,
        ghostRect: options.ghostRect,
      });

      if (occupyingEntities.length === 0) {
        // 空置 → 通过
        continue;
      }

      // 逐一检查该格上的每个设备
      let cellIsIdle = true;
      for (const occupyingEntity of occupyingEntities) {
        const matchResult = checkPortMatchAtCell({
          isPipe: portGroup.isPipe,
          portDirection: portGroup.direction,
          portWorldCell,
          worldEdge,
          neighborEntity: occupyingEntity.entity,
          neighborDefinition: occupyingEntity.definition,
        });

        if (matchResult === "incompatible") {
          // 该格上有设备有同种类端口但方向冲突 → 该角度无效
          return false;
        }

        if (matchResult === "compatible") {
          // 只要有一个设备的端口匹配即算对接
          hasAnyConnection = true;
          cellIsIdle = false;
        }
        // matchResult === "idle": 该设备没有同种类端口，继续检查下一个设备
      }

      if (cellIsIdle) {
        // 该格上所有设备都没有同种类端口 → 视为空置
        continue;
      }
    }
  }

  // 至少有一个端口实际对接，不能全部空置
  return hasAnyConnection;
}

interface OccupyingEntity {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
}

/**
 * 查找占据指定格子的所有实体。
 * 排除与幽灵设备格子重叠的实体（放置模式下物流设备可重叠物流段）。
 */
function findEntitiesAtCell(options: {
  readonly listedEntities: readonly WorldEntity[];
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  readonly cell: GridPoint;
  readonly excludeEntityId: string;
  readonly ghostRect: GridRect;
}): OccupyingEntity[] {
  const result: OccupyingEntity[] = [];

  for (const entity of options.listedEntities) {
    if (entity.id === options.excludeEntityId) {
      continue;
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    // 排除与幽灵格子重叠的实体（放置模式下物流设备可放在物流段上）
    if (doesEntityOverlapRect(entity, definition, options.ghostRect)) {
      continue;
    }

    if (isGridPointInsideRect(options.cell, resolveEntityGridRect(entity, definition))) {
      result.push({ entity, definition });
    }
  }

  return result;
}

type PortMatchResult = "compatible" | "idle" | "incompatible";

/**
 * 检查邻居设备在指定格子上的端口匹配情况。
 *
 * - "compatible": 该格有同种类端口，方向匹配
 * - "idle": 该格没有任何同种类端口，视为空置
 * - "incompatible": 该格有同种类端口但方向冲突
 */
function checkPortMatchAtCell(options: {
  readonly isPipe: boolean;
  readonly portDirection: "input" | "output" | "bidirectional";
  readonly portWorldCell: GridPoint;
  readonly worldEdge: ReturnType<typeof rotateGridEdge>;
  readonly neighborEntity: WorldEntity;
  readonly neighborDefinition: EntityDefinition;
}): PortMatchResult {
  const oppositeEdge = oppositeGridEdge(options.worldEdge);
  const expectedDirection = options.portDirection === "input" ? "output" : "input";
  const delta = resolveGridEdgeDelta(options.worldEdge);

  // 预期对方端口的世界坐标
  const expectedNeighborPortCell: GridPoint = {
    x: options.portWorldCell.x + delta.x,
    y: options.portWorldCell.y + delta.y,
  };

  let hasSameKindPortAtCell = false;
  let hasInputAtCell = false;
  let hasOutputAtCell = false;

  for (const neighborPortGroup of options.neighborDefinition.portGroups) {
    if (neighborPortGroup.isPipe !== options.isPipe) {
      continue;
    }

    for (const neighborPort of neighborPortGroup.ports) {
      const neighborWorldEdge = rotateGridEdge(
        neighborPort.edge,
        options.neighborEntity.rotation,
      );

      if (neighborWorldEdge !== oppositeEdge) {
        continue;
      }

      // 计算对方端口的世界坐标
      const neighborLocalCell = rotateLocalPortCell({
        footprint: options.neighborDefinition.footprint,
        port: neighborPort,
        rotation: options.neighborEntity.rotation,
      });
      const neighborPortWorldCell: GridPoint = {
        x: options.neighborEntity.position.x + neighborLocalCell.x,
        y: options.neighborEntity.position.y + neighborLocalCell.y,
      };

      // 只有世界坐标精确匹配才算位于该格
      if (
        neighborPortWorldCell.x !== expectedNeighborPortCell.x
        || neighborPortWorldCell.y !== expectedNeighborPortCell.y
      ) {
        continue;
      }

      hasSameKindPortAtCell = true;

      // 精确方向匹配
      if (neighborPortGroup.direction === expectedDirection) {
        return "compatible";
      }

      // 双向端口
      if (neighborPortGroup.direction === "bidirectional") {
        return "compatible";
      }

      // 记录该格子上有哪些方向（用于判断桥接器）
      if (neighborPortGroup.direction === "input") {
        hasInputAtCell = true;
      }
      if (neighborPortGroup.direction === "output") {
        hasOutputAtCell = true;
      }
    }
  }

  // 桥接器：同一格子同时有 input 和 output
  if (hasInputAtCell && hasOutputAtCell) {
    return "compatible";
  }

  // 该格有同种类端口但方向不匹配（如 output 对着 output）
  if (hasSameKindPortAtCell) {
    return "incompatible";
  }

  // 该格没有任何同种类端口 → 视为空置
  return "idle";
}

function oppositeGridEdge(
  edge: ReturnType<typeof rotateGridEdge>,
): ReturnType<typeof rotateGridEdge> {
  switch (edge) {
    case "NORTH":
      return "SOUTH";
    case "EAST":
      return "WEST";
    case "SOUTH":
      return "NORTH";
    case "WEST":
      return "EAST";
  }
}

function rotationSteps(from: GridRotation, to: GridRotation): number {
  const diff = ((to - from) % 360 + 360) % 360;
  return diff / 90;
}

function resolveEntityGridRect(
  entity: WorldEntity,
  definition: EntityDefinition,
): GridRect {
  const footprint = getRotatedGridFootprint(definition.footprint, entity.rotation);

  return {
    x: entity.position.x,
    y: entity.position.y,
    width: footprint.width,
    height: footprint.height,
  };
}

function isGridPointInsideRect(point: GridPoint, rect: GridRect): boolean {
  return (
    point.x >= rect.x
    && point.x < rect.x + rect.width
    && point.y >= rect.y
    && point.y < rect.y + rect.height
  );
}

function doesEntityOverlapRect(
  entity: WorldEntity,
  definition: EntityDefinition,
  rect: GridRect,
): boolean {
  const entityRect = resolveEntityGridRect(entity, definition);

  return !(
    entityRect.x + entityRect.width <= rect.x
    || rect.x + rect.width <= entityRect.x
    || entityRect.y + entityRect.height <= rect.y
    || rect.y + rect.height <= entityRect.y
  );
}
