import type { CanvasInteractionController } from "@/app/canvas";
// AI-REMOVED 2026-11-12:
// Reason: Canvas/Editor/Registry 均为完整真实契约，不再探测旧可选结构。
// Trigger: REQ-048 统一场景交互。
// Evidence: 当前 EditorQuery 必须实现 listEntities；本函数只接受 CanvasInteractionController。
// Replacement: CanvasInteractionController
// Risk: 不支持伪造残缺主机；测试需组合真实会话。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridPoint } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { isLogisticsDefinitionSuppressed } from "@/shared/logistics-suppression";

type EntityCandidateFilter = (entity: WorldEntity) => boolean;

export function resolveOverlappingEntityCandidatesAtClientPoint(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  pointerEntity: WorldEntity | null;
  filterCandidate?: EntityCandidateFilter;
}): readonly WorldEntity[] {
// AI-REMOVED 2026-11-12:
// Reason: Canvas/Editor/Registry 均为完整真实契约，不再探测旧可选结构。
// Trigger: REQ-048 统一场景交互。
// Evidence: 当前 EditorQuery 必须实现 listEntities；本函数只接受 CanvasInteractionController。
// Replacement: options.editor.queries.listEntities
// Risk: 不支持伪造残缺主机；测试需组合真实会话。
// Human Review: Required
// Original code:
//   const listEntities = resolveListEntitiesFn(options.editor);
//   if (listEntities === null) {
//     return options.pointerEntity !== null
//       && !isSuppressedLogisticsEntity(options.canvas, options.pointerEntity.definitionId)
//       && (options.filterCandidate?.(options.pointerEntity) ?? true)
//       ? [options.pointerEntity]
//       : [];
//   }
//
  const gridCell = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
  if (gridCell === null) {
    return [];
  }

// AI-REMOVED 2026-11-12:
// Reason: Canvas/Editor/Registry 均为完整真实契约，不再探测旧可选结构。
// Trigger: REQ-048 统一场景交互。
// Evidence: 当前 EditorQuery 必须实现 listEntities；本函数只接受 CanvasInteractionController。
// Replacement: options.canvas.registry.entityDefinitions
// Risk: 不支持伪造残缺主机；测试需组合真实会话。
// Human Review: Required
// Original code:
//   const entityDefinitions = resolveEntityDefinitions(options.canvas);
//   if (entityDefinitions === null) {
//     return options.pointerEntity !== null
//       && !isSuppressedLogisticsEntity(options.canvas, options.pointerEntity.definitionId)
//       && (options.filterCandidate?.(options.pointerEntity) ?? true)
//       ? [options.pointerEntity]
//       : [];
//   }
//
  const entityDefinitions = options.canvas.registry.entityDefinitions;
  const entityDefinitionMap = new Map(
    entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const listedEntities = options.editor.queries.listEntities();
  const candidates: WorldEntity[] = [];

  for (let index = listedEntities.length - 1; index >= 0; index -= 1) {
    const entity = listedEntities[index];
    if (entity === undefined || !(options.filterCandidate?.(entity) ?? true)) {
      continue;
    }

    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    if (!isGridCellInsideEntity({ cell: gridCell, entity, footprint: definition.footprint })) {
      continue;
    }

    if (isSuppressedLogisticsEntity(options.canvas, entity.definitionId)) {
      continue;
    }

    candidates.push(entity);
  }

  return candidates;
}

export function openOverlapEntityMenuIfNeeded(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  pointerEntity: WorldEntity | null;
  filterCandidate?: EntityCandidateFilter;
  onSelect: (entity: WorldEntity) => void;
}): boolean {
  if (resolveOverlapEntityMenu(options.canvas) === null) {
    return false;
  }

  const candidates = resolveOverlappingEntityCandidatesAtClientPoint(options);
  return openOverlapEntityMenuForCandidates({
    canvas: options.canvas,
    editor: options.editor,
    position: options.position,
    candidates,
    onSelect: options.onSelect,
  });
}

export function openOverlapEntityMenuForCandidates(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
  position: GesturePosition;
  candidates: readonly WorldEntity[];
  onSelect: (entity: WorldEntity) => void;
}): boolean {
  const menu = resolveOverlapEntityMenu(options.canvas);
  if (menu === null) {
    return false;
  }

  const candidates = options.candidates;
  if (candidates.length <= 1) {
    return false;
  }

  menu.open({
    position: options.position,
    candidates: candidates.map((entity) => ({
      entityId: entity.id,
      definitionId: entity.definitionId,
    })),
    onSelect: (entityId) => {
      const entity = options.editor.queries.getEntityById(entityId);
      if (entity === null) {
        return;
      }

      options.onSelect(entity);
    },
  });

  return true;
}

// AI-REMOVED 2026-11-12:
// Reason: 按画布读取真实交互对象，退出旧工作台结构探测。
// Trigger: REQ-048 D7。
// Evidence: CanvasInteractionController 明确持有相机、菜单与状态。
// Replacement: canvas.overlapEntityMenu
// Risk: Low
// Human Review: Required
// Original code:
// function resolveOverlapEntityMenu(
//   canvas: CanvasInteractionController,
// ): AppHost["overlapEntityMenu"] | null {
//   const candidate = (canvas as AppHost & {
//     overlapEntityMenu?: AppHost["overlapEntityMenu"];
//   }).overlapEntityMenu;
//
//   return candidate !== undefined && typeof candidate.open === "function"
//     ? candidate
//     : null;
// }
function resolveOverlapEntityMenu(canvas: CanvasInteractionController) { return canvas.overlapEntityMenu; }

// AI-REMOVED 2026-11-12:
// Reason: Canvas/Editor/Registry 均为完整真实契约，不再探测旧可选结构。
// Trigger: REQ-048 统一场景交互。
// Evidence: 当前 EditorQuery 必须实现 listEntities；本函数只接受 CanvasInteractionController。
// Replacement: 完整 Canvas/Editor 契约
// Risk: 不支持伪造残缺主机；测试需组合真实会话。
// Human Review: Required
// Original code:
// function resolveEntityDefinitions(canvas: CanvasInteractionController): readonly EntityDefinition[] | null {
//   const registry = canvas.registry as AppHost["workspace"]["registry"] & {
//     entityDefinitions?: readonly EntityDefinition[];
//   };
//
//   return Array.isArray(registry.entityDefinitions) ? registry.entityDefinitions : null;
// }
//
// function resolveListEntitiesFn(
//   editor: EditorContract,
// ): (() => readonly WorldEntity[]) | null {
//   const queries = (editor as EditorContract & {
//     queries?: EditorContract["queries"] & {
//       listEntities?: () => readonly WorldEntity[];
//     };
//   }).queries;
//
//   if (queries === undefined) {
//     return null;
//   }
//
//   const queriesWithList = queries as EditorContract["queries"] & {
//     listEntities?: () => readonly WorldEntity[];
//   };
//
//   return typeof queriesWithList.listEntities === "function" ? queriesWithList.listEntities : null;
// }

function isSuppressedLogisticsEntity(
  canvas: CanvasInteractionController,
  definitionId: string,
): boolean {
  const editor = canvas.editor;
  if (editor === null) {
    return false;
  }

  return isLogisticsDefinitionSuppressed({
    definitionId,
    suppressBelts: editor.state.suppressBelts,
    suppressPipes: editor.state.suppressPipes,
    queries: canvas.registry.queries,
  });
}

function isGridCellInsideEntity(options: {
  cell: GridPoint;
  entity: WorldEntity;
  footprint: EntityDefinition["footprint"];
}): boolean {
  const footprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  );

  return (
    options.cell.x >= options.entity.position.x
    && options.cell.x < options.entity.position.x + footprint.width
    && options.cell.y >= options.entity.position.y
    && options.cell.y < options.entity.position.y + footprint.height
  );
}
