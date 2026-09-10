

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";

import { createLogger } from "@/shared/logging/logger";

import {
  areGridRectsIntersecting,
  resolveEntityGridRect,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";

import type { RegionalResourceSupplySetting } from "../contracts";

export const PLAYBACK_HOT_QUEUE_CAPACITY = 20;

export const PLAYBACK_HOT_QUEUE_LOW_WATER = 10;

export const logger = createLogger("simulation-runtime");

// AI-REMOVED 2026-08-28:
// Reason: 两个 helper 只服务已归档的应用层区域 tick 同步动作。
// Trigger: 用户明确要求当前及未来此类用例归入 Blueprint 测试组。
// Evidence: Active Code 中已不存在 resolveRegionalCommittedTickNumber 或 waitForRegionalDeadline 调用。
// Replacement: src/tests/simulation/regional-blueprint-runner.ts 内部推进与超时控制。
// Risk: Low
// Human Review: Required
//
// Original code:
// function resolveRegionalCommittedTickNumber(nextEpochNumber: number): number {
//   return nextEpochNumber <= 0 ? 0 : 1 + (nextEpochNumber - 1) * 10;
// }
//
// async function waitForRegionalDeadline<T>(
//   promise: Promise<T>,
//   deadline: number,
//   timeoutMessage: string,
// ): Promise<T> {
//   const remainingMs = deadline - Date.now();
//   if (remainingMs <= 0) {
//     throw new Error(timeoutMessage);
//   }
//
//   let timerId: ReturnType<typeof setTimeout> | null = null;
//   try {
//     return await Promise.race([
//       promise,
//       new Promise<never>((_resolve, reject) => {
//         timerId = setTimeout(() => reject(new Error(timeoutMessage)), remainingMs);
//       }),
//     ]);
//   } finally {
//     if (timerId !== null) {
//       clearTimeout(timerId);
//     }
//   }
// }

export function cloneWorldDocument(document: WorldDocument): WorldDocument {
  return JSON.parse(JSON.stringify(document)) as WorldDocument;
}

export function computePoweredEntityIds(options: {
  readonly document: WorldDocument;
  readonly registry: WorkspaceContract["registry"];
}): Set<string> {
  const definitionMap = new Map(
    options.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const entities = resolveOrderedDocumentEntities(options.document);
  const powerRangeRects = entities.flatMap((entity) => {
    const definition = definitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return [];
    }

    const gridRect = resolvePowerRangeGridRect({
      entity,
      definition,
    });

    return gridRect === null ? [] : [gridRect];
  });

  if (powerRangeRects.length === 0) {
    return new Set();
  }

  return new Set(entities.flatMap((entity) => {
    const definition = definitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return [];
    }

    const entityGridRect = resolveEntityGridRect({
      entity,
      definition,
    });
    return powerRangeRects.some((powerRangeRect) =>
      areGridRectsIntersecting(entityGridRect, powerRangeRect),
    ) ? [entity.id] : [];
  }));
}

export function resolveOrderedDocumentEntities(document: WorldDocument): WorldEntity[] {
  return document.entityOrder.flatMap((entityId) => {
    const entity = document.entities[entityId];

    return entity === undefined ? [] : [entity];
  });
}

export function normalizeActiveActivityIds(activityIds: readonly string[]): string[] {
  return [...new Set(activityIds)]
    .filter((activityId) => activityId.length > 0)
    .sort();
}

export function normalizeRegionalResourceSettings(
  settings: readonly RegionalResourceSupplySetting[],
): RegionalResourceSupplySetting[] {
  return [...settings]
    .map((setting) => ({
      itemId: setting.itemId,
      mode: setting.mode,
      perMinute: setting.perMinute,
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}
