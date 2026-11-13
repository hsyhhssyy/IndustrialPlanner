// AI-REMOVED 2026-11-12: Reason: 资格由会话注入；Trigger: REQ-048；Evidence: EDA 空间与来源基地不同；Replacement: allowedAreaIds；Risk: Low；Human Review: Required
// import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import type { GridEdge, GridPoint, GridRectSize, GridRotation } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import type { SceneBounds, SceneSpace } from "@/domain/shared/scene-space";
import { isRectInSceneBounds, resolveSceneBoundarySegments, type SceneBoundarySegment } from "@/shared/geometry/scene-space";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
// AI-REMOVED 2026-11-12: Reason: 资格由会话注入；Trigger: REQ-048；Evidence: EDA 空间与来源基地不同；Replacement: allowedAreaIds；Risk: Low；Human Review: Required
// import { resolveEntityPlacementAreas } from "@/shared/entity-placement-whitelist";
import { rotateGridEdge } from "@/shared/geometry/port";

export type OuterRingEdgeSnapEdge = "top" | "right" | "bottom" | "left";

export interface OuterRingEdgeSnapResult {
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly edge: OuterRingEdgeSnapEdge;
  readonly distance: number;
}

export interface OuterRingEdgeSnappedPlacement {
  readonly position: GridPoint;
  readonly rotation: GridRotation;
}

const OUTER_RING_EDGE_SNAP_EDGES: readonly OuterRingEdgeSnapEdge[] = [
  "top",
  "right",
  "bottom",
  "left",
];
const OUTER_RING_CORNER_SWITCH_DISTANCE = 2;
const GRID_ROTATIONS: readonly GridRotation[] = [0, 90, 180, 270];
const EDGE_BY_OUTER_RING_SNAP_EDGE: Record<OuterRingEdgeSnapEdge, GridEdge> = {
  top: "NORTH",
  right: "EAST",
  bottom: "SOUTH",
  left: "WEST",
};
const CLOCKWISE_OUTER_RING_EDGE: Record<OuterRingEdgeSnapEdge, OuterRingEdgeSnapEdge> = {
  top: "right",
  right: "bottom",
  bottom: "left",
  left: "top",
};
const COUNTER_CLOCKWISE_OUTER_RING_EDGE: Record<OuterRingEdgeSnapEdge, OuterRingEdgeSnapEdge> = {
  top: "left",
  left: "bottom",
  bottom: "right",
  right: "top",
};

interface OuterRingSnapGeometry {
  readonly outerBounds: SceneBounds;
  readonly segments: readonly SceneBoundarySegment[];
  readonly edgeDepths: Record<OuterRingEdgeSnapEdge, number>;
}

export function hasOuterRingEdgeSnapBehavior(definition: EntityDefinition): boolean {
  return definition.placementBehaviors.some((behavior) =>
    behavior.type === PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge,
  );
}

export function snapPlacementToOuterRingEdge(options: {
  readonly definition: EntityDefinition;
  readonly space: SceneSpace;
  readonly allowedAreaIds: readonly string[];
  readonly position: GridPoint;
  readonly rotation: GridRotation;
}): OuterRingEdgeSnappedPlacement {
  const snapResult = resolveOuterRingEdgeSnap(options);

  return snapResult === null
    ? {
      position: options.position,
      rotation: options.rotation,
    }
    : {
      position: snapResult.position,
      rotation: snapResult.rotation,
    };
}

export function snapPositionToOuterRingEdge(options: {
  readonly definition: EntityDefinition;
  readonly space: SceneSpace;
  readonly allowedAreaIds: readonly string[];
  readonly position: GridPoint;
  readonly rotation: GridRotation;
}): GridPoint {
  return snapPlacementToOuterRingEdge(options).position;
}

export function resolveOuterRingEdgeSnap(options: {
  readonly definition: EntityDefinition;
  readonly space: SceneSpace;
  readonly allowedAreaIds: readonly string[];
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly preferredEdge?: OuterRingEdgeSnapEdge | null;
}): OuterRingEdgeSnapResult | null {
  if (!hasOuterRingEdgeSnapBehavior(options.definition)) {
    return null;
  }

  const rawFootprint = getRotatedGridFootprint(options.definition.footprint, options.rotation);
  const rawCenter = resolveRectCenter({
    position: options.position,
    footprint: rawFootprint,
  });
  const edges = options.preferredEdge === undefined || options.preferredEdge === null
    ? OUTER_RING_EDGE_SNAP_EDGES
    : [options.preferredEdge];
  const geometries = resolveSnapGeometries(options.space, options.allowedAreaIds);
  const candidates = geometries.flatMap((geometry) =>
    edges.flatMap((edge) => geometry.segments.filter((segment) => segment.side === edge).flatMap((segment) => {
      const candidate = resolveOuterRingEdgeSnapCandidate({
        definition: options.definition,
        geometry,
        segment,
        position: options.position,
        rawCenter,
        enforceCenterDistance: true,
      });
      return candidate === null ? [] : [candidate];
    }))
  );

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => {
    const distanceDelta = left.distance - right.distance;
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    return squaredDistance(options.position, left.position)
      - squaredDistance(options.position, right.position);
  })[0] ?? null;
}

export function rotateOuterRingEdgeSnappedPlacement(options: {
  readonly definition: EntityDefinition;
  readonly space: SceneSpace;
  readonly allowedAreaIds: readonly string[];
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly angle: GridRotation;
}): OuterRingEdgeSnapResult | null {
  if (!hasOuterRingEdgeSnapBehavior(options.definition)) {
    return null;
  }

  const currentFootprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.rotation,
  );
  const geometries = resolveSnapGeometries(options.space, options.allowedAreaIds);
  const currentArea = geometries.map((geometry) => {
    return {
      geometry,
      edge: resolveCurrentOuterRingSnapEdge({
        definition: options.definition,
        geometry,
        position: options.position,
        rotation: options.rotation,
        footprint: currentFootprint,
      }),
    };
  }).find((area) => area.edge !== null);

  const currentEdge = currentArea?.edge ?? null;

  if (currentEdge === null) {
    return null;
  }

  const targetEdge = resolveCornerSwitchTargetEdge({
    edge: currentEdge,
    position: options.position,
    footprint: currentFootprint,
    outerBounds: currentArea!.geometry.outerBounds,
    angle: options.angle,
  });

  if (targetEdge === null) {
    return null;
  }

  for (const segment of currentArea!.geometry.segments) {
    if (segment.side !== targetEdge) continue;
    const candidate = resolveOuterRingEdgeSnapCandidate({
      definition: options.definition,
      geometry: currentArea!.geometry,
      segment,
      position: options.position,
      rawCenter: resolveRectCenter({ position: options.position, footprint: currentFootprint }),
      enforceCenterDistance: false,
    });
    if (candidate !== null) return candidate;
  }
  return null;
}

function snapRectToOuterRingEdge(options: {
  readonly segment: SceneBoundarySegment;
  readonly footprint: GridRectSize;
  readonly position: GridPoint;
}): GridPoint | null {
  const { segment, footprint, position } = options;
  const horizontal = segment.side === "top" || segment.side === "bottom";
  const length = horizontal ? footprint.width : footprint.height;
  const min = segment.start;
  const max = segment.end === null ? null : segment.end - length;
  if (min !== null && max !== null && min > max) return null;
  const tangent = clamp(horizontal ? position.x : position.y, min, max);
  switch (segment.side) {
    case "top": return { x: tangent, y: segment.coordinate };
    case "right": return { x: segment.coordinate - footprint.width, y: tangent };
    case "bottom": return { x: tangent, y: segment.coordinate - footprint.height };
    case "left": return { x: segment.coordinate, y: tangent };
  }
}

// AI-REMOVED 2026-09-26:
// Reason: 单一吸附矩形无法处理分离分区的外边界。
// Trigger: 草稿箱新增左上角分区。
// Evidence: resolveBaseAreas 提供每块区域的独立 outerRect 与外扩深度。
// Replacement: resolveOuterRingEdgeSnap 与 rotateOuterRingEdgeSnappedPlacement 内的逐区域计算。
// Risk: 多区域间吸附按距离选最近候选；需检查边界交叠的未来配置。
// Human Review: Required
// Original code:
// function resolveOuterRingSnapGeometry(
//   baseDefinition: BaseDefinition,
// ): OuterRingSnapGeometry {
//   const outerRing = baseDefinition.outerRing;
//
//   return {
//     outerRect: {
//       x: -outerRing.left,
//       y: -outerRing.top,
//       width: baseDefinition.placeableArea.width + outerRing.left + outerRing.right,
//       height: baseDefinition.placeableArea.height + outerRing.top + outerRing.bottom,
//     },
//     edgeDepths: {
//       top: outerRing.top,
//       right: outerRing.right,
//       bottom: outerRing.bottom,
//       left: outerRing.left,
//     },
//   };
// }

function resolveOuterRingEdgeSnapCandidate(options: {
  readonly definition: EntityDefinition;
  readonly geometry: OuterRingSnapGeometry;
  readonly segment: SceneBoundarySegment;
  readonly position: GridPoint;
  readonly rawCenter: { readonly x: number; readonly y: number };
  readonly enforceCenterDistance: boolean;
}): OuterRingEdgeSnapResult | null {
  const edge = options.segment.side;
  const edgeDepth = options.geometry.edgeDepths[edge];
  if (edgeDepth <= 0) return null;
  const distance = resolveCenterDistanceToOuterEdge({ center: options.rawCenter, segment: options.segment });
  if (options.enforceCenterDistance && distance > edgeDepth) return null;
  const rotation = resolveRotationForOuterRingEdge(options.definition, edge);
  const footprint = getRotatedGridFootprint(options.definition.footprint, rotation);
  const position = snapRectToOuterRingEdge({ segment: options.segment, footprint, position: options.position });
  if (position === null || !isRectInSceneBounds(options.geometry.outerBounds, { ...position, ...footprint })) return null;
  return { position, rotation, edge, distance };
}

function resolveCurrentOuterRingSnapEdge(options: {
  readonly definition: EntityDefinition;
  readonly geometry: OuterRingSnapGeometry;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly footprint: GridRectSize;
}): OuterRingEdgeSnapEdge | null {
  if (!isRectInSceneBounds(options.geometry.outerBounds, { ...options.position, ...options.footprint })) return null;
  return options.geometry.segments.find((segment) =>
    resolveRotationForOuterRingEdge(options.definition, segment.side) === options.rotation
    && isPlacementOnOuterRingEdge({ segment, position: options.position, footprint: options.footprint })
  )?.side ?? null;
}

function resolveCornerSwitchTargetEdge(options: {
  readonly edge: OuterRingEdgeSnapEdge;
  readonly position: GridPoint;
  readonly footprint: GridRectSize;
  readonly outerBounds: SceneBounds;
  readonly angle: GridRotation;
}): OuterRingEdgeSnapEdge | null {
  const availableEdges = resolveAvailableCornerSwitchEdges(options);
  if (availableEdges.length === 0) {
    return null;
  }

  const preferredEdge = options.angle === 270
    ? COUNTER_CLOCKWISE_OUTER_RING_EDGE[options.edge]
    : CLOCKWISE_OUTER_RING_EDGE[options.edge];

  return availableEdges.includes(preferredEdge)
    ? preferredEdge
    : availableEdges[0] ?? null;
}

function resolveAvailableCornerSwitchEdges(options: {
  readonly edge: OuterRingEdgeSnapEdge;
  readonly position: GridPoint;
  readonly footprint: GridRectSize;
  readonly outerBounds: SceneBounds;
}): OuterRingEdgeSnapEdge[] {
  const { minX, minY, maxX, maxY } = options.outerBounds;
  switch (options.edge) {
    case "top":
    case "bottom":
      return [
        minX !== null && options.position.x <= minX + OUTER_RING_CORNER_SWITCH_DISTANCE ? "left" : null,
        maxX !== null && options.position.x + options.footprint.width >= maxX - OUTER_RING_CORNER_SWITCH_DISTANCE ? "right" : null,
      ].filter((edge): edge is OuterRingEdgeSnapEdge => edge !== null);
    case "right":
    case "left":
      return [
        minY !== null && options.position.y <= minY + OUTER_RING_CORNER_SWITCH_DISTANCE ? "top" : null,
        maxY !== null && options.position.y + options.footprint.height >= maxY - OUTER_RING_CORNER_SWITCH_DISTANCE ? "bottom" : null,
      ].filter((edge): edge is OuterRingEdgeSnapEdge => edge !== null);
  }
}

function isPlacementOnOuterRingEdge(options: {
  readonly segment: SceneBoundarySegment;
  readonly position: GridPoint;
  readonly footprint: GridRectSize;
}): boolean {
  const snapped = snapRectToOuterRingEdge(options);
  return snapped !== null && snapped.x === options.position.x && snapped.y === options.position.y;
}

function resolveRotationForOuterRingEdge(
  definition: EntityDefinition,
  edge: OuterRingEdgeSnapEdge,
): GridRotation {
  const sourceOutsideEdge = resolveSourceOutsideEdge(definition);
  const targetOutsideEdge = EDGE_BY_OUTER_RING_SNAP_EDGE[edge];

  return GRID_ROTATIONS.find((rotation) =>
    rotateGridEdge(sourceOutsideEdge, rotation) === targetOutsideEdge,
  ) ?? 0;
}

function resolveSourceOutsideEdge(definition: EntityDefinition): GridEdge {
  const firstPort = definition.portGroups.flatMap((portGroup) => portGroup.ports)[0];

  return firstPort === undefined ? "NORTH" : oppositeGridEdge(firstPort.edge);
}

function oppositeGridEdge(edge: GridEdge): GridEdge {
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

function resolveCenterDistanceToOuterEdge(options: {
  readonly center: { readonly x: number; readonly y: number };
  readonly segment: SceneBoundarySegment;
}): number {
  const horizontal = options.segment.side === "top" || options.segment.side === "bottom";
  return Math.abs((horizontal ? options.center.y : options.center.x) - options.segment.coordinate);
}

function resolveRectCenter(options: {
  readonly position: GridPoint;
  readonly footprint: GridRectSize;
}): { readonly x: number; readonly y: number } {
  return {
    x: options.position.x + options.footprint.width / 2,
    y: options.position.y + options.footprint.height / 2,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 有限矩形包含判断由统一空间函数替代。
// Trigger: REQ-048 分方向无界。
// Evidence: 外圈现在使用 SceneBounds。
// Replacement: isRectInSceneBounds。
// Risk: Low。
// Human Review: Required
// Original code:
// function isGridRectContainedBy(container: GridRect, target: GridRect): boolean {
//   return (
//     target.x >= container.x
//     && target.y >= container.y
//     && target.x + target.width <= container.x + container.width
//     && target.y + target.height <= container.y + container.height
//   );
// }

function clamp(value: number, min: number | null, max: number | null): number {
  const lowerClamped = min === null ? value : Math.max(min, value);
  return max === null ? lowerClamped : Math.min(max, lowerClamped);
}

function squaredDistance(left: GridPoint, right: GridPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function resolveSnapGeometries(space: SceneSpace, allowedAreaIds: readonly string[]): OuterRingSnapGeometry[] {
  const areas = resolveBaseAreas(space);
  const segments = resolveSceneBoundarySegments(areas.map((area) => ({ id: area.id, bounds: area.outerBounds })), false);
  return areas.filter((area) => allowedAreaIds.includes(area.id)).map((area) => ({
    outerBounds: area.outerBounds,
    edgeDepths: area.outerRing,
    segments: segments.filter((segment) => segment.areaId === area.id),
  }));
}
