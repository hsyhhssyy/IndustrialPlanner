import { Container, Graphics } from "pixi.js";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

import type { ActiveTool } from "@/domain/app/types/app-types";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveStrongPortOverlayEntityIds as resolveStrongPortOverlayIds } from "@/renderer/move-visual-policy";
import type { GridEdge, GridFloatPoint } from "@/domain/shared/grid";
import {
  resolveDisplayRotationRadians,
  resolveViewportPointFromWorldPoint,
} from "@/shared/geometry/viewport-transform";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import {
  resolveProductionPipePortGhostEntries,
  type ProductionPipePortGhostEntry,
} from "./PortOverlayDecoration";

const ORDINARY_PIPE_PORT_GHOST_COLOR = 0xf3a32b;
const CONSUMPTION_PIPE_PORT_GHOST_COLOR = 0xb8d832;
const PORT_GHOST_MIN_CELL_PIXEL_SIZE = 8;
const PORT_GHOST_FULL_CELL_PIXEL_SIZE = 20;

export function shouldShowPipePortGhostDecoration(options: {
  readonly activeTool: ActiveTool | null;
  readonly useBlueprintStyle: boolean;
  readonly suppressPipes: boolean;
}): boolean {
  return options.activeTool !== null
    && options.activeTool !== "logistics-placement"
    && !options.useBlueprintStyle
    && !options.suppressPipes;
}

export function resolvePipePortGhostZoomAlpha(gridCellPixelSize: number): number {
  if (gridCellPixelSize <= PORT_GHOST_MIN_CELL_PIXEL_SIZE) {
    return 0;
  }
  if (gridCellPixelSize >= PORT_GHOST_FULL_CELL_PIXEL_SIZE) {
    return 1;
  }
  return (
    (gridCellPixelSize - PORT_GHOST_MIN_CELL_PIXEL_SIZE)
    / (PORT_GHOST_FULL_CELL_PIXEL_SIZE - PORT_GHOST_MIN_CELL_PIXEL_SIZE)
  );
}

export function createPipePortGhostDecoration(): DecorationLayer {
  const container = new Container();
  const graphicsPool: Graphics[] = [];
  let destroyed = false;
  let lastDocumentVersion = -1;
  let lastViewportVersion = -1;
  let lastCollectionVersion = -1;
  let lastPresentationVersion = -1;
  let lastVisibilityKey = "";
  let cachedEntities: readonly WorldEntity[] | null = null;
  let cachedDefinitions: readonly EntityDefinition[] | null = null;
  let cachedHiddenKey = "";
  let cachedDocumentVersion = -1;
  let entries: ProductionPipePortGhostEntry[] = [];
  const drawnGeometry = new WeakMap<Graphics, string>();

  container.eventMode = "none";
  container.interactiveChildren = false;

  const hideAll = (): void => {
    container.visible = false;
    for (const graphics of graphicsPool) {
      graphics.visible = false;
    }
  };

  const getOrCreateGraphics = (index: number): Graphics => {
    const existing = graphicsPool[index];
    if (existing !== undefined) {
      return existing;
    }

    const graphics = new Graphics({ roundPixels: true });
    graphics.eventMode = "none";
    graphics.visible = false;
    graphicsPool.push(graphics);
    container.addChild(graphics);
    return graphics;
  };

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) {
        return;
      }

      const source = ctx.renderHost.input.source;
      const app = ctx.renderHost.input.presentation.getSnapshot();
      const strongOverlayEntityIds = resolveStrongPortOverlayEntityIds(ctx);
      const visibilityKey = [
        app.activeTool ?? "none",
        app.settings.gameUseBlueprintStyleDeviceImages === true ? "blueprint" : "top",
        source.snapshot.getSnapshot().interaction?.suppressPipes === true ? "suppressed" : "visible",
        [...strongOverlayEntityIds].sort().join(","),
        [...ctx.buildingEffectPortKeys ?? []].sort().join(","),
      ].join(":");
      const versions = ctx.versions;

      if (
        versions !== undefined
        && lastDocumentVersion === versions.document
        && lastViewportVersion === versions.viewport
        && lastCollectionVersion === versions.collections
        && lastPresentationVersion === versions.presentation
        && lastVisibilityKey === visibilityKey
      ) {
        return;
      }

      if (versions !== undefined) {
        lastDocumentVersion = versions.document;
        lastViewportVersion = versions.viewport;
        lastCollectionVersion = versions.collections;
        lastPresentationVersion = versions.presentation;
      }
      lastVisibilityKey = visibilityKey;

      if (
        source === null
        || app === null
        || !shouldShowPipePortGhostDecoration({
          activeTool: app.activeTool,
          useBlueprintStyle: app.settings.gameUseBlueprintStyleDeviceImages,
          suppressPipes: source.snapshot.getSnapshot().interaction?.suppressPipes ?? false,
        })
      ) {
        hideAll();
        return;
      }

      const zoomAlpha = resolvePipePortGhostZoomAlpha(
        ctx.viewportState.gridCellPixelSize,
      );
      if (zoomAlpha <= 0) {
        hideAll();
        return;
      }

      const entities = source.queries.listEntities();
      // AI-REMOVED 2026-09-16:
      // Reason: 端口合法性仅随内容变化重算，视口变化复用世界坐标结果。
      // Trigger: 用户要求优化视口拖动与虚影移动。
      // Evidence: Trace 与调用链确认重复布局、全量候选扫描和缓存驱逐。
      // Replacement: 下方 entries 缓存
      // Risk: 需验证平移、缩放、旋转与编辑后的正确性。
      // Human Review: Required
      // Original code:
      //       const entityDefinitionMap = new Map(
      //         ctx.renderHost.workspace.registry.entityDefinitions.map((definition) => [
      //           definition.id,
      //           definition,
      //         ]),
      //       );
      //       const entries = resolveProductionPipePortGhostEntries({
      //         entities,
      //         entityDefinitionMap,
      //         queries: ctx.renderHost.workspace.registry.queries,
      //         hiddenEntityIds: strongOverlayEntityIds,
      //       });
      const definitions = ctx.renderHost.input.source.registry.entityDefinitions;
      const hiddenKey = [...strongOverlayEntityIds].sort().join(",");
      if (cachedEntities !== entities || cachedDefinitions !== definitions || cachedHiddenKey !== hiddenKey
        || cachedDocumentVersion !== versions?.document) {
        entries = resolveProductionPipePortGhostEntries({ entities,
          entityDefinitionMap: new Map(definitions.map((definition) => [definition.id, definition])),
          queries: ctx.renderHost.input.source.registry.queries, hiddenEntityIds: strongOverlayEntityIds });
        cachedEntities = entities; cachedDefinitions = definitions; cachedHiddenKey = hiddenKey;
        cachedDocumentVersion = versions?.document ?? -1;
      }

      container.visible = entries.length > 0;
      container.alpha = zoomAlpha;
      let visibleIndex = 0;

      for (const entry of entries) {
        if (ctx.buildingEffectPortKeys?.has(`${entry.entityId}:${entry.portGroupId}:${entry.portId}`)) continue;
        const boundary = resolvePipePortBoundaryViewportPoint(ctx, entry);
        if (
          !isViewportPointVisible(
            boundary,
            ctx,
            ctx.viewportState.gridCellPixelSize,
          )
        ) {
          continue;
        }

        const graphics = getOrCreateGraphics(visibleIndex);
        visibleIndex += 1;
        graphics.visible = true;
        graphics.x = boundary.x;
        graphics.y = boundary.y;
        graphics.rotation = resolveEdgeAngleRadians(entry.edge)
          + resolveDisplayRotationRadians(ctx.viewportState.displayRotation);
        const geometryKey = `${ctx.viewportState.gridCellPixelSize}:${entry.variant}`;
        if (drawnGeometry.get(graphics) !== geometryKey) {
        drawPipePortGhost({
          graphics,
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          color: entry.variant === "consumption"
            ? CONSUMPTION_PIPE_PORT_GHOST_COLOR
            : ORDINARY_PIPE_PORT_GHOST_COLOR,
        });
          drawnGeometry.set(graphics, geometryKey);
        }
      }

      for (let index = visibleIndex; index < graphicsPool.length; index += 1) {
        const graphics = graphicsPool[index];
        if (graphics !== undefined) {
          graphics.visible = false;
        }
      }

      if (visibleIndex === 0) {
        container.visible = false;
      }
    },

    destroy(): void {
      destroyed = true;
      graphicsPool.length = 0;
      container.destroy({ children: true });
    },
  };
}

function resolveStrongPortOverlayEntityIds(
  ctx: DecorationSyncContext,
): ReadonlySet<string> {
  const collections = ctx.renderHost.input.source.snapshot.getSnapshot().interaction?.collections;
  if (collections === undefined) {
    return new Set();
  }

  return resolveStrongPortOverlayIds(
    ctx.renderHost.input.presentation.getSnapshot().moveKind ?? null,
    collections?.[EntityCollectionType.preview],
    collections?.[EntityCollectionType.selection],
  );
}

function resolvePipePortBoundaryViewportPoint(
  ctx: DecorationSyncContext,
  entry: ProductionPipePortGhostEntry,
): GridFloatPoint {
  return resolveViewportPointFromWorldPoint({
    worldPoint: resolvePortBoundaryPoint(entry.insideGridPoint, entry.edge),
    viewportBounds: ctx.viewportBounds,
    viewportCenter: {
      x: ctx.viewportState.centerX,
      y: ctx.viewportState.centerY,
    },
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
  });
}

function resolvePortBoundaryPoint(
  insideGridPoint: ProductionPipePortGhostEntry["insideGridPoint"],
  edge: GridEdge,
): GridFloatPoint {
  switch (edge) {
    case "NORTH":
      return { x: insideGridPoint.x + 0.5, y: insideGridPoint.y };
    case "EAST":
      return { x: insideGridPoint.x + 1, y: insideGridPoint.y + 0.5 };
    case "SOUTH":
      return { x: insideGridPoint.x + 0.5, y: insideGridPoint.y + 1 };
    case "WEST":
      return { x: insideGridPoint.x, y: insideGridPoint.y + 0.5 };
  }
}

function resolveEdgeAngleRadians(edge: GridEdge): number {
  switch (edge) {
    case "NORTH":
      return -Math.PI / 2;
    case "EAST":
      return 0;
    case "SOUTH":
      return Math.PI / 2;
    case "WEST":
      return Math.PI;
  }
}

function isViewportPointVisible(
  point: GridFloatPoint,
  ctx: DecorationSyncContext,
  margin: number,
): boolean {
  return point.x >= ctx.viewportBounds.left - margin
    && point.x <= ctx.viewportBounds.left + ctx.viewportBounds.width + margin
    && point.y >= ctx.viewportBounds.top - margin
    && point.y <= ctx.viewportBounds.top + ctx.viewportBounds.height + margin;
}

function drawPipePortGhost(options: {
  readonly graphics: Graphics;
  readonly gridCellPixelSize: number;
  readonly color: number;
}): void {
  const { graphics, gridCellPixelSize: size, color } = options;
  const bodyLength = size * 0.5;
  const bodyHalfWidth = size * 0.27;
  const railHeight = Math.max(1, size * 0.055);
  const railOffset = size * 0.19;
  const ribWidth = Math.max(1, size * 0.045);
  const ribTop = -size * 0.31;
  const ribHeight = size * 0.62;

  graphics
    .clear()
    .roundRect(
      0,
      -bodyHalfWidth,
      bodyLength,
      bodyHalfWidth * 2,
      size * 0.035,
    )
    .fill({ color, alpha: 0.10 })
    .rect(0, -railOffset - railHeight / 2, bodyLength * 0.88, railHeight)
    .fill({ color, alpha: 0.30 })
    .rect(0, railOffset - railHeight / 2, bodyLength * 0.88, railHeight)
    .fill({ color, alpha: 0.30 })
    .rect(size * 0.25, ribTop, ribWidth, ribHeight)
    .fill({ color, alpha: 0.28 })
    .rect(size * 0.34, ribTop, ribWidth, ribHeight)
    .fill({ color, alpha: 0.48 })
    .rect(size * 0.43, ribTop, ribWidth, ribHeight)
    .fill({ color, alpha: 0.34 });
}
