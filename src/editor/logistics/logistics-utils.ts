import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import {
  isBaseBuiltinEntityId,
  resolveBaseBuiltinEntities,
} from "@/domain/registry/types/base-definition";
import type {
  GridEdge,
  GridPoint,
  GridRect,
  GridRectSize,
  GridRotation,
} from "@/domain/shared/grid";
import {
  FluidDomain,
  ItemDomainFlag,
} from "@/domain/shared/item-domain-flags";
import type {
  LogisticsDraftEndpoint,
  LogisticsKind,
  LogisticsPathCell,
  LogisticsPathShape,
  LogisticsPortDirection,
  LogisticsPortKind,
  LogisticsRouteOrder,
} from "@/domain/shared/logistics";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveLogisticsSuppressionKind } from "@/shared/logistics-suppression";

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type DevicePortEndpoint = Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>;

// AI-REMOVED 2026-07-27:
// Reason: editor 不应拥有传送带节和管道节 definition ID 的副本。
// Trigger: 用户要求 definition ID 归 registry 内部常量所有，registry 外只使用 RegistryQuery。
// Evidence: RegistryQuery.resolveLogisticsDefinitionId 与 isBelt/isPipe 已覆盖原用途。
// Replacement: workspace.registry.queries。
// Risk: Low
// Human Review: Required
//
// Original code:
// export const LOGISTICS_DEFINITION_IDS = {
//   belt: {
//     straight: "belt_straight_1x1",
//     turnCw: "belt_turn_cw_1x1",
//     turnCcw: "belt_turn_ccw_1x1",
//   },
//   pipe: {
//     straight: "pipe_straight_1x1",
//     turnCw: "pipe_turn_cw_1x1",
//     turnCcw: "pipe_turn_ccw_1x1",
//   },
// } as const;

const EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];
// 以起笔格为中心，设备来源方向优先级固定为左、上、右、下。
const ADJACENT_OUTPUT_SOURCE_OFFSETS = [
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
] as const;

export function createEntityDefinitionMap(
  definitions: readonly EntityDefinition[],
): ReadonlyMap<string, EntityDefinition> {
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

export function resolvePortKindForLogisticsKind(kind: LogisticsKind): LogisticsPortKind {
  return kind === LOGISTICS_KIND.belt ? ItemDomainFlag.Solid : FluidDomain;
}

export function isOrdinaryLogisticsDefinitionId(
  definitionId: string,
  kind: LogisticsKind,
  registryQueries: RegistryQuery,
): boolean {
  return kind === LOGISTICS_KIND.belt
    ? registryQueries.isBelt(definitionId)
    : registryQueries.isPipe(definitionId);
}

export function isAnyOrdinaryLogisticsDefinitionId(
  definitionId: string,
  registryQueries: RegistryQuery,
): boolean {
  return (
    registryQueries.isBelt(definitionId)
    || registryQueries.isPipe(definitionId)
  );
}

// AI-REMOVED 2026-07-27:
// Reason: editor 本地 shape→definition ID 转换会重复 registry 的 ID 所有权。
// Trigger: 用户要求 registry 外只调用导出 Query。
// Evidence: RegistryQuery.resolveLogisticsDefinitionId(kind, shape) 已直接转发 registry 内部常量。
// Replacement: workspace.registry.queries.resolveLogisticsDefinitionId。
// Risk: Low
// Human Review: Required
//
// Original code:
// export function resolveLogisticsDefinitionId(options: {
//   kind: LogisticsKind;
//   shape: LogisticsPathShape;
// }): string {
//   const ids = LOGISTICS_DEFINITION_IDS[options.kind];
//   switch (options.shape) {
//     case "turn-cw": return ids.turnCw;
//     case "turn-ccw": return ids.turnCcw;
//     case "straight":
//     default: return ids.straight;
//   }
// }

export function resolveLogisticsEndpointAtGridPoint(options: {
  gridPoint: GridPoint;
  kind: LogisticsKind;
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  baseDefinitions?: readonly BaseDefinition[];
}): LogisticsDraftEndpoint | null {
  // 跳过对端物流类型的专用设备：belt 模式下跳过 pipe 段，pipe 模式下跳过 belt 段。
  // 使被管道覆盖的分流器/汇流器/桥接器等设备能被正常匹配。
  const skipLogisticsKind: LogisticsKind = options.kind === LOGISTICS_KIND.belt
    ? LOGISTICS_KIND.pipe
    : LOGISTICS_KIND.belt;
  const entity = findTopEntityAtGridPoint({ ...options, skipLogisticsKind });

  if (
    entity === null
    || (
      isOrdinaryLogisticsDefinitionId(entity.definitionId, options.kind, options.registryQueries)
      && !isBaseBuiltinEntityId(entity.id)
    )
  ) {
    // 空地和普通物流格优先视为相邻设备的固定输出端口外侧格。
    const adjacentOutput = resolveAdjacentFixedOutputPortEndpoint({ ...options, skipLogisticsKind });
    if (adjacentOutput !== null) {
      return adjacentOutput;
    }

    return entity === null
      ? {
          type: "empty-cell",
          gridPoint: { ...options.gridPoint },
        }
      : {
          type: "logistics-entity",
          entityId: entity.id,
          gridPoint: { ...entity.position },
        };
  }

  const definition = options.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return null;
  }

  return resolveNearestDevicePortEndpoint({
    entity,
    definition,
    kind: options.kind,
    direction: "output",
    pointerGridPoint: options.gridPoint,
  });
}

function resolveAdjacentFixedOutputPortEndpoint(options: {
  gridPoint: GridPoint;
  kind: LogisticsKind;
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  baseDefinitions?: readonly BaseDefinition[];
  skipLogisticsKind?: LogisticsKind;
}): DevicePortEndpoint | null {
  for (const offset of ADJACENT_OUTPUT_SOURCE_OFFSETS) {
    const neighborGridPoint = {
      x: options.gridPoint.x + offset.x,
      y: options.gridPoint.y + offset.y,
    };
    const neighbor = findTopEntityAtGridPoint({
      ...options,
      gridPoint: neighborGridPoint,
    });
    if (neighbor === null) {
      continue;
    }

    const definition = options.entityDefinitionMap.get(neighbor.definitionId);
    if (definition === undefined) {
      continue;
    }

    const endpoints = resolveDevicePortEndpoints({
      entity: neighbor,
      definition,
      kind: options.kind,
      direction: "output",
      pointerGridPoint: options.gridPoint,
    })
      .filter((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.gridPoint))
      .sort((left, right) => {
        const groupDelta = left.portGroupId.localeCompare(right.portGroupId);
        return groupDelta !== 0 ? groupDelta : left.portId.localeCompare(right.portId);
      });
    const endpoint = endpoints[0];
    if (endpoint !== undefined) {
      return {
        ...endpoint,
        fixedSource: true,
      };
    }
  }

  return null;
}

export function resolveNearestDevicePortEndpoint(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
  direction: LogisticsPortDirection;
  pointerGridPoint: GridPoint;
}): DevicePortEndpoint | null {
  const endpoints = resolveDevicePortEndpoints(options);

  if (endpoints.length === 0) {
    return null;
  }

  return [...endpoints].sort((left, right) => {
    const distanceDelta = manhattanDistance(left.outsideGridPoint, options.pointerGridPoint)
      - manhattanDistance(right.outsideGridPoint, options.pointerGridPoint);
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    const groupDelta = left.portGroupId.localeCompare(right.portGroupId);
    return groupDelta !== 0 ? groupDelta : left.portId.localeCompare(right.portId);
  })[0] ?? null;
}

export function resolveInputEndpointAtPointer(options: {
  pointerGridPoint: GridPoint;
  kind: LogisticsKind;
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  baseDefinitions?: readonly BaseDefinition[];
}): DevicePortEndpoint | null {
  const entity = findTopEntityAtGridPoint({
    gridPoint: options.pointerGridPoint,
    document: options.document,
    drafts: options.drafts,
    entityDefinitionMap: options.entityDefinitionMap,
    baseDefinitions: options.baseDefinitions,
    registryQueries: options.registryQueries,
    skipLogisticsKind: options.kind === LOGISTICS_KIND.belt
      ? LOGISTICS_KIND.pipe
      : LOGISTICS_KIND.belt,
  });
  if (
    entity === null
    || (
      isOrdinaryLogisticsDefinitionId(entity.definitionId, options.kind, options.registryQueries)
      && !isBaseBuiltinEntityId(entity.id)
    )
  ) {
    return null;
  }

  const definition = options.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return null;
  }

  const endpoints = resolveDevicePortEndpoints({
    entity,
    definition,
    kind: options.kind,
    direction: "input",
    pointerGridPoint: options.pointerGridPoint,
  });

  const endpointsAtPointer = endpoints.filter((endpoint) =>
    areGridPointsEqual(endpoint.insideGridPoint, options.pointerGridPoint)
    || areGridPointsEqual(endpoint.outsideGridPoint, options.pointerGridPoint),
  );
  if (endpointsAtPointer.length === 0) {
    return null;
  }

  return [...endpointsAtPointer].sort((left, right) => {
    const distanceDelta = manhattanDistance(left.outsideGridPoint, options.pointerGridPoint)
      - manhattanDistance(right.outsideGridPoint, options.pointerGridPoint);
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    const groupDelta = left.portGroupId.localeCompare(right.portGroupId);
    return groupDelta !== 0 ? groupDelta : left.portId.localeCompare(right.portId);
  })[0] ?? null;
}

export function resolveInputEndpointOnPath(options: {
  pathPoints: readonly GridPoint[];
  kind: LogisticsKind;
  document: WorldDocument;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  baseDefinitions?: readonly BaseDefinition[];
}): DevicePortEndpoint | null {
  for (let i = 0; i < options.pathPoints.length - 1; i += 1) {
    const current = options.pathPoints[i];
    const next = options.pathPoints[i + 1];

    if (current === undefined || next === undefined) {
      continue;
    }

    const entity = findTopEntityAtGridPoint({
      gridPoint: next,
      document: options.document,
      drafts: [],
      entityDefinitionMap: options.entityDefinitionMap,
      registryQueries: options.registryQueries,
      baseDefinitions: options.baseDefinitions,
      skipLogisticsKind: options.kind === LOGISTICS_KIND.belt
        ? LOGISTICS_KIND.pipe
        : LOGISTICS_KIND.belt,
    });
    if (
      entity === null
      || (
        isOrdinaryLogisticsDefinitionId(entity.definitionId, options.kind, options.registryQueries)
        && !isBaseBuiltinEntityId(entity.id)
      )
    ) {
      continue;
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    const endpoints = resolveDevicePortEndpoints({
      entity,
      definition,
      kind: options.kind,
      direction: "input",
      pointerGridPoint: next,
    });

    for (const endpoint of endpoints) {
      if (areGridPointsEqual(current, endpoint.outsideGridPoint)) {
        return endpoint;
      }
    }
  }

  return null;
}

export function resolveDevicePortEndpoints(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
  direction: LogisticsPortDirection;
  pointerGridPoint: GridPoint;
}): DevicePortEndpoint[] {
  const portKind = resolvePortKindForLogisticsKind(options.kind);
  const isPipe = options.kind === LOGISTICS_KIND.pipe;
  const endpoints: DevicePortEndpoint[] = [];

  for (const portGroup of options.definition.portGroups) {
    if (
      portGroup.isPipe !== isPipe
      || (portGroup.kind & portKind) === 0
      || portGroup.direction !== options.direction
    ) {
      continue;
    }

    for (const port of portGroup.ports) {
      const localCell = rotateLocalPortCell({
        footprint: options.definition.footprint,
        port,
        rotation: options.entity.rotation,
      });
      const edge = rotateGridEdge(port.edge, options.entity.rotation);
      const insideGridPoint = {
        x: options.entity.position.x + localCell.x,
        y: options.entity.position.y + localCell.y,
      };
      const delta = resolveEdgeDelta(edge);
      const outsideGridPoint = {
        x: insideGridPoint.x + delta.x,
        y: insideGridPoint.y + delta.y,
      };

      endpoints.push({
        type: "device-port",
        entityId: options.entity.id,
        portGroupId: portGroup.id,
        portId: port.id,
        portKind: portGroup.kind,
        portDirection: options.direction,
        insideGridPoint,
        outsideGridPoint,
        edge,
      });
    }
  }

  return endpoints;
}

export function resolveSourceStartGridPoint(source: LogisticsDraftEndpoint): GridPoint {
  return source.type === "device-port"
    ? { ...source.outsideGridPoint }
    : { ...source.gridPoint };
}

export function generateSingleBendPathPoints(options: {
  start: GridPoint;
  target: GridPoint;
  routeOrder: LogisticsRouteOrder;
}): GridPoint[] {
  const points: GridPoint[] = [{ ...options.start }];

  if (areGridPointsEqual(options.start, options.target)) {
    return points;
  }

  const corner = options.routeOrder === "vertical-first"
    ? { x: options.start.x, y: options.target.y }
    : { x: options.target.x, y: options.start.y };

  appendManhattanSegment(points, corner);
  appendManhattanSegment(points, options.target);

  return dedupeAdjacentPoints(points);
}

export function appendFreehandPathPoints(options: {
  points: readonly GridPoint[];
  pointerGridPoint: GridPoint;
}): GridPoint[] {
  if (options.points.length === 0) {
    return [{ ...options.pointerGridPoint }];
  }

  const points = options.points.map((point) => ({ ...point }));
  const head = points[points.length - 1];

  if (head === undefined || areGridPointsEqual(head, options.pointerGridPoint)) {
    return points;
  }

  const previous = points[points.length - 2];
  if (previous !== undefined && areGridPointsEqual(previous, options.pointerGridPoint)) {
    points.pop();
    return points;
  }

  if (areAdjacentGridPoints(head, options.pointerGridPoint)) {
    points.push({ ...options.pointerGridPoint });
    return points;
  }

  const dx = options.pointerGridPoint.x - head.x;
  const dy = options.pointerGridPoint.y - head.y;
  const preferHorizontal = Math.abs(dx) >= Math.abs(dy);
  const corner = preferHorizontal
    ? { x: options.pointerGridPoint.x, y: head.y }
    : { x: head.x, y: options.pointerGridPoint.y };

  appendManhattanSegment(points, corner);
  appendManhattanSegment(points, options.pointerGridPoint);

  return dedupeAdjacentPoints(points);
}

export function resolveLogisticsPathCells(options: {
  kind: LogisticsKind;
  points: readonly GridPoint[];
  source: LogisticsDraftEndpoint | null;
  target: LogisticsDraftEndpoint | null;
  document: WorldDocument;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  replacingEntity: WorldEntity | null;
  replacingDefinition: EntityDefinition | null;
}): LogisticsPathCell[] {
  const cells: LogisticsPathCell[] = [];

  for (let index = 0; index < options.points.length; index += 1) {
    const point = options.points[index];
    if (point === undefined) {
      continue;
    }

    const previous = options.points[index - 1] ?? null;
    const next = options.points[index + 1] ?? null;
    const fromEdge = resolveCellFromEdge({
      point,
      previous,
      next,
      source: index === 0 ? options.source : null,
      target: index === options.points.length - 1 ? options.target : null,
      kind: options.kind,
      document: options.document,
      entityDefinitionMap: options.entityDefinitionMap,
      registryQueries: options.registryQueries,
      replacingEntity: index === 0 ? options.replacingEntity : null,
      replacingDefinition: index === 0 ? options.replacingDefinition : null,
    });
    const toEdge = resolveCellToEdge({
      point,
      previous,
      next,
      target: index === options.points.length - 1 ? options.target : null,
      fromEdge,
    });
    const normalized = normalizeCellEdges(fromEdge, toEdge);
    const shape = resolveShapeFromEdges(normalized.fromEdge, normalized.toEdge);

    cells.push({
      gridPoint: { ...point },
      fromEdge: normalized.fromEdge,
      toEdge: normalized.toEdge,
      shape,
      rotation: resolveRotationForShape({
        shape,
        fromEdge: normalized.fromEdge,
        toEdge: normalized.toEdge,
      }),
    });
  }

  return cells;
}

export function doesFirstStepMoveTowardFixedSourceInput(options: {
  kind: LogisticsKind;
  points: readonly GridPoint[];
  source: LogisticsDraftEndpoint | null;
  document: WorldDocument;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  replacingEntity: WorldEntity | null;
  replacingDefinition: EntityDefinition | null;
}): boolean {
  const start = options.points[0];
  const firstStep = options.points[1];
  if (start === undefined || firstStep === undefined) {
    return false;
  }

  const fixedInputEdge = resolveFixedSourceInputEdge(options);
  if (fixedInputEdge === null) {
    return false;
  }

  return resolveDirectionEdge(start, firstStep) === fixedInputEdge;
}

export function findTopEntityAtGridPoint(options: {
  gridPoint: GridPoint;
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  baseDefinitions?: readonly BaseDefinition[];
  skipLogisticsKind?: LogisticsKind;
}): WorldEntity | null {
  const draft = findTopEntityInListAtGridPoint({
    gridPoint: options.gridPoint,
    entities: options.drafts,
    entityDefinitionMap: options.entityDefinitionMap,
    registryQueries: options.registryQueries,
    skipLogisticsKind: options.skipLogisticsKind,
  });
  if (draft !== null) {
    return draft;
  }

  const orderedEntities = [...options.document.entityOrder]
    .map((entityId) => options.document.entities[entityId])
    .filter((entity): entity is WorldEntity => entity !== undefined);

  const entity = findTopEntityInListAtGridPoint({
    gridPoint: options.gridPoint,
    entities: orderedEntities,
    entityDefinitionMap: options.entityDefinitionMap,
    registryQueries: options.registryQueries,
    skipLogisticsKind: options.skipLogisticsKind,
  });
  if (entity !== null) {
    return entity;
  }

  return findTopEntityInListAtGridPoint({
    gridPoint: options.gridPoint,
    entities: resolveOptionalBaseBuiltinEntities(options),
    entityDefinitionMap: options.entityDefinitionMap,
    registryQueries: options.registryQueries,
    skipLogisticsKind: options.skipLogisticsKind,
  });
}

export function findEntityById(options: {
  entityId: string;
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  baseDefinitions?: readonly BaseDefinition[];
}): WorldEntity | null {
  const entity = options.document.entities[options.entityId]
    ?? options.drafts.find((candidate) => candidate.id === options.entityId)
    ?? resolveOptionalBaseBuiltinEntities(options).find((candidate) =>
      candidate.id === options.entityId,
    );

  return entity ?? null;
}

function resolveOptionalBaseBuiltinEntities(options: {
  document: WorldDocument;
  baseDefinitions?: readonly BaseDefinition[];
}): readonly WorldEntity[] {
  if (options.baseDefinitions === undefined) {
    return [];
  }

  return resolveBaseBuiltinEntities({
    baseDefinitions: options.baseDefinitions,
    baseId: options.document.baseId,
  });
}

export function resolveEntityGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
}): GridRect {
  const footprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.entity.rotation,
  );

  return {
    x: options.entity.position.x,
    y: options.entity.position.y,
    width: footprint.width,
    height: footprint.height,
  };
}

export function isGridPointInsideRect(point: GridPoint, rect: GridRect): boolean {
  return (
    point.x >= rect.x
    && point.x < rect.x + rect.width
    && point.y >= rect.y
    && point.y < rect.y + rect.height
  );
}

export function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

export function gridPointKey(point: GridPoint): string {
  return `${point.x}:${point.y}`;
}

export function oppositeEdge(edge: GridEdge): GridEdge {
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

export function resolveDirectionEdge(from: GridPoint, to: GridPoint): GridEdge | null {
  if (to.x === from.x && to.y === from.y - 1) {
    return "NORTH";
  }
  if (to.x === from.x + 1 && to.y === from.y) {
    return "EAST";
  }
  if (to.x === from.x && to.y === from.y + 1) {
    return "SOUTH";
  }
  if (to.x === from.x - 1 && to.y === from.y) {
    return "WEST";
  }

  return null;
}

function findTopEntityInListAtGridPoint(options: {
  gridPoint: GridPoint;
  entities: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  skipLogisticsKind?: LogisticsKind;
}): WorldEntity | null {
  for (let index = options.entities.length - 1; index >= 0; index -= 1) {
    const entity = options.entities[index];
    if (entity === undefined) {
      continue;
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    if (
      isGridPointInsideRect(
        options.gridPoint,
        resolveEntityGridRect({ entity, definition }),
      )
    ) {
      // 跳过对端物流类型的专用设备（如 belt 模式下跳过 pipe 段，pipe 模式下跳过 belt 段），
      // 使其下方的设备（如分流器/汇流器/桥接器）能被正常匹配。
      // AI-CORRECTION 2026-07-24: 现在跳过对端物流类型的全部受压制设备，
      // 包括桥接器、汇流器、分流器和准入口，使端口解析可穿透这些附属设备。
      if (
        options.skipLogisticsKind !== undefined
        && resolveLogisticsSuppressionKind(entity.definitionId, options.registryQueries)
          === options.skipLogisticsKind
      ) {
        continue;
      }
      return entity;
    }
  }

  return null;
}

function resolveCellFromEdge(options: {
  point: GridPoint;
  previous: GridPoint | null;
  next: GridPoint | null;
  source: LogisticsDraftEndpoint | null;
  target: LogisticsDraftEndpoint | null;
  kind: LogisticsKind;
  document: WorldDocument;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  replacingEntity: WorldEntity | null;
  replacingDefinition: EntityDefinition | null;
}): GridEdge | null {
  if (options.previous !== null) {
    const direction = resolveDirectionEdge(options.previous, options.point);
    return direction === null ? null : oppositeEdge(direction);
  }

  if (options.source?.type === "device-port") {
    return oppositeEdge(options.source.edge);
  }

  const replacingInputEdge = resolveConnectedReplacingInputEdge({
    kind: options.kind,
    document: options.document,
    entityDefinitionMap: options.entityDefinitionMap,
    registryQueries: options.registryQueries,
    replacingEntity: options.replacingEntity,
    replacingDefinition: options.replacingDefinition,
  });
  if (replacingInputEdge !== null) {
    return replacingInputEdge;
  }

  // AI-CORRECTION 2026-05-29:
  // 无合法上游连接时，从被替换实体自身的 input port edge 推断 fromEdge，
  // 而非从绘制方向反推。
  // 原行为：直接回退到 opposite(next direction) 或 "WEST"。
  if (options.replacingEntity !== null && options.replacingDefinition !== null) {
    const ownInputEndpoints = resolveDevicePortEndpoints({
      entity: options.replacingEntity,
      definition: options.replacingDefinition,
      kind: options.kind,
      direction: "input",
      pointerGridPoint: options.point,
    });
    const firstOwnEndpoint = ownInputEndpoints[0];
    if (firstOwnEndpoint !== undefined) {
      return firstOwnEndpoint.edge;
    }
  }

  if (options.next !== null) {
    const direction = resolveDirectionEdge(options.point, options.next);
    return direction === null ? null : oppositeEdge(direction);
  }

  // AI-CORRECTION 2026-05-30:
  // 当仅有单格路径且 source 为空地、无其他推导来源时，
  // 若 target 为 device-port，用 target 的 port edge 反推 fromEdge。
  // 否则回退到 "WEST"（原行为）。
  if (options.target?.type === "device-port") {
    return options.target.edge;
  }

  return "WEST";
}

function resolveFixedSourceInputEdge(options: {
  kind: LogisticsKind;
  source: LogisticsDraftEndpoint | null;
  document: WorldDocument;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  replacingEntity: WorldEntity | null;
  replacingDefinition: EntityDefinition | null;
}): GridEdge | null {
  if (options.source?.type === "device-port") {
    return oppositeEdge(options.source.edge);
  }

  if (options.source?.type !== "logistics-entity") {
    return null;
  }

  return resolveConnectedReplacingInputEdge({
    kind: options.kind,
    document: options.document,
    entityDefinitionMap: options.entityDefinitionMap,
    registryQueries: options.registryQueries,
    replacingEntity: options.replacingEntity,
    replacingDefinition: options.replacingDefinition,
  });
}

function resolveCellToEdge(options: {
  point: GridPoint;
  previous: GridPoint | null;
  next: GridPoint | null;
  target: LogisticsDraftEndpoint | null;
  fromEdge: GridEdge | null;
}): GridEdge | null {
  if (options.next !== null) {
    return resolveDirectionEdge(options.point, options.next);
  }

  if (options.target?.type === "device-port") {
    return oppositeEdge(options.target.edge);
  }

  if (options.previous !== null) {
    return resolveDirectionEdge(options.previous, options.point);
  }

  return options.fromEdge === null ? "EAST" : oppositeEdge(options.fromEdge);
}

function normalizeCellEdges(
  fromEdge: GridEdge | null,
  toEdge: GridEdge | null,
): {
  fromEdge: GridEdge;
  toEdge: GridEdge;
} {
  if (fromEdge !== null && toEdge !== null && fromEdge !== toEdge) {
    return { fromEdge, toEdge };
  }

  if (fromEdge !== null) {
    return {
      fromEdge,
      toEdge: oppositeEdge(fromEdge),
    };
  }

  if (toEdge !== null) {
    return {
      fromEdge: oppositeEdge(toEdge),
      toEdge,
    };
  }

  return {
    fromEdge: "WEST",
    toEdge: "EAST",
  };
}

function resolveConnectedReplacingInputEdge(options: {
  kind: LogisticsKind;
  document: WorldDocument;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  registryQueries: RegistryQuery;
  replacingEntity: WorldEntity | null;
  replacingDefinition: EntityDefinition | null;
}): GridEdge | null {
  if (options.replacingEntity === null || options.replacingDefinition === null) {
    return null;
  }

  const inputEndpoints = resolveDevicePortEndpoints({
    entity: options.replacingEntity,
    definition: options.replacingDefinition,
    kind: options.kind,
    direction: "input",
    pointerGridPoint: options.replacingEntity.position,
  });

  for (const inputEndpoint of inputEndpoints) {
    const predecessor = findTopEntityAtGridPoint({
      gridPoint: inputEndpoint.outsideGridPoint,
      document: options.document,
      drafts: [],
      entityDefinitionMap: options.entityDefinitionMap,
      registryQueries: options.registryQueries,
    });
    if (
      predecessor === null
      || predecessor.id === options.replacingEntity.id
      || !isOrdinaryLogisticsDefinitionId(
        predecessor.definitionId,
        options.kind,
        options.registryQueries,
      )
    ) {
      continue;
    }

    const predecessorDefinition = options.entityDefinitionMap.get(predecessor.definitionId);
    if (predecessorDefinition === undefined) {
      continue;
    }

    if (
      doesLogisticsEntityOutputConnectToGridPoint({
        kind: options.kind,
        entity: predecessor,
        definition: predecessorDefinition,
        targetGridPoint: options.replacingEntity.position,
      })
    ) {
      return inputEndpoint.edge;
    }
  }

  return null;
}

function doesLogisticsEntityOutputConnectToGridPoint(options: {
  kind: LogisticsKind;
  entity: WorldEntity;
  definition: EntityDefinition;
  targetGridPoint: GridPoint;
}): boolean {
  return resolveDevicePortEndpoints({
    entity: options.entity,
    definition: options.definition,
    kind: options.kind,
    direction: "output",
    pointerGridPoint: options.targetGridPoint,
  }).some((endpoint) => areGridPointsEqual(
    endpoint.outsideGridPoint,
    options.targetGridPoint,
  ));
}

export function resolveCellFromEdges(
  fromEdge: GridEdge,
  toEdge: GridEdge,
): { shape: LogisticsPathShape; rotation: GridRotation } {
  const shape = resolveShapeFromEdges(fromEdge, toEdge);
  const rotation = resolveRotationForShape({ shape, fromEdge, toEdge });
  return { shape, rotation };
}

function resolveShapeFromEdges(fromEdge: GridEdge, toEdge: GridEdge): LogisticsPathShape {
  if (oppositeEdge(fromEdge) === toEdge) {
    return "straight";
  }

  const entry = resolveEdgeDelta(oppositeEdge(fromEdge));
  const exit = resolveEdgeDelta(toEdge);
  const cross = entry.x * exit.y - entry.y * exit.x;

  return cross > 0 ? "turn-cw" : "turn-ccw";
}

function resolveRotationForShape(options: {
  shape: LogisticsPathShape;
  fromEdge: GridEdge;
  toEdge: GridEdge;
}): GridRotation {
  const base = options.shape === "turn-cw"
    ? { fromEdge: "EAST" as const, toEdge: "NORTH" as const }
    : options.shape === "turn-ccw"
      ? { fromEdge: "NORTH" as const, toEdge: "EAST" as const }
      : { fromEdge: "WEST" as const, toEdge: "EAST" as const };

  for (const rotation of [0, 90, 180, 270] as const) {
    if (
      rotateGridEdge(base.fromEdge, rotation) === options.fromEdge
      && rotateGridEdge(base.toEdge, rotation) === options.toEdge
    ) {
      return rotation;
    }
  }

  return 0;
}

function rotateLocalPortCell(options: {
  footprint: GridRectSize;
  port: PortDefinition;
  rotation: GridRotation;
}): GridPoint {
  const { width, height } = options.footprint;
  const { localCellX: x, localCellY: y } = options.port;

  switch (options.rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - 1 - y, y: x };
    case 180:
      return { x: width - 1 - x, y: height - 1 - y };
    case 270:
      return { x: y, y: width - 1 - x };
  }
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const currentIndex = EDGE_ORDER.indexOf(edge);
  const steps = rotation / 90;
  return EDGE_ORDER[(currentIndex + steps) % EDGE_ORDER.length] ?? edge;
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH":
      return { x: 0, y: -1 };
    case "EAST":
      return { x: 1, y: 0 };
    case "SOUTH":
      return { x: 0, y: 1 };
    case "WEST":
      return { x: -1, y: 0 };
  }
}

function appendManhattanSegment(points: GridPoint[], target: GridPoint): void {
  const head = points[points.length - 1];
  if (head === undefined || areGridPointsEqual(head, target)) {
    return;
  }

  let current = { ...head };
  while (current.x !== target.x) {
    current = {
      x: current.x + Math.sign(target.x - current.x),
      y: current.y,
    };
    points.push({ ...current });
  }

  while (current.y !== target.y) {
    current = {
      x: current.x,
      y: current.y + Math.sign(target.y - current.y),
    };
    points.push({ ...current });
  }
}

function dedupeAdjacentPoints(points: readonly GridPoint[]): GridPoint[] {
  const result: GridPoint[] = [];

  for (const point of points) {
    const previous = result[result.length - 1];
    if (previous !== undefined && areGridPointsEqual(previous, point)) {
      continue;
    }

    result.push({ ...point });
  }

  return result;
}

function areAdjacentGridPoints(left: GridPoint, right: GridPoint): boolean {
  return manhattanDistance(left, right) === 1;
}

function manhattanDistance(left: GridPoint, right: GridPoint): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}
