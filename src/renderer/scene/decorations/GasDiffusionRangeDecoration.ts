import { Graphics } from "pixi.js";

import type { WorldEntity } from "@/domain/document/world-document";
import type { GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { SimulationGasDiffusionRangeReadModel } from "@/domain/simulation/types/simulation-types";
import {
  areGridRectsIntersecting,
  resolveGasDiffusionRangeGridRect,
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

const GAS_RANGE_STROKE_ALPHA = 0.86;
const GAS_RANGE_FILL_ALPHA = 0.07;
const GAS_RANGE_STROKE_WIDTH_SCALE = 1.1;
/** 预览模式（无活跃气体环境）描边透明度 */
const GAS_RANGE_PREVIEW_STROKE_ALPHA = 0.55;
/** 预览模式线条宽度倍率，与供电桩范围线同级 */
const GAS_RANGE_PREVIEW_STROKE_WIDTH_SCALE = 1.0;
const DEFAULT_GAS_RANGE_COLOR = 0xa8e6ff;
/** 预览模式（无活跃气体环境）范围框颜色 */
const GAS_RANGE_PREVIEW_COLOR = 0x66cc66;
const GAS_COLOR_TAG_PREFIX = "gas_color:";
const FLUID_COLOR_TAG_PREFIX = "fluid_color:";
const LIQUID_COLOR_TAG_PREFIX = "liquid_color:";

export function createGasDiffusionRangeDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });
  let cachedItemDefinitions: readonly ItemDefinition[] | null = null;
  let cachedItemById: ReadonlyMap<string, ItemDefinition> = new Map();
  let cachedGasDiffusions: readonly SimulationGasDiffusionRangeReadModel[] | null = null;
  let cachedViewportLayoutState: GasDiffusionViewportLayoutState | null = null;
  let cachedPreviewStamp: GasDiffusionPreviewStamp | null = null;
  let graphicsHasContent = false;

  // ---- 活跃气体范围渲染（实色，仿真中） ----

  function syncActiveGasRanges(
    ctx: DecorationSyncContext,
    activeGasDiffusions: readonly SimulationGasDiffusionRangeReadModel[],
  ): void {
    const itemDefinitions = ctx.renderHost.workspace.registry.itemDefinitions ?? [];
    const itemDefinitionsChanged = cachedItemDefinitions !== itemDefinitions;
    const gasDiffusionsChanged = !haveSameGasDiffusionRanges(
      cachedGasDiffusions,
      activeGasDiffusions,
    );
    const viewportChanged = !hasSameGasDiffusionViewportLayout(
      cachedViewportLayoutState,
      ctx,
    );
    if (!itemDefinitionsChanged && !gasDiffusionsChanged && !viewportChanged) {
      return;
    }

    // AI-CORRECTION 2026-07-17：物品定义在会话内稳定，仅在引用变化时重建颜色查询索引。
    if (itemDefinitionsChanged) {
      cachedItemDefinitions = itemDefinitions;
      cachedItemById = new Map(itemDefinitions.map((item) => [item.id, item]));
    }

    if (graphicsHasContent) {
      graphics.clear();
      graphicsHasContent = false;
    }

    const visibleGridRect = visibleWorldRectToGridRect(
      resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds, 0),
    );
    const strokeWidth =
      resolveWorldAuxiliaryStrokeWidth(ctx.viewportState.gridCellPixelSize)
      * GAS_RANGE_STROKE_WIDTH_SCALE;

    for (const range of activeGasDiffusions) {
      if (!areGridRectsIntersecting(range.gridRect, visibleGridRect)) {
        continue;
      }

      const layout = resolveMarqueeGridRectLayout({
        gridRect: range.gridRect,
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

      const color = resolveGasRangeColor(cachedItemById.get(range.gasItemId) ?? null);
      graphics
        .rect(layout.x, layout.y, layout.width, layout.height)
        .fill({
          color,
          alpha: GAS_RANGE_FILL_ALPHA,
        })
        .stroke({
          width: strokeWidth,
          color,
          alpha: GAS_RANGE_STROKE_ALPHA,
        });
      graphicsHasContent = true;
    }

    cachedGasDiffusions = activeGasDiffusions;
    cachedViewportLayoutState = captureGasDiffusionViewportLayoutState(ctx);
    cachedPreviewStamp = null;
  }

  // ---- 预览气体范围渲染（半透明，无仿真/无活跃气体时） ----

  function syncPreviewGasRanges(ctx: DecorationSyncContext): void {
    const editor = ctx.renderHost.workspace.editor;
    if (!editor) {
      if (graphicsHasContent) {
        graphics.clear();
        graphicsHasContent = false;
      }
      cachedGasDiffusions = null;
      cachedViewportLayoutState = null;
      cachedPreviewStamp = null;
      return;
    }

    const entityDefinitionMap = buildEditorEntityDefinitionMap(
      ctx.renderHost.workspace.registry.entityDefinitions,
    );
    const gasDiffusionRangeByMachineId = buildGasDiffusionRangeByMachineId(
      ctx.renderHost.workspace.registry.recipeDefinitions,
    );

    const entities = editor.queries.listEntities();
    const previewRanges = resolveEditorGasPreviewRanges(
      entities,
      entityDefinitionMap,
      gasDiffusionRangeByMachineId,
    );

    if (previewRanges.length === 0) {
      if (graphicsHasContent) {
        graphics.clear();
        graphicsHasContent = false;
      }
      cachedGasDiffusions = null;
      cachedViewportLayoutState = null;
      cachedPreviewStamp = null;
      return;
    }

    const nextStamp = captureGasDiffusionPreviewStamp(entities, ctx);
    if (
      cachedPreviewStamp !== null
      && haveSamePreviewStamp(cachedPreviewStamp, nextStamp)
    ) {
      return;
    }

    if (graphicsHasContent) {
      graphics.clear();
      graphicsHasContent = false;
    }

    const visibleGridRect = visibleWorldRectToGridRect(
      resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds, 0),
    );
    const strokeWidth =
      resolveWorldAuxiliaryStrokeWidth(ctx.viewportState.gridCellPixelSize)
      * GAS_RANGE_PREVIEW_STROKE_WIDTH_SCALE;

    for (const range of previewRanges) {
      if (!areGridRectsIntersecting(range.gridRect, visibleGridRect)) {
        continue;
      }

      const layout = resolveMarqueeGridRectLayout({
        gridRect: range.gridRect,
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

      graphics
        .rect(layout.x, layout.y, layout.width, layout.height)
        .stroke({
          width: strokeWidth,
          color: GAS_RANGE_PREVIEW_COLOR,
          alpha: GAS_RANGE_PREVIEW_STROKE_ALPHA,
        });
      graphicsHasContent = true;
    }

    cachedGasDiffusions = null;
    cachedViewportLayoutState = null;
    cachedPreviewStamp = nextStamp;
  }

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const simulation = ctx.renderHost.workspace.simulation;
      const activeGasDiffusions = simulation?.queries.getActiveGasDiffusionRanges() ?? [];

      if (activeGasDiffusions.length > 0) {
        syncActiveGasRanges(ctx, activeGasDiffusions);
        return;
      }

      syncPreviewGasRanges(ctx);
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}

interface GasDiffusionPreviewStamp {
  readonly entityCount: number;
  readonly entityVersion: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly gridCellPixelSize: number;
  readonly displayRotation: DecorationSyncContext["viewportState"]["displayRotation"];
}

interface EditorGasPreviewRange {
  readonly gridRect: GridRect;
}

interface GasDiffusionViewportLayoutState {
  readonly centerX: number;
  readonly centerY: number;
  readonly gridCellPixelSize: number;
  readonly displayRotation: DecorationSyncContext["viewportState"]["displayRotation"];
  readonly viewportLeft: number;
  readonly viewportTop: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

function buildEditorEntityDefinitionMap(
  definitions: readonly EntityDefinition[],
): ReadonlyMap<string, EntityDefinition> {
  return new Map(definitions.map((d) => [d.id, d]));
}

function resolveEditorGasPreviewRanges(
  entities: readonly WorldEntity[],
  definitionMap: ReadonlyMap<string, EntityDefinition>,
  gasDiffusionRangeByMachineId: ReadonlyMap<string, number>,
): EditorGasPreviewRange[] {
  const ranges: EditorGasPreviewRange[] = [];

  for (const entity of entities) {
    const definition = definitionMap.get(entity.definitionId);
    if (!definition) {
      continue;
    }
    const gasDiffusionRange = gasDiffusionRangeByMachineId.get(definition.id);
    if (gasDiffusionRange === undefined) {
      continue;
    }

    const gridRect = resolveGasDiffusionRangeGridRect({
      entity,
      definition,
      gasDiffusionRange,
    });
    if (gridRect === null) {
      continue;
    }

    ranges.push({ gridRect });
  }

  return ranges;
}

function buildGasDiffusionRangeByMachineId(
  recipes:
    | DecorationSyncContext["renderHost"]["workspace"]["registry"]["recipeDefinitions"]
    | undefined,
): ReadonlyMap<string, number> {
  const ranges = new Map<string, number>();
  for (const recipe of recipes ?? []) {
    const output = recipe.gasDiffusionOutput;
    if (output === undefined || output.range <= 0) {
      continue;
    }
    ranges.set(recipe.machineId, Math.max(ranges.get(recipe.machineId) ?? 0, output.range));
  }
  return ranges;
}

function captureGasDiffusionPreviewStamp(
  entities: readonly WorldEntity[],
  ctx: DecorationSyncContext,
): GasDiffusionPreviewStamp {
  let entityVersion = 0;
  for (const entity of entities) {
    // 基于位置与定义 ID 的简单哈希，用于检测实体变更
    entityVersion += entity.position.x * 31
      + entity.position.y * 37
      + hashString(entity.definitionId)
      + entity.rotation * 41;
  }

  return {
    entityCount: entities.length,
    entityVersion,
    centerX: ctx.viewportState.centerX,
    centerY: ctx.viewportState.centerY,
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
  };
}

function haveSamePreviewStamp(
  left: GasDiffusionPreviewStamp,
  right: GasDiffusionPreviewStamp,
): boolean {
  return left.entityCount === right.entityCount
    && left.entityVersion === right.entityVersion
    && left.centerX === right.centerX
    && left.centerY === right.centerY
    && left.gridCellPixelSize === right.gridCellPixelSize
    && left.displayRotation === right.displayRotation;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash;
}

export function haveSameGasDiffusionRanges(
  left: readonly SimulationGasDiffusionRangeReadModel[] | null,
  right: readonly SimulationGasDiffusionRangeReadModel[],
): boolean {
  if (left === null || left.length !== right.length) {
    return false;
  }

  return left.every((leftRange, index) => {
    const rightRange = right[index];
    return rightRange !== undefined
      && leftRange.sourceDeviceId === rightRange.sourceDeviceId
      && leftRange.gasItemId === rightRange.gasItemId
      && leftRange.gridRect.x === rightRange.gridRect.x
      && leftRange.gridRect.y === rightRange.gridRect.y
      && leftRange.gridRect.width === rightRange.gridRect.width
      && leftRange.gridRect.height === rightRange.gridRect.height;
  });
}

function hasSameGasDiffusionViewportLayout(
  cached: GasDiffusionViewportLayoutState | null,
  ctx: DecorationSyncContext,
): boolean {
  return cached !== null
    && cached.centerX === ctx.viewportState.centerX
    && cached.centerY === ctx.viewportState.centerY
    && cached.gridCellPixelSize === ctx.viewportState.gridCellPixelSize
    && cached.displayRotation === ctx.viewportState.displayRotation
    && cached.viewportLeft === ctx.viewportBounds.left
    && cached.viewportTop === ctx.viewportBounds.top
    && cached.viewportWidth === ctx.viewportBounds.width
    && cached.viewportHeight === ctx.viewportBounds.height;
}

function captureGasDiffusionViewportLayoutState(
  ctx: DecorationSyncContext,
): GasDiffusionViewportLayoutState {
  return {
    centerX: ctx.viewportState.centerX,
    centerY: ctx.viewportState.centerY,
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
    viewportLeft: ctx.viewportBounds.left,
    viewportTop: ctx.viewportBounds.top,
    viewportWidth: ctx.viewportBounds.width,
    viewportHeight: ctx.viewportBounds.height,
  };
}

function resolveGasRangeColor(item: ItemDefinition | null): number {
  const colorTag = item?.tags.find((tag) =>
    tag.startsWith(GAS_COLOR_TAG_PREFIX)
    || tag.startsWith(FLUID_COLOR_TAG_PREFIX)
    || tag.startsWith(LIQUID_COLOR_TAG_PREFIX)
  );
  if (colorTag === undefined) {
    return DEFAULT_GAS_RANGE_COLOR;
  }

  const prefix = resolveColorTagPrefix(colorTag);
  if (prefix === null) {
    return DEFAULT_GAS_RANGE_COLOR;
  }

  const normalizedHex = colorTag
    .slice(prefix.length)
    .trim()
    .replace(/^#/, "");

  if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
    return DEFAULT_GAS_RANGE_COLOR;
  }

  return Number.parseInt(normalizedHex, 16);
}

function resolveColorTagPrefix(tag: string): string | null {
  if (tag.startsWith(GAS_COLOR_TAG_PREFIX)) {
    return GAS_COLOR_TAG_PREFIX;
  }
  if (tag.startsWith(FLUID_COLOR_TAG_PREFIX)) {
    return FLUID_COLOR_TAG_PREFIX;
  }
  if (tag.startsWith(LIQUID_COLOR_TAG_PREFIX)) {
    return LIQUID_COLOR_TAG_PREFIX;
  }
  return null;
}

function visibleWorldRectToGridRect(visibleWorldRect: VisibleWorldRect): GridRect {
  return {
    x: visibleWorldRect.left,
    y: visibleWorldRect.top,
    width: visibleWorldRect.right - visibleWorldRect.left,
    height: visibleWorldRect.bottom - visibleWorldRect.top,
  };
}
