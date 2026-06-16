import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import {
  EntityCollectionType,
  type EntityPlacementValidationReason,
  type EntityPlacementValidationReasonCode,
  type EntityPlacementValidationResult,
} from "@/domain/editor/types/editor-types";
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import {
  isBaseBuiltinEntityId,
  resolveBaseBuiltinEntities,
} from "@/domain/registry/types/base-definition";
import type { GridEdge, GridRect } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { rotateGridEdge } from "@/shared/geometry/port";
import { runInAction } from "mobx";

import type { EditorStateReadWrite } from "./state-impl";
import { isDraftEntity } from "./draft-entity";

const WAREHOUSE_BUS_SEGMENT_DEFINITION_ID = "item_port_log_hongs_bus";
const WAREHOUSE_BUS_SOURCE_DEFINITION_ID = "item_port_log_hongs_bus_source";

const VALID_PLACEMENT_RESULT: EntityPlacementValidationResult = {
  canPlace: true,
  reasons: [],
};

const PLACEMENT_REASON_MESSAGES: Record<EntityPlacementValidationReasonCode, string> = {
  "outside-base": "必须放置在基地内",
  overlap: "不能与其他设备重叠",
  "warehouse-bus-disconnected": "未有效连接到源桩",
};

interface PlacementValidationEntry {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly gridRect: GridRect;
}

export function syncPlacementValidationState(options: {
  document: WorldDocument;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}): void {
  runInAction(() => {
    const validationByEntityId = resolvePlacementValidations(options);
    const invalidEntityIds = Object.entries(validationByEntityId)
      .filter(([, validation]) => !validation.canPlace)
      .map(([entityId]) => entityId);

    options.state.internalTransientState.placementValidationByEntityId = validationByEntityId;
    options.state.collections[EntityCollectionType.invalidPlacement].replace(invalidEntityIds);
  });
}

export function resolveCachedPlacementValidation(options: {
  entityId: string;
  state: EditorStateReadWrite;
}): EntityPlacementValidationResult {
  return options.state.internalTransientState.placementValidationByEntityId[options.entityId]
    ?? VALID_PLACEMENT_RESULT;
}

export function hasOutsideBasePlacementReason(options: {
  document: WorldDocument;
  entityIds: readonly string[];
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}): boolean {
  const validationByEntityId = resolvePlacementValidations({
    document: options.document,
    state: options.state,
    workspace: options.workspace,
  });

  return options.entityIds.some((entityId) =>
    validationByEntityId[entityId]?.reasons.some((reason) => reason.code === "outside-base")
    ?? false,
  );
}

export function resolvePlacementValidations(options: {
  document: WorldDocument;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}): Record<string, EntityPlacementValidationResult> {
  const definitionMap = new Map(
    options.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const entries = resolveValidationEntries({
    document: options.document,
    state: options.state,
    definitionMap,
    registry: options.workspace.registry,
  });
  const mutableReasonsByEntityId = new Map<string, EntityPlacementValidationReason[]>(
    entries.map((entry) => [entry.entity.id, []]),
  );

  applyOutsideBaseReasons({
    entries,
    document: options.document,
    registry: options.workspace.registry,
    reasonsByEntityId: mutableReasonsByEntityId,
  });
  applyOutsideOuterRingReasons({
    entries,
    document: options.document,
    registry: options.workspace.registry,
    reasonsByEntityId: mutableReasonsByEntityId,
  });
  applyOverlapReasons({
    entries,
    registry: options.workspace.registry,
    reasonsByEntityId: mutableReasonsByEntityId,
  });
  applyWarehouseConnectionReasons({
    entries,
    reasonsByEntityId: mutableReasonsByEntityId,
  });

  return Object.fromEntries(
    entries.map((entry) => {
      const reasons = mutableReasonsByEntityId.get(entry.entity.id) ?? [];

      return [
        entry.entity.id,
        {
          canPlace: reasons.length === 0,
          reasons,
        } satisfies EntityPlacementValidationResult,
      ];
    }),
  );
}

function resolveValidationEntries(options: {
  document: WorldDocument;
  state: EditorStateReadWrite;
  definitionMap: ReadonlyMap<string, EntityDefinition>;
  registry: WorkspaceContract["registry"];
}): PlacementValidationEntry[] {
  const ghostEntityIds = new Set(options.state.collections[EntityCollectionType.ghost]);
  const entities = [
    ...resolveOrderedDocumentEntities(options.document),
    ...resolveBaseBuiltinEntities({
      baseDefinitions: options.registry.baseDefinitions,
      baseId: options.document.baseId,
    }),
    ...options.state.drafts,
  ];
  const seenEntityIds = new Set<string>();
  const entries: PlacementValidationEntry[] = [];

  for (const entity of entities) {
    if (seenEntityIds.has(entity.id) || ghostEntityIds.has(entity.id)) {
      continue;
    }

    seenEntityIds.add(entity.id);

    const definition = options.definitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    entries.push({
      entity,
      definition,
      gridRect: resolveEntityGridRect({ entity, definition }),
    });
  }

  return entries;
}

function resolveOrderedDocumentEntities(document: WorldDocument): WorldEntity[] {
  const orderedEntityIds = [...document.entityOrder];
  const knownEntityIds = new Set(orderedEntityIds);

  for (const entityId of Object.keys(document.entities)) {
    if (knownEntityIds.has(entityId)) {
      continue;
    }

    orderedEntityIds.push(entityId);
  }

  return orderedEntityIds.flatMap((entityId) => {
    const entity = document.entities[entityId];

    return entity === undefined ? [] : [entity];
  });
}

function applyOutsideBaseReasons(options: {
  entries: readonly PlacementValidationEntry[];
  document: WorldDocument;
  registry: WorkspaceContract["registry"];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): void {
  const baseDefinition = resolveCurrentBaseDefinition({
    baseId: options.document.baseId,
    registry: options.registry,
  });
  if (baseDefinition === null) {
    return;
  }

  const baseGridRect: GridRect = {
    x: 0,
    y: 0,
    width: baseDefinition.placeableArea.width,
    height: baseDefinition.placeableArea.height,
  };

  for (const entry of options.entries) {
    if (isBaseBuiltinEntityId(entry.entity.id)) {
      continue;
    }

    if (!hasPlacementBehavior(
      entry.definition,
      PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase,
    )) {
      continue;
    }

    if (!isGridRectContainedBy(baseGridRect, entry.gridRect)) {
      appendReason(options.reasonsByEntityId, entry.entity.id, "outside-base");
    }
  }
}

function applyOutsideOuterRingReasons(options: {
  entries: readonly PlacementValidationEntry[];
  document: WorldDocument;
  registry: WorkspaceContract["registry"];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): void {
  const baseDefinition = resolveCurrentBaseDefinition({
    baseId: options.document.baseId,
    registry: options.registry,
  });
  if (baseDefinition === null) {
    return;
  }

  const outerRing = baseDefinition.outerRing;
  const outerRingGridRect: GridRect = {
    x: -outerRing.left,
    y: -outerRing.top,
    width: baseDefinition.placeableArea.width + outerRing.left + outerRing.right,
    height: baseDefinition.placeableArea.height + outerRing.top + outerRing.bottom,
  };

  for (const entry of options.entries) {
    if (isBaseBuiltinEntityId(entry.entity.id)) {
      continue;
    }

    if (!isGridRectContainedBy(outerRingGridRect, entry.gridRect)) {
      appendReason(options.reasonsByEntityId, entry.entity.id, "outside-base");
    }
  }
}

function applyOverlapReasons(options: {
  entries: readonly PlacementValidationEntry[];
  registry: WorkspaceContract["registry"];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): void {
  for (let leftIndex = 0; leftIndex < options.entries.length; leftIndex += 1) {
    const left = options.entries[leftIndex];
    if (left === undefined) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < options.entries.length; rightIndex += 1) {
      const right = options.entries[rightIndex];
      if (right === undefined || !areGridRectsIntersecting(left.gridRect, right.gridRect)) {
        continue;
      }

      const leftIsBaseBuiltin = isBaseBuiltinEntityId(left.entity.id);
      const rightIsBaseBuiltin = isBaseBuiltinEntityId(right.entity.id);
      if (leftIsBaseBuiltin || rightIsBaseBuiltin) {
        if (!leftIsBaseBuiltin) {
          appendReason(options.reasonsByEntityId, left.entity.id, "overlap");
        }
        if (!rightIsBaseBuiltin) {
          appendReason(options.reasonsByEntityId, right.entity.id, "overlap");
        }
        continue;
      }

      if (isAllowedPipeOverlapPair({
        left,
        right,
        registry: options.registry,
      })) {
        continue;
      }

      if (isAllowedLogisticsPlacementReplacement({
        left,
        right,
      })) {
        continue;
      }

      // 拖拽中 draft 与文档实体 overlap 时，仅标记 draft 为 invalid，
      // 文档中正式 entity 不显示 invalid。draft 放下后（变为普通 entity）
      // 再触发 validation 时双方都会正常标记。
      const leftIsDraft = isDraftEntity(left.entity);
      const rightIsDraft = isDraftEntity(right.entity);
      if (leftIsDraft && !rightIsDraft) {
        appendReason(options.reasonsByEntityId, left.entity.id, "overlap");
        continue;
      }
      if (!leftIsDraft && rightIsDraft) {
        appendReason(options.reasonsByEntityId, right.entity.id, "overlap");
        continue;
      }

      appendReason(options.reasonsByEntityId, left.entity.id, "overlap");
      appendReason(options.reasonsByEntityId, right.entity.id, "overlap");
    }
  }
}

function applyWarehouseConnectionReasons(options: {
  entries: readonly PlacementValidationEntry[];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): void {
  const sourceEntries = options.entries.filter((entry) =>
    entry.definition.id === WAREHOUSE_BUS_SOURCE_DEFINITION_ID
    && hasNoBasePlacementReason(options.reasonsByEntityId, entry.entity.id),
  );
  const segmentEntries = options.entries.filter((entry) =>
    entry.definition.id === WAREHOUSE_BUS_SEGMENT_DEFINITION_ID,
  );
  const validSegmentIds = resolveValidWarehouseBusSegmentIds({
    sourceEntries,
    segmentEntries,
    reasonsByEntityId: options.reasonsByEntityId,
  });

  for (const entry of options.entries) {
    if (isBaseBuiltinEntityId(entry.entity.id)) {
      continue;
    }

    if (!hasPlacementBehavior(entry.definition, PLACEMENT_BEHAVIOR_TYPE.mustConnectToHub)) {
      continue;
    }

    if (isConnectedToWarehouseHub({
      entry,
      sourceEntries,
      segmentEntries,
      validSegmentIds,
    })) {
      continue;
    }

    appendReason(
      options.reasonsByEntityId,
      entry.entity.id,
      "warehouse-bus-disconnected",
    );
  }

  for (const entry of options.entries) {
    if (isBaseBuiltinEntityId(entry.entity.id)) {
      continue;
    }

    if (!hasPlacementBehavior(entry.definition, PLACEMENT_BEHAVIOR_TYPE.mustConnectToHubViaOppositePortEdge)) {
      continue;
    }

    const requiredEdge = resolvePortOppositeWorldEdge(entry);
    if (requiredEdge === null) {
      appendReason(options.reasonsByEntityId, entry.entity.id, "warehouse-bus-disconnected");
      continue;
    }

    if (isEntryAdjacentToHubOnEdge({
      entry,
      edge: requiredEdge,
      sourceEntries,
      segmentEntries,
      validSegmentIds,
    })) {
      continue;
    }

    appendReason(
      options.reasonsByEntityId,
      entry.entity.id,
      "warehouse-bus-disconnected",
    );
  }
}

function resolvePortOppositeWorldEdge(
  entry: PlacementValidationEntry,
): GridEdge | null {
  const firstPortGroup = entry.definition.portGroups[0];
  if (firstPortGroup === undefined) {
    return null;
  }

  const firstPort = firstPortGroup.ports[0];
  if (firstPort === undefined) {
    return null;
  }

  // rotation=0 时端口边的对边
  const oppositeAtZero = oppositeGridEdge(firstPort.edge);
  // 按 entity rotation 旋转得到世界坐标中的边
  return rotateGridEdge(oppositeAtZero, entry.entity.rotation);
}

function isEntryAdjacentToHubOnEdge(options: {
  entry: PlacementValidationEntry;
  edge: GridEdge;
  sourceEntries: readonly PlacementValidationEntry[];
  segmentEntries: readonly PlacementValidationEntry[];
  validSegmentIds: ReadonlySet<string>;
}): boolean {
  const candidates = [
    ...options.sourceEntries,
    ...options.segmentEntries.filter(
      (seg) =>
        seg.entity.id !== options.entry.entity.id
        && options.validSegmentIds.has(seg.entity.id),
    ),
  ];

  return candidates.some((candidate) =>
    isEntryAdjacentOnEdge(options.entry, candidate, options.edge),
  );
}

function isEntryAdjacentOnEdge(
  entry: PlacementValidationEntry,
  candidate: PlacementValidationEntry,
  edge: GridEdge,
): boolean {
  const a = entry.gridRect;
  const b = candidate.gridRect;

  switch (edge) {
    case "NORTH":
      return a.y === b.y + b.height && overlapsX(a, b);
    case "SOUTH":
      return a.y + a.height === b.y && overlapsX(a, b);
    case "EAST":
      return a.x + a.width === b.x && overlapsY(a, b);
    case "WEST":
      return a.x === b.x + b.width && overlapsY(a, b);
  }
}

function overlapsX(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

function overlapsY(a: GridRect, b: GridRect): boolean {
  return a.y < b.y + b.height && a.y + a.height > b.y;
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

function resolveValidWarehouseBusSegmentIds(options: {
  sourceEntries: readonly PlacementValidationEntry[];
  segmentEntries: readonly PlacementValidationEntry[];
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>;
}): Set<string> {
  const validSegmentIds = new Set<string>();
  let didChange = true;

  while (didChange) {
    didChange = false;

    for (const segment of options.segmentEntries) {
      if (
        validSegmentIds.has(segment.entity.id)
        || !hasNoBasePlacementReason(options.reasonsByEntityId, segment.entity.id)
      ) {
        continue;
      }

      if (
        isEntryAdjacentToAny(segment, options.sourceEntries)
        || isEntryAdjacentToAny(
          segment,
          options.segmentEntries.filter((entry) => validSegmentIds.has(entry.entity.id)),
        )
      ) {
        validSegmentIds.add(segment.entity.id);
        didChange = true;
      }
    }
  }

  return validSegmentIds;
}

function isConnectedToWarehouseHub(options: {
  entry: PlacementValidationEntry;
  sourceEntries: readonly PlacementValidationEntry[];
  segmentEntries: readonly PlacementValidationEntry[];
  validSegmentIds: ReadonlySet<string>;
}): boolean {
  if (isEntryAdjacentToAny(options.entry, options.sourceEntries)) {
    return true;
  }

  return isEntryAdjacentToAny(
    options.entry,
    options.segmentEntries.filter((entry) =>
      entry.entity.id !== options.entry.entity.id
      && options.validSegmentIds.has(entry.entity.id),
    ),
  );
}

function hasNoBasePlacementReason(
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>,
  entityId: string,
): boolean {
  return !(reasonsByEntityId.get(entityId) ?? []).some((reason) =>
    reason.code === "outside-base" || reason.code === "overlap",
  );
}

function isEntryAdjacentToAny(
  entry: PlacementValidationEntry,
  candidates: readonly PlacementValidationEntry[],
): boolean {
  return candidates.some((candidate) =>
    candidate.entity.id !== entry.entity.id
    && areGridRectsEdgeAdjacent(entry.gridRect, candidate.gridRect),
  );
}

function appendReason(
  reasonsByEntityId: Map<string, EntityPlacementValidationReason[]>,
  entityId: string,
  code: EntityPlacementValidationReasonCode,
): void {
  const reasons = reasonsByEntityId.get(entityId);
  if (reasons === undefined || reasons.some((reason) => reason.code === code)) {
    return;
  }

  reasons.push({
    code,
    message: PLACEMENT_REASON_MESSAGES[code],
  });
}

function hasPlacementBehavior(
  definition: EntityDefinition,
  behaviorType: string,
): boolean {
  return definition.placementBehaviors?.some((behavior) => behavior.type === behaviorType) ?? false;
}

function isAllowedPipeOverlapPair(options: {
  left: PlacementValidationEntry;
  right: PlacementValidationEntry;
  registry: WorkspaceContract["registry"];
}): boolean {
  return (
    hasPlacementBehavior(options.left.definition, PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap)
    && isDedicatedPipeDefinition(options.right.definition, options.registry)
  ) || (
    hasPlacementBehavior(options.right.definition, PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap)
    && isDedicatedPipeDefinition(options.left.definition, options.registry)
  );
}

function isDedicatedPipeDefinition(
  definition: EntityDefinition,
  registry: WorkspaceContract["registry"],
): boolean {
  return registry.queries.resolveDedicatedLogisticsKind(definition.id) === "pipe";
}

function resolveCurrentBaseDefinition(options: {
  baseId: string;
  registry: WorkspaceContract["registry"];
}): BaseDefinition | null {
  return options.registry.baseDefinitions.find((definition) =>
    definition.id === options.baseId,
  ) ?? null;
}

function resolveEntityGridRect(options: {
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

function isGridRectContainedBy(container: GridRect, target: GridRect): boolean {
  return (
    target.x >= container.x
    && target.y >= container.y
    && target.x + target.width <= container.x + container.width
    && target.y + target.height <= container.y + container.height
  );
}

function areGridRectsIntersecting(left: GridRect, right: GridRect): boolean {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  );
}

function areGridRectsEdgeAdjacent(left: GridRect, right: GridRect): boolean {
  const touchesVerticalEdge =
    left.x + left.width === right.x || right.x + right.width === left.x;
  const overlapsY = left.y < right.y + right.height && left.y + left.height > right.y;
  if (touchesVerticalEdge && overlapsY) {
    return true;
  }

  const touchesHorizontalEdge =
    left.y + left.height === right.y || right.y + right.height === left.y;
  const overlapsX = left.x < right.x + right.width && left.x + left.width > right.x;
  return touchesHorizontalEdge && overlapsX;
}

/**
 * 返回设备定义所属的物流族标签，不存在则返回 null。
 * 用于判定两个设备是否为同一物流族（BeltFamily / PipeFamily），决定是否允许放置替换。
 */
function resolveLogisticsFamilyTag(
  definition: EntityDefinition,
): "belt" | "pipe" | null {
  if (definition.tags.includes("BeltFamily")) {
    return "belt";
  }

  if (definition.tags.includes("PipeFamily")) {
    return "pipe";
  }

  return null;
}

/**
 * 判定一对重叠实体是否为合法的物流放置替换。
 * 条件：
 *   1. 一方是 placement-draft 预览实体，另一方是 document 正式实体
 *   2. 双方属于同一物流族（BeltFamily / PipeFamily）
 *   3. 双方占据的 grid rect 完全相同
 * 满足以上条件时不报重叠错误，放置提交时由 applyPlacementDraft 执行实际替换。
 * 移动草稿（move-draft:）不满足条件 1，因此移动时仍然会报重叠。
 */
function isAllowedLogisticsPlacementReplacement(options: {
  left: PlacementValidationEntry;
  right: PlacementValidationEntry;
}): boolean {
  const leftIsPlacementDraft = options.left.entity.id.startsWith("placement-draft:");
  const rightIsPlacementDraft = options.right.entity.id.startsWith("placement-draft:");

  // 必须恰好一方是 placement draft
  if (leftIsPlacementDraft === rightIsPlacementDraft) {
    return false;
  }

  const leftFamily = resolveLogisticsFamilyTag(options.left.definition);
  const rightFamily = resolveLogisticsFamilyTag(options.right.definition);

  // 双方必须同族
  if (leftFamily === null || leftFamily !== rightFamily) {
    return false;
  }

  // grid rect 必须完全相同
  return areGridRectsEqual(options.left.gridRect, options.right.gridRect);
}

function areGridRectsEqual(left: GridRect, right: GridRect): boolean {
  return (
    left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
  );
}
