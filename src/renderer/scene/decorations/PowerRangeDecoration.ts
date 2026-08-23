import { Graphics } from "pixi.js";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridRect, GridRotation } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveBatchMoveHiddenRangeEntityIds } from "@/renderer/move-visual-policy";
import {
  areGridRectsIntersecting,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import {
  resolveVisibleWorldRect,
  type VisibleWorldRect,
} from "./BeltVisualGeometry";
import {
  resolveMarqueeGridRectLayout,
  resolveWorldAuxiliaryStrokeWidth,
} from "./MarqueeRectDecoration";

const POWER_RANGE_STROKE_COLOR = 0x87ceeb;
const POWER_RANGE_STROKE_ALPHA = 0.8;
const POWER_RANGE_STROKE_WIDTH_SCALE = 1.15;

export interface PowerRangeOutlineLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function resolvePowerRangeStrokeWidth(
  gridCellPixelSize: number,
): number {
  return resolveWorldAuxiliaryStrokeWidth(gridCellPixelSize)
    * POWER_RANGE_STROKE_WIDTH_SCALE;
}

export function resolvePowerRangeOutlineLayouts(options: {
  entities: readonly WorldEntity[];
  hiddenEntityIds?: ReadonlySet<string>;
  visibleEntityIds?: ReadonlySet<string> | null;
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  visibleWorldRect: VisibleWorldRect;
  viewportBounds: DecorationSyncContext["viewportBounds"];
  viewportCenter: {
    x: number;
    y: number;
  };
  gridCellPixelSize: number;
  displayRotation?: GridRotation;
}): PowerRangeOutlineLayout[] {
  const visibleGridRect = visibleWorldRectToGridRect(options.visibleWorldRect);
  const layouts: PowerRangeOutlineLayout[] = [];

  for (const entity of options.entities) {
    if (options.visibleEntityIds !== undefined
      && options.visibleEntityIds !== null
      && !options.visibleEntityIds.has(entity.id)) {
      continue;
    }

    if (options.hiddenEntityIds?.has(entity.id) === true) {
      continue;
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    const powerRangeGridRect = resolvePowerRangeGridRect({
      entity,
      definition,
    });

    if (powerRangeGridRect === null
      || !areGridRectsIntersecting(powerRangeGridRect, visibleGridRect)) {
      continue;
    }

    const layout = resolveMarqueeGridRectLayout({
      gridRect: powerRangeGridRect,
      viewportBounds: options.viewportBounds,
      viewportCenter: options.viewportCenter,
      gridCellPixelSize: options.gridCellPixelSize,
      displayRotation: options.displayRotation,
    });

    if (layout === null) {
      continue;
    }

    layouts.push(layout);
  }

  return layouts;
}

export function createPowerRangeDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      // AI-REMOVED 2026-08-22:
      // Reason: 批量移动不应关闭整个供电范围图层，只应隐藏被移动设备自身的范围。
      // Trigger: 未被多选选中的供电桩范围也被一并清除。
      // Evidence: move draft 已通过 ghost 与 preview collection 精确记录原实体和移动草稿 ID。
      // Replacement: 当前 sync 中使用 resolveBatchMoveHiddenRangeEntityIds 过滤实体。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (isBatchMove(ctx.renderHost.workspace.app?.state.moveKind ?? null)) {
      //   return;
      // }

      const editor = ctx.renderHost.workspace.editor;
      if (!editor) {
        return;
      }

      const collections = editor.state.collections;
      const hiddenEntityIds = resolveBatchMoveHiddenRangeEntityIds(
        ctx.renderHost.workspace.app?.state.moveKind ?? null,
        collections[EntityCollectionType.preview],
        collections[EntityCollectionType.ghost],
      );

      const entityDefinitionMap = new Map(
        ctx.renderHost.workspace.registry.entityDefinitions.map((definition) => [
          definition.id,
          definition,
        ]),
      );
      const layouts = resolvePowerRangeOutlineLayouts({
        entities: editor.queries.listEntities(),
        hiddenEntityIds,
        visibleEntityIds:
          ctx.powerInteractionVisualState?.visiblePowerRangeEntityIds ?? null,
        entityDefinitionMap,
        visibleWorldRect: resolveVisibleWorldRect(
          ctx.viewportState,
          ctx.viewportBounds,
          0,
        ),
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
        displayRotation: ctx.viewportState.displayRotation,
      });

      for (const layout of layouts) {
        graphics
          .rect(layout.x, layout.y, layout.width, layout.height)
          .stroke({
            width: resolvePowerRangeStrokeWidth(ctx.viewportState.gridCellPixelSize),
            color: POWER_RANGE_STROKE_COLOR,
            alpha: POWER_RANGE_STROKE_ALPHA,
          });
      }
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}

function visibleWorldRectToGridRect(visibleWorldRect: VisibleWorldRect): GridRect {
  return {
    x: visibleWorldRect.left,
    y: visibleWorldRect.top,
    width: visibleWorldRect.right - visibleWorldRect.left,
    height: visibleWorldRect.bottom - visibleWorldRect.top,
  };
}
