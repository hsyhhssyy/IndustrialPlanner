// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/topology/document-preparation.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";
// import type { WorldDocument } from "@/domain/document/world-document";
// import { EntityCollectionType } from "@/domain/editor/types/editor-types";
// import { resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";
//
// export function prepareCurrentSimulationDocument(options: {
//   readonly document: WorldDocument;
//   readonly workspace: WorkspaceContract;
// }): WorldDocument {
//   const invalidPlacementCollection =
//     options.workspace.editor?.state?.collections?.[EntityCollectionType.invalidPlacement];
//   if (invalidPlacementCollection === undefined || invalidPlacementCollection.length === 0) {
//     return appendSimulationBaseBuiltinEntities(options);
//   }
//
//   const invalidEntityIds = new Set(
//     invalidPlacementCollection.filter((entityId) =>
//       options.document.entities[entityId] !== undefined,
//     ),
//   );
//   if (invalidEntityIds.size === 0) {
//     return appendSimulationBaseBuiltinEntities(options);
//   }
//
//   const nextEntities = { ...options.document.entities };
//   for (const entityId of invalidEntityIds) {
//     delete nextEntities[entityId];
//   }
//
//   return appendSimulationBaseBuiltinEntities({
//     workspace: options.workspace,
//     document: {
//       ...options.document,
//       entities: nextEntities,
//       entityOrder: options.document.entityOrder.filter((entityId) =>
//         !invalidEntityIds.has(entityId),
//       ),
//       slotLinks: options.document.slotLinks.filter((slotLink) =>
//         !invalidEntityIds.has(slotLink.source.entityId)
//         && !invalidEntityIds.has(slotLink.target.entityId),
//       ),
//     },
//   });
// }
//
// export function appendSimulationBaseBuiltinEntities(options: {
//   readonly document: WorldDocument;
//   readonly workspace: WorkspaceContract;
// }): WorldDocument {
//   const builtinEntities = resolveBaseBuiltinEntities({
//     baseDefinitions: options.workspace.registry.baseDefinitions,
//     baseId: options.document.baseId,
//   });
//   if (builtinEntities.length === 0) {
//     return options.document;
//   }
//
//   const builtinEntityIds = new Set(builtinEntities.map((entity) => entity.id));
//   const nextEntities = { ...options.document.entities };
//   for (const entity of builtinEntities) {
//     nextEntities[entity.id] = entity;
//   }
//
//   return {
//     ...options.document,
//     entities: nextEntities,
//     entityOrder: [
//       ...builtinEntities.map((entity) => entity.id),
//       ...options.document.entityOrder.filter((entityId) => !builtinEntityIds.has(entityId)),
//     ],
//   };
// }
//
