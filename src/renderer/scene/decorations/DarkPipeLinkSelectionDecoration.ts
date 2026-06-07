import { Graphics } from "pixi.js";

import { DARK_PIPE_LINK_TOOL } from "@/shared/dark-pipe-link";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import {
  buildEntityDefinitionMap,
  resolveEntityViewportRect,
  type ViewportRect,
} from "./DarkPipeLinkGeometry";

const DARK_PIPE_SELECTION_MASK_ALPHA = 0.72;
const DARK_PIPE_SELECTION_HOLE_PADDING = 4;
const DARK_PIPE_SELECTION_STROKE_ALPHA = 0.92;

export function createDarkPipeLinkSelectionDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      const app = ctx.renderHost.workspace.app;
      const editor = ctx.renderHost.workspace.editor;
      if (app === null || editor === null) {
        return;
      }
      if (app.state.activeTool !== DARK_PIPE_LINK_TOOL || app.state.toolInfo.darkPipeLink === null) {
        return;
      }

      const documentSnapshot = editor.document?.getSnapshot?.() ?? null;
      if (documentSnapshot === null) {
        return;
      }
      const definitionMap = buildEntityDefinitionMap(ctx.renderHost.workspace.registry.entityDefinitions);
      const highlightedEntityIds = new Set([
        app.state.toolInfo.darkPipeLink.sourceEntityId,
        ...app.state.toolInfo.darkPipeLink.candidateEntityIds,
      ]);
      const candidateEntityIds = new Set(app.state.toolInfo.darkPipeLink.candidateEntityIds);
      const holes: ViewportRect[] = [];

      for (const entityId of highlightedEntityIds) {
        const entity = documentSnapshot.entities[entityId];
        if (entity === undefined) {
          continue;
        }

        const definition = definitionMap.get(entity.definitionId);
        if (definition === undefined) {
          continue;
        }

        const rect = resolveEntityViewportRect({ ctx, entity, definition });
        if (rect === null) {
          continue;
        }

        const clipped = expandAndClipRect(rect, ctx.viewportBounds, DARK_PIPE_SELECTION_HOLE_PADDING);
        if (clipped !== null) {
          holes.push(clipped);
        }
      }

      drawMaskWithHoles({
        graphics,
        viewport: ctx.viewportBounds,
        holes,
      });

      const strokeColor = resolveAppThemeColorNumber(
        ctx.theme,
        ctx.theme.renderer.worldEntitySelectionStrokeColorKey,
      );
      const strokeWidth = Math.max(2, Math.min(5, ctx.viewportState.gridCellPixelSize / 7));
      for (const entityId of candidateEntityIds) {
        const entity = documentSnapshot.entities[entityId];
        if (entity === undefined) {
          continue;
        }

        const definition = definitionMap.get(entity.definitionId);
        if (definition === undefined) {
          continue;
        }

        const rect = resolveEntityViewportRect({ ctx, entity, definition });
        if (rect === null) {
          continue;
        }

        const clipped = expandAndClipRect(rect, ctx.viewportBounds, DARK_PIPE_SELECTION_HOLE_PADDING);
        if (clipped === null) {
          continue;
        }

        graphics
          .rect(clipped.left, clipped.top, clipped.width, clipped.height)
          .stroke({
            width: strokeWidth,
            color: strokeColor,
            alpha: DARK_PIPE_SELECTION_STROKE_ALPHA,
          });
      }
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}

function drawMaskWithHoles(options: {
  graphics: Graphics;
  viewport: ViewportRect;
  holes: readonly ViewportRect[];
}): void {
  const left = options.viewport.left;
  const top = options.viewport.top;
  const right = options.viewport.left + options.viewport.width;
  const bottom = options.viewport.top + options.viewport.height;
  const xs = createSortedBreakpoints([
    left,
    right,
    ...options.holes.flatMap((hole) => [hole.left, hole.left + hole.width]),
  ]);
  const ys = createSortedBreakpoints([
    top,
    bottom,
    ...options.holes.flatMap((hole) => [hole.top, hole.top + hole.height]),
  ]);

  for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
      const cellLeft = xs[xIndex] ?? left;
      const cellRight = xs[xIndex + 1] ?? right;
      const cellTop = ys[yIndex] ?? top;
      const cellBottom = ys[yIndex + 1] ?? bottom;
      const width = cellRight - cellLeft;
      const height = cellBottom - cellTop;
      if (width <= 0 || height <= 0) {
        continue;
      }

      const center = {
        x: cellLeft + width / 2,
        y: cellTop + height / 2,
      };
      if (options.holes.some((hole) => pointInRect(center, hole))) {
        continue;
      }

      options.graphics
        .rect(cellLeft, cellTop, width, height)
        .fill({
          color: 0x05070a,
          alpha: DARK_PIPE_SELECTION_MASK_ALPHA,
        });
    }
  }
}

function createSortedBreakpoints(values: readonly number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map((value) => Math.round(value * 100) / 100))]
    .sort((left, right) => left - right);
}

function pointInRect(
  point: { x: number; y: number },
  rect: ViewportRect,
): boolean {
  return point.x >= rect.left
    && point.x <= rect.left + rect.width
    && point.y >= rect.top
    && point.y <= rect.top + rect.height;
}

function expandAndClipRect(
  rect: ViewportRect,
  viewport: ViewportRect,
  padding: number,
): ViewportRect | null {
  const left = Math.max(viewport.left, rect.left - padding);
  const top = Math.max(viewport.top, rect.top - padding);
  const right = Math.min(viewport.left + viewport.width, rect.left + rect.width + padding);
  const bottom = Math.min(viewport.top + viewport.height, rect.top + rect.height + padding);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}
