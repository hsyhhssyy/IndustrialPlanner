import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import type { GridEdge, GridPoint, GridRect, GridRectSize, GridRotation } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
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
  readonly outerRect: GridRect;
  readonly edgeDepths: Record<OuterRingEdgeSnapEdge, number>;
}

export function hasOuterRingEdgeSnapBehavior(definition: EntityDefinition): boolean {
  return definition.placementBehaviors.some((behavior) =>
    behavior.type === PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge,
  );
}

export function snapPlacementToOuterRingEdge(options: {
  readonly definition: EntityDefinition;
  readonly baseDefinition: BaseDefinition | null;
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
  readonly baseDefinition: BaseDefinition | null;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
}): GridPoint {
  return snapPlacementToOuterRingEdge(options).position;
}

export function resolveOuterRingEdgeSnap(options: {
  readonly definition: EntityDefinition;
  readonly baseDefinition: BaseDefinition | null;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly preferredEdge?: OuterRingEdgeSnapEdge | null;
}): OuterRingEdgeSnapResult | null {
  if (options.baseDefinition === null || !hasOuterRingEdgeSnapBehavior(options.definition)) {
    return null;
  }

  const geometry = resolveOuterRingSnapGeometry(options.baseDefinition);
  const rawFootprint = getRotatedGridFootprint(options.definition.footprint, options.rotation);
  const rawCenter = resolveRectCenter({
    position: options.position,
    footprint: rawFootprint,
  });
  const edges = options.preferredEdge === undefined || options.preferredEdge === null
    ? OUTER_RING_EDGE_SNAP_EDGES
    : [options.preferredEdge];
  const candidates = edges.flatMap((edge) => {
    const candidate = resolveOuterRingEdgeSnapCandidate({
      definition: options.definition,
      geometry,
      edge,
      position: options.position,
      rawCenter,
      enforceCenterDistance: true,
    });

    return candidate === null ? [] : [candidate];
  });

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
  readonly baseDefinition: BaseDefinition | null;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly angle: GridRotation;
}): OuterRingEdgeSnapResult | null {
  if (options.baseDefinition === null || !hasOuterRingEdgeSnapBehavior(options.definition)) {
    return null;
  }

  const geometry = resolveOuterRingSnapGeometry(options.baseDefinition);
  const currentFootprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.rotation,
  );
  const currentEdge = resolveCurrentOuterRingSnapEdge({
    definition: options.definition,
    geometry,
    position: options.position,
    rotation: options.rotation,
    footprint: currentFootprint,
  });

  if (currentEdge === null) {
    return null;
  }

  const targetEdge = resolveCornerSwitchTargetEdge({
    edge: currentEdge,
    position: options.position,
    footprint: currentFootprint,
    outerRect: geometry.outerRect,
    angle: options.angle,
  });

  if (targetEdge === null) {
    return null;
  }

  return resolveOuterRingEdgeSnapCandidate({
    definition: options.definition,
    geometry,
    edge: targetEdge,
    position: options.position,
    rawCenter: resolveRectCenter({
      position: options.position,
      footprint: currentFootprint,
    }),
    enforceCenterDistance: false,
  });
}

function snapRectToOuterRingEdge(options: {
  readonly outerRect: GridRect;
  readonly edge: OuterRingEdgeSnapEdge;
  readonly footprint: GridRectSize;
  readonly position: GridPoint;
}): GridPoint {
  const maxX = options.outerRect.x + options.outerRect.width - options.footprint.width;
  const maxY = options.outerRect.y + options.outerRect.height - options.footprint.height;

  switch (options.edge) {
    case "top":
      return {
        x: clamp(options.position.x, options.outerRect.x, maxX),
        y: options.outerRect.y,
      };
    case "right":
      return {
        x: maxX,
        y: clamp(options.position.y, options.outerRect.y, maxY),
      };
    case "bottom":
      return {
        x: clamp(options.position.x, options.outerRect.x, maxX),
        y: maxY,
      };
    case "left":
      return {
        x: options.outerRect.x,
        y: clamp(options.position.y, options.outerRect.y, maxY),
      };
  }
}

function resolveOuterRingSnapGeometry(
  baseDefinition: BaseDefinition,
): OuterRingSnapGeometry {
  const outerRing = baseDefinition.outerRing;

  return {
    outerRect: {
      x: -outerRing.left,
      y: -outerRing.top,
      width: baseDefinition.placeableArea.width + outerRing.left + outerRing.right,
      height: baseDefinition.placeableArea.height + outerRing.top + outerRing.bottom,
    },
    edgeDepths: {
      top: outerRing.top,
      right: outerRing.right,
      bottom: outerRing.bottom,
      left: outerRing.left,
    },
  };
}

function resolveOuterRingEdgeSnapCandidate(options: {
  readonly definition: EntityDefinition;
  readonly geometry: OuterRingSnapGeometry;
  readonly edge: OuterRingEdgeSnapEdge;
  readonly position: GridPoint;
  readonly rawCenter: { readonly x: number; readonly y: number };
  readonly enforceCenterDistance: boolean;
}): OuterRingEdgeSnapResult | null {
  const edgeDepth = options.geometry.edgeDepths[options.edge];
  if (edgeDepth <= 0) {
    return null;
  }

  const distance = resolveCenterDistanceToOuterEdge({
    center: options.rawCenter,
    outerRect: options.geometry.outerRect,
    edge: options.edge,
  });
  if (options.enforceCenterDistance && distance > edgeDepth) {
    return null;
  }

  const rotation = resolveRotationForOuterRingEdge(options.definition, options.edge);
  const footprint = getRotatedGridFootprint(options.definition.footprint, rotation);
  const position = snapRectToOuterRingEdge({
    outerRect: options.geometry.outerRect,
    edge: options.edge,
    footprint,
    position: options.position,
  });

  if (!isGridRectContainedBy(options.geometry.outerRect, {
    ...position,
    width: footprint.width,
    height: footprint.height,
  })) {
    return null;
  }

  return {
    position,
    rotation,
    edge: options.edge,
    distance,
  };
}

function resolveCurrentOuterRingSnapEdge(options: {
  readonly definition: EntityDefinition;
  readonly geometry: OuterRingSnapGeometry;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly footprint: GridRectSize;
}): OuterRingEdgeSnapEdge | null {
  const matchedEdge = OUTER_RING_EDGE_SNAP_EDGES.find((edge) =>
    resolveRotationForOuterRingEdge(options.definition, edge) === options.rotation,
  );

  if (
    matchedEdge !== undefined
    && isPlacementOnOuterRingEdge({
      edge: matchedEdge,
      outerRect: options.geometry.outerRect,
      position: options.position,
      footprint: options.footprint,
    })
  ) {
    return matchedEdge;
  }

  return null;
}

function resolveCornerSwitchTargetEdge(options: {
  readonly edge: OuterRingEdgeSnapEdge;
  readonly position: GridPoint;
  readonly footprint: GridRectSize;
  readonly outerRect: GridRect;
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
  readonly outerRect: GridRect;
}): OuterRingEdgeSnapEdge[] {
  const maxX = options.outerRect.x + options.outerRect.width - options.footprint.width;
  const maxY = options.outerRect.y + options.outerRect.height - options.footprint.height;

  switch (options.edge) {
    case "top":
    case "bottom":
      return [
        options.position.x <= options.outerRect.x + OUTER_RING_CORNER_SWITCH_DISTANCE
          ? "left"
          : null,
        options.position.x >= maxX - OUTER_RING_CORNER_SWITCH_DISTANCE
          ? "right"
          : null,
      ].filter((edge): edge is OuterRingEdgeSnapEdge => edge !== null);
    case "right":
    case "left":
      return [
        options.position.y <= options.outerRect.y + OUTER_RING_CORNER_SWITCH_DISTANCE
          ? "top"
          : null,
        options.position.y >= maxY - OUTER_RING_CORNER_SWITCH_DISTANCE
          ? "bottom"
          : null,
      ].filter((edge): edge is OuterRingEdgeSnapEdge => edge !== null);
  }
}

function isPlacementOnOuterRingEdge(options: {
  readonly edge: OuterRingEdgeSnapEdge;
  readonly outerRect: GridRect;
  readonly position: GridPoint;
  readonly footprint: GridRectSize;
}): boolean {
  const maxX = options.outerRect.x + options.outerRect.width - options.footprint.width;
  const maxY = options.outerRect.y + options.outerRect.height - options.footprint.height;

  switch (options.edge) {
    case "top":
      return options.position.y === options.outerRect.y
        && options.position.x >= options.outerRect.x
        && options.position.x <= maxX;
    case "right":
      return options.position.x === maxX
        && options.position.y >= options.outerRect.y
        && options.position.y <= maxY;
    case "bottom":
      return options.position.y === maxY
        && options.position.x >= options.outerRect.x
        && options.position.x <= maxX;
    case "left":
      return options.position.x === options.outerRect.x
        && options.position.y >= options.outerRect.y
        && options.position.y <= maxY;
  }
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
  readonly outerRect: GridRect;
  readonly edge: OuterRingEdgeSnapEdge;
}): number {
  switch (options.edge) {
    case "top":
      return Math.abs(options.center.y - options.outerRect.y);
    case "right":
      return Math.abs(options.center.x - (options.outerRect.x + options.outerRect.width));
    case "bottom":
      return Math.abs(options.center.y - (options.outerRect.y + options.outerRect.height));
    case "left":
      return Math.abs(options.center.x - options.outerRect.x);
  }
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

function isGridRectContainedBy(container: GridRect, target: GridRect): boolean {
  return (
    target.x >= container.x
    && target.y >= container.y
    && target.x + target.width <= container.x + container.width
    && target.y + target.height <= container.y + container.height
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function squaredDistance(left: GridPoint, right: GridPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}
