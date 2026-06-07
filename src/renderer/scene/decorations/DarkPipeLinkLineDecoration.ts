import { Graphics } from "pixi.js";

import { isDarkPipeSlotLink } from "@/shared/dark-pipe-link";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import {
  buildEntityDefinitionMap,
  clipSegmentToViewport,
  resolveEntityViewportCenter,
  type ViewportPoint,
} from "./DarkPipeLinkGeometry";

const DARK_PIPE_LINK_LINE_ALPHA = 0.52;
const DARK_PIPE_LINK_DASH_LENGTH = 12;
const DARK_PIPE_LINK_GAP_LENGTH = 8;

export function createDarkPipeLinkLineDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      const editor = ctx.renderHost.workspace.editor;
      if (editor === null) {
        return;
      }

      const documentSnapshot = editor.document?.getSnapshot?.() ?? null;
      if (documentSnapshot === null) {
        return;
      }
      const entityDefinitionMap = buildEntityDefinitionMap(ctx.renderHost.workspace.registry.entityDefinitions);
      const strokeColor = resolveAppThemeColorNumber(
        ctx.theme,
        ctx.theme.renderer.worldEntitySelectionStrokeColorKey,
      );
      const strokeWidth = Math.max(1, Math.min(3, ctx.viewportState.gridCellPixelSize / 10));

      for (const link of documentSnapshot.slotLinks) {
        if (!isDarkPipeSlotLink(link, documentSnapshot.entities)) {
          continue;
        }

        const sourceEntity = documentSnapshot.entities[link.source.entityId];
        const targetEntity = documentSnapshot.entities[link.target.entityId];
        if (sourceEntity === undefined || targetEntity === undefined) {
          continue;
        }

        const sourceDefinition = entityDefinitionMap.get(sourceEntity.definitionId);
        const targetDefinition = entityDefinitionMap.get(targetEntity.definitionId);
        if (sourceDefinition === undefined || targetDefinition === undefined) {
          continue;
        }

        const clipped = clipSegmentToViewport({
          start: resolveEntityViewportCenter({ ctx, entity: sourceEntity, definition: sourceDefinition }),
          end: resolveEntityViewportCenter({ ctx, entity: targetEntity, definition: targetDefinition }),
          viewport: ctx.viewportBounds,
        });
        if (clipped === null) {
          continue;
        }

        drawDashedLine({
          graphics,
          start: clipped.start,
          end: clipped.end,
          color: strokeColor,
          width: strokeWidth,
          alpha: DARK_PIPE_LINK_LINE_ALPHA,
        });
      }
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}

function drawDashedLine(options: {
  graphics: Graphics;
  start: ViewportPoint;
  end: ViewportPoint;
  color: number;
  width: number;
  alpha: number;
}): void {
  const dx = options.end.x - options.start.x;
  const dy = options.end.y - options.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) {
    return;
  }

  const unitX = dx / length;
  const unitY = dy / length;
  let cursor = 0;

  while (cursor < length) {
    const dashEnd = Math.min(length, cursor + DARK_PIPE_LINK_DASH_LENGTH);
    options.graphics
      .moveTo(
        options.start.x + unitX * cursor,
        options.start.y + unitY * cursor,
      )
      .lineTo(
        options.start.x + unitX * dashEnd,
        options.start.y + unitY * dashEnd,
      )
      .stroke({
        width: options.width,
        color: options.color,
        alpha: options.alpha,
      });

    cursor += DARK_PIPE_LINK_DASH_LENGTH + DARK_PIPE_LINK_GAP_LENGTH;
  }
}
