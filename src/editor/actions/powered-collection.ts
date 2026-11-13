// AI-REMOVED 2026-11-12:
// Reason: 真实编辑源与只读源必须使用同一供电派生计算。
// Trigger: REQ-048 静态源不创建隐藏 Editor。
// Evidence: 原供电计算仅暴露写集合入口。
// Replacement: entity-power.ts 与下方薄同步入口。
// Risk: 供电渲染集合需回归。
// Human Review: Required
// Original code:
// import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
// import type { EditorServices } from "../editor-services";
// import { EntityCollectionType } from "@/domain/editor/types/editor-types";
// import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
// import {
//   areGridRectsIntersecting,
//   resolveEntityGridRect,
//   resolvePowerRangeGridRect,
// } from "@/shared/geometry/power-range";
//
// import { resolveListedEntities } from "../entity-resolvers";
// import type { EditorStateReadWrite } from "../state-impl";
//
// export function syncPoweredEntityCollection(options: {
//   document: WorldDocument;
//   state: EditorStateReadWrite;
//   workspace: EditorServices;
// }): void {
//   const definitionMap = new Map(
//     options.workspace.registry.entityDefinitions.map((definition) => [
//       definition.id,
//       definition,
//     ]),
//   );
//   const entities = resolveOrderedDocumentEntities({
//     document: options.document,
//     workspace: options.workspace,
//   });
//   const powerRangeRects = entities.flatMap((entity) => {
//     const definition = definitionMap.get(entity.definitionId);
//     if (definition === undefined) {
//       return [];
//     }
//
//     const gridRect = resolvePowerRangeGridRect({
//       entity,
//       definition,
//     });
//
//     return gridRect === null ? [] : [gridRect];
//   });
//
//   if (powerRangeRects.length === 0) {
//     options.state.collections[EntityCollectionType.powered].replace([]);
//     return;
//   }
//
//   const poweredEntityIds = entities.flatMap((entity) => {
//     const definition = definitionMap.get(entity.definitionId);
//     if (definition === undefined) {
//       return [];
//     }
//
//     return isEntityInPowerRange({
//       entity,
//       definition,
//       powerRangeRects,
//     }) ? [entity.id] : [];
//   });
//
//   options.state.collections[EntityCollectionType.powered].replace(poweredEntityIds);
// }
//
// function resolveOrderedDocumentEntities(options: {
//   document: WorldDocument;
//   workspace: EditorServices;
// }): readonly WorldEntity[] {
//   return resolveListedEntities({
//     document: options.document,
//     drafts: [],
//     baseDefinitions: options.workspace.registry.baseDefinitions,
//   });
// }
//
// function isEntityInPowerRange(options: {
//   entity: WorldEntity;
//   definition: EntityDefinition;
//   powerRangeRects: readonly ReturnType<typeof resolveEntityGridRect>[];
// }): boolean {
//   const entityGridRect = resolveEntityGridRect({
//     entity: options.entity,
//     definition: options.definition,
//   });
//
//   return options.powerRangeRects.some((powerRangeRect) =>
//     areGridRectsIntersecting(entityGridRect, powerRangeRect),
//   );
// }

import type { WorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EditorServices } from "../editor-services";
import type { EditorStateReadWrite } from "../state-impl";
import { resolveListedEntities } from "../entity-resolvers";
import { resolvePoweredEntityIds } from "../entity-power";

export function syncPoweredEntityCollection(options: {
  document: WorldDocument;
  state: EditorStateReadWrite;
  workspace: EditorServices;
}): void {
  const entities = resolveListedEntities({ document: options.document, drafts: [],
    baseDefinitions: options.workspace.includeBaseBuiltins === false ? [] : options.workspace.registry.baseDefinitions });
  options.state.collections[EntityCollectionType.powered].replace([...resolvePoweredEntityIds(entities, options.workspace.registry)]);
}
