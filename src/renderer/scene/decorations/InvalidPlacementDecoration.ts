import {
  Container,
  Graphics,
  Text,
} from "pixi.js";

import {
  EntityCollectionType,
  type EntityPlacementValidationResult,
} from "@/domain/editor/types/editor-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridRect } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import {
  resolveMarqueeGridRectLayout,
  resolveWorldAuxiliaryStrokeWidth,
} from "./MarqueeRectDecoration";

const INVALID_PLACEMENT_COLOR = 0xff3b30;
const _INVALID_PLACEMENT_STROKE_ALPHA = 0.95;
const INVALID_PLACEMENT_TOAST_ALPHA = 0.88;
const INVALID_PLACEMENT_TOAST_TEXT_COLOR = 0xffffff;
const _INVALID_PLACEMENT_STROKE_WIDTH_SCALE = 1.35;
const INVALID_PLACEMENT_TOAST_HORIZONTAL_PADDING = 5;
const INVALID_PLACEMENT_TOAST_VERTICAL_PADDING = 3;
const INVALID_PLACEMENT_TOAST_TOP_OFFSET = 3;
const INVALID_PLACEMENT_TOAST_RADIUS = 4;

export function createInvalidPlacementDecoration(): DecorationLayer {
  const container = new Container();
  const graphics = new Graphics({ roundPixels: true });
  const reasonTexts = new Map<string, Text>();

  container.addChild(graphics);

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      measureDecorationStep(ctx, "invalidPlacement.clear", () => {
        graphics.clear();
      });

      const editor = ctx.renderHost.workspace.editor;
      if (editor === null) {
        hideUnusedReasonTexts(reasonTexts, new Set());
        return;
      }

      const invalidEntityIds = editor.state.collections[EntityCollectionType.invalidPlacement];
      ctx.profiler?.count("invalidPlacement.entityIds", invalidEntityIds.length);
      const activeTextEntityIds = new Set<string>();
      const entityDefinitionMap = measureDecorationStep(
        ctx,
        "invalidPlacement.buildDefinitionMap",
        () => new Map(
          ctx.renderHost.workspace.registry.entityDefinitions.map((definition) => [
            definition.id,
            definition,
          ]),
        ),
      );

      const previewCollection = editor.state.collections[EntityCollectionType.preview];

      measureDecorationStep(ctx, "invalidPlacement.syncEntities", () => {
        for (const entityId of invalidEntityIds) {
          // 预览阶段（拿起/拖拽放置中）不显示红色 invalid 边框和 toast，
          // 此时精灵层的白色扫描线 preview 特效已足够了。
          if (previewCollection?.contains(entityId)) {
            continue;
          }

          const entity = editor.queries.getEntityById(entityId);
          if (entity === null) {
            continue;
          }

          const definition = entityDefinitionMap.get(entity.definitionId);
          if (definition === undefined) {
            continue;
          }

          const gridRect = resolveEntityGridRect({
            entity,
            definition,
          });
          const layout = resolveMarqueeGridRectLayout({
            gridRect,
            viewportBounds: ctx.viewportBounds,
            viewportCenter: {
              x: ctx.viewportState.centerX,
              y: ctx.viewportState.centerY,
            },
            gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
            displayRotation: ctx.viewportState.displayRotation,
          });

          if (layout === null) {
            continue;
          }

          // AI-CORRECTION 2026-06-09:
          // Reason: 预览阶段（preview collection）的实体已由上述 continue 跳过，
          // 此处仅绘制已放下/已提交实体的 invalid 红色边框。
          // 原始注释（2026-05-24）未区分 preview 阶段，现已精简。
          drawInvalidPlacementStroke({
            graphics,
            layout,
            gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          });

          const reasonText = resolveInvalidPlacementToastReasonText({
            gridRect,
            validation: editor.queries.getEntityPlacementValidation(entityId),
          });
          if (reasonText === null || reasonText.length === 0) {
            continue;
          }

          const text = resolveReasonText({
            entityId,
            reasonTexts,
            container,
          });
          activeTextEntityIds.add(entityId);
          syncReasonToast({
            graphics,
            text,
            reasonText,
            layout,
            gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          });
        }
      });

      ctx.profiler?.count("invalidPlacement.activeTexts", activeTextEntityIds.size);
      ctx.profiler?.count("invalidPlacement.cachedTexts", reasonTexts.size);

      measureDecorationStep(ctx, "invalidPlacement.hideUnusedTexts", () => {
        hideUnusedReasonTexts(reasonTexts, activeTextEntityIds);
      });
    },

    destroy(): void {
      reasonTexts.clear();
      container.destroy({ children: true });
    },
  };
}

export function resolveInvalidPlacementToastReasonText(options: {
  validation: EntityPlacementValidationResult;
  gridRect: GridRect;
}): string | null {
  const primaryReason = options.validation.reasons[0];
  if (primaryReason === undefined) {
    return null;
  }

  if (primaryReason.code === "overlap" && isUnitGridRect(options.gridRect)) {
    return null;
  }

  return primaryReason.message;
}

// AI-RESTORED 2026-05-24:
// Reason: 用户要求已提交实体的 invalid placement 也显示红色边框。
function drawInvalidPlacementStroke(options: {
  graphics: Graphics;
  layout: { x: number; y: number; width: number; height: number };
  gridCellPixelSize: number;
}): void {
  const strokeWidth =
    resolveWorldAuxiliaryStrokeWidth(options.gridCellPixelSize)
    * _INVALID_PLACEMENT_STROKE_WIDTH_SCALE;
  const halfStrokeWidth = strokeWidth / 2;

  options.graphics
    .rect(
      options.layout.x + halfStrokeWidth,
      options.layout.y + halfStrokeWidth,
      Math.max(0, options.layout.width - strokeWidth),
      Math.max(0, options.layout.height - strokeWidth),
    )
    .stroke({
      width: strokeWidth,
      color: INVALID_PLACEMENT_COLOR,
      alpha: _INVALID_PLACEMENT_STROKE_ALPHA,
    });
}

function resolveReasonText(options: {
  entityId: string;
  reasonTexts: Map<string, Text>;
  container: Container;
}): Text {
  const existing = options.reasonTexts.get(options.entityId);
  if (existing !== undefined) {
    return existing;
  }

  const text = new Text({
    text: "",
    style: {
      fill: INVALID_PLACEMENT_TOAST_TEXT_COLOR,
      fontFamily: "system-ui, sans-serif",
      fontSize: 10,
      fontWeight: "600",
      align: "center",
      wordWrap: true,
      wordWrapWidth: 80,
      lineHeight: 12,
    },
  });
  text.anchor.set(0.5);
  text.roundPixels = true;
  options.container.addChild(text);
  options.reasonTexts.set(options.entityId, text);
  return text;
}

function syncReasonToast(options: {
  graphics: Graphics;
  text: Text;
  reasonText: string;
  layout: { x: number; y: number; width: number; height: number };
  gridCellPixelSize: number;
}): void {
  const maxToastWidth = Math.max(8, options.layout.width - INVALID_PLACEMENT_TOAST_TOP_OFFSET * 2);
  const fontSize = Math.max(
    6,
    Math.min(12, Math.floor(options.gridCellPixelSize * 0.2)),
  );
  const lineHeight = Math.ceil(fontSize * 1.16);

  options.text.text = options.reasonText;
  options.text.style = {
    fill: INVALID_PLACEMENT_TOAST_TEXT_COLOR,
    fontFamily: "system-ui, sans-serif",
    fontSize,
    fontWeight: "600",
    align: "center",
    wordWrap: true,
    wordWrapWidth: Math.max(4, maxToastWidth - INVALID_PLACEMENT_TOAST_HORIZONTAL_PADDING * 2),
    lineHeight,
  };

  const toastWidth = Math.min(
    maxToastWidth,
    Math.max(
      8,
      options.text.width + INVALID_PLACEMENT_TOAST_HORIZONTAL_PADDING * 2,
    ),
  );
  const toastHeight = Math.min(
    Math.max(8, options.layout.height),
    Math.max(
      lineHeight + INVALID_PLACEMENT_TOAST_VERTICAL_PADDING * 2,
      options.text.height + INVALID_PLACEMENT_TOAST_VERTICAL_PADDING * 2,
    ),
  );
  const toastX = options.layout.x + (options.layout.width - toastWidth) / 2;
  const toastY = options.layout.y + INVALID_PLACEMENT_TOAST_TOP_OFFSET;

  options.graphics
    .roundRect(
      toastX,
      toastY,
      toastWidth,
      toastHeight,
      Math.min(INVALID_PLACEMENT_TOAST_RADIUS, toastHeight / 2),
    )
    .fill({
      color: INVALID_PLACEMENT_COLOR,
      alpha: INVALID_PLACEMENT_TOAST_ALPHA,
    });

  options.text.x = toastX + toastWidth / 2;
  options.text.y = toastY + toastHeight / 2;
  options.text.visible = true;
}

function hideUnusedReasonTexts(
  reasonTexts: Map<string, Text>,
  activeEntityIds: ReadonlySet<string>,
): void {
  for (const [entityId, text] of reasonTexts) {
    if (activeEntityIds.has(entityId)) {
      continue;
    }

    text.visible = false;
  }
}

function resolveEntityGridRect(options: {
  entity: { position: { x: number; y: number }; rotation: 0 | 90 | 180 | 270 };
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

function isUnitGridRect(gridRect: GridRect): boolean {
  return gridRect.width === 1 && gridRect.height === 1;
}

function measureDecorationStep<T>(
  ctx: DecorationSyncContext,
  stage: string,
  callback: () => T,
): T {
  if (ctx.profiler === undefined) {
    return callback();
  }

  return ctx.profiler.measure(stage, callback);
}
