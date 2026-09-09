import type { TextStyleOptions } from "pixi.js";
import { Container, Graphics, Text } from "pixi.js";

import type { RegionAnnotation } from "@/domain/document/region-annotation";
import type { GridRect } from "@/domain/shared/grid";
import {
  createRegionOutlineSegments,
  normalizeRegionRects,
  resolveRegionGridArea,
  resolveRegionShapeSummary,
} from "@/shared/geometry/region-rects";
import {
  resolveViewportPointFromWorldPoint,
  resolveViewportRectFromWorldGridRect,
} from "@/shared/geometry/viewport-transform";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveWorldAuxiliaryStrokeWidth } from "./MarqueeRectDecoration";

const REGION_FILL_ALPHA = 0.13;
const REGION_PREVIEW_FILL_ALPHA = 0.18;
const REGION_OUTLINE_ALPHA = 0.82;
const REGION_SELECTED_OUTLINE_ALPHA = 1;
const REGION_LABEL_MARGIN = 8;

interface DisplayRegion {
  readonly annotation: RegionAnnotation;
  readonly kind: "persistent" | "draft" | "placement";
  readonly highlighted: boolean;
}

interface RegionLabelEntry {
  readonly text: Text;
  readonly regionId: string;
}

export function createRegionAnnotationBackgroundDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,
    sync(ctx) {
      graphics.clear();
      for (const region of resolveDisplayRegions(ctx)) {
        const color = parseRegionColor(region.annotation.color);
        for (const rect of region.annotation.rects) {
          const layout = resolveRegionRectLayout(ctx, rect);
          if (layout === null) {
            continue;
          }
          graphics
            .rect(layout.left, layout.top, layout.width, layout.height)
            .fill({
              color,
              alpha: region.kind === "persistent" ? REGION_FILL_ALPHA : REGION_PREVIEW_FILL_ALPHA,
            });
        }
      }
    },
    destroy() {
      graphics.destroy({ children: true });
    },
  };
}

export function createRegionAnnotationOverlayDecoration(): DecorationLayer {
  const container = new Container();
  const outline = new Graphics({ roundPixels: true });
  const marquee = new Graphics({ roundPixels: true });
  let marqueeLabel: Text | null = null;
  const labels = new Map<string, RegionLabelEntry>();
  container.addChild(outline, marquee);

  return {
    container,
    sync(ctx) {
      outline.clear();
      marquee.clear();
      const activeLabelKeys = new Set<string>();
      const regions = resolveDisplayRegions(ctx);

      for (const region of regions) {
        drawRegionOutline({ ctx, graphics: outline, region });
        const labelKey = `${region.kind}:${region.annotation.id}`;
        const label = resolveRegionLabel({
          container,
          labels,
          labelKey,
          regionId: region.annotation.id,
          ctx,
        });
        activeLabelKeys.add(labelKey);
        syncRegionLabel({ ctx, label, region });
      }

      for (const [key, entry] of labels) {
        entry.text.visible = activeLabelKeys.has(key);
      }

      const draftMarquee = ctx.renderHost.workspace.app?.state?.settings?.showRegionAnnotations === true
        ? ctx.renderHost.workspace.editor?.state.regionAnnotations.draftMarqueeGridRect ?? null
        : null;
      if (draftMarquee !== null && marqueeLabel === null) {
        marqueeLabel = new Text({ text: "", style: createRegionLabelStyle(0xffffff) });
        marqueeLabel.anchor.set(1, 0);
        marqueeLabel.roundPixels = true;
        container.addChild(marqueeLabel);
      }
      if (marqueeLabel !== null) {
        syncRegionDraftMarquee(ctx, marquee, marqueeLabel);
      }
    },
    destroy() {
      labels.clear();
      container.destroy({ children: true });
    },
  };
}

function resolveDisplayRegions(ctx: DecorationSyncContext): DisplayRegion[] {
  const editor = ctx.renderHost.workspace.editor;
  const app = ctx.renderHost.workspace.app;
  if (editor === null || app?.state?.settings?.showRegionAnnotations !== true) {
    return [];
  }

  const state = editor.state.regionAnnotations;
  const draftId = state.draft?.id ?? null;
  const persistent = editor.document.getSnapshot().regions
    .filter((region) => region.id !== draftId && !state.hiddenIds.includes(region.id))
    .map((annotation): DisplayRegion => ({
      annotation,
      kind: "persistent",
      highlighted: annotation.id === state.selectedId || annotation.id === state.hoveredId,
    }));
  const draft = state.draft === null
    ? []
    : [{
      annotation: state.draft,
      kind: "draft" as const,
      highlighted: true,
    }];
  const placement = state.placementPreview.map((annotation): DisplayRegion => ({
    annotation,
    kind: "placement",
    highlighted: true,
  }));

  return [...persistent, ...placement, ...draft];
}

function drawRegionOutline(options: {
  readonly ctx: DecorationSyncContext;
  readonly graphics: Graphics;
  readonly region: DisplayRegion;
}): void {
  const color = parseRegionColor(options.region.annotation.color);
  for (const segment of createRegionOutlineSegments(options.region.annotation.rects)) {
    const start = resolveRegionPoint(options.ctx, segment.x1, segment.y1);
    const end = resolveRegionPoint(options.ctx, segment.x2, segment.y2);
    options.graphics.moveTo(start.x, start.y).lineTo(end.x, end.y);
  }
  options.graphics.stroke({
    color,
    alpha: options.region.highlighted ? REGION_SELECTED_OUTLINE_ALPHA : REGION_OUTLINE_ALPHA,
    width: resolveWorldAuxiliaryStrokeWidth(options.ctx.viewportState.gridCellPixelSize)
      * (options.region.highlighted ? 1.6 : 1),
  });
}

function resolveRegionLabel(options: {
  readonly container: Container;
  readonly labels: Map<string, RegionLabelEntry>;
  readonly labelKey: string;
  readonly regionId: string;
  readonly ctx: DecorationSyncContext;
}): Text {
  const existing = options.labels.get(options.labelKey);
  if (existing !== undefined) {
    return existing.text;
  }

  const text = new Text({ text: "", style: createRegionLabelStyle(0xffffff) });
  text.anchor.set(0.5);
  text.roundPixels = true;
  text.eventMode = "static";
  text.cursor = "pointer";
  text.on("pointertap", () => {
    options.ctx.renderHost.workspace.editor?.actions.selectRegion(options.regionId);
  });
  options.container.addChild(text);
  options.labels.set(options.labelKey, { text, regionId: options.regionId });
  return text;
}

function syncRegionLabel(options: {
  readonly ctx: DecorationSyncContext;
  readonly label: Text;
  readonly region: DisplayRegion;
}): void {
  const rect = resolveRegionLabelRect(options.region.annotation.rects);
  if (rect === null) {
    options.label.visible = false;
    return;
  }

  const layout = resolveRegionRectLayout(options.ctx, rect);
  if (layout === null) {
    options.label.visible = false;
    return;
  }

  const showSummary = options.region.highlighted || options.region.kind !== "persistent";
  const cellUnit = options.ctx.renderHost.workspace.app?.state?.settings?.locale === "en-US"
    ? "cells"
    : "格";
  options.label.visible = true;
  options.label.text = showSummary
    ? `${options.region.annotation.name}\n${resolveRegionShapeSummary(options.region.annotation.rects, cellUnit)}`
    : options.region.annotation.name;
  options.label.style = createRegionLabelStyle(parseRegionColor(options.region.annotation.color));
  options.label.x = clamp(
    layout.left + layout.width / 2,
    REGION_LABEL_MARGIN + options.label.width / 2,
    Math.max(
      REGION_LABEL_MARGIN + options.label.width / 2,
      options.ctx.viewportBounds.width - REGION_LABEL_MARGIN - options.label.width / 2,
    ),
  );
  options.label.y = clamp(
    layout.top + layout.height / 2,
    REGION_LABEL_MARGIN + options.label.height / 2,
    Math.max(
      REGION_LABEL_MARGIN + options.label.height / 2,
      options.ctx.viewportBounds.height - REGION_LABEL_MARGIN - options.label.height / 2,
    ),
  );
}

function syncRegionDraftMarquee(
  ctx: DecorationSyncContext,
  graphics: Graphics,
  label: Text,
): void {
  const editor = ctx.renderHost.workspace.editor;
  const app = ctx.renderHost.workspace.app;
  const state = editor?.state.regionAnnotations;
  const rect = state?.draftMarqueeGridRect ?? null;
  const draft = state?.draft ?? null;
  if (editor === null || app?.state?.settings?.showRegionAnnotations !== true || rect === null || draft === null) {
    label.visible = false;
    return;
  }

  const layout = resolveRegionRectLayout(ctx, rect);
  if (layout === null) {
    label.visible = false;
    return;
  }
  const color = state?.draftOperation === "subtract" ? 0xef4444 : parseRegionColor(draft.color);
  graphics
    .rect(layout.left, layout.top, layout.width, layout.height)
    .fill({ color, alpha: 0.16 })
    .stroke({
      color,
      alpha: 1,
      width: resolveWorldAuxiliaryStrokeWidth(ctx.viewportState.gridCellPixelSize) * 1.8,
    });

  const totalArea = resolveRegionGridArea(draft.rects);
  const isEnglish = app?.state?.settings?.locale === "en-US";
  label.visible = true;
  label.text = isEnglish
    ? `Box: ${rect.width} × ${rect.height} cells · Region: ${totalArea} cells`
    : `当前框：${rect.width} × ${rect.height} 格 · 区域：${totalArea} 格`;
  label.style = createRegionLabelStyle(color);
  label.x = clamp(
    layout.left + layout.width,
    REGION_LABEL_MARGIN + label.width,
    Math.max(
      REGION_LABEL_MARGIN + label.width,
      ctx.viewportBounds.width - REGION_LABEL_MARGIN,
    ),
  );
  label.y = clamp(
    layout.top + layout.height + 4,
    REGION_LABEL_MARGIN,
    Math.max(
      REGION_LABEL_MARGIN,
      ctx.viewportBounds.height - REGION_LABEL_MARGIN - label.height,
    ),
  );
}

function resolveRegionLabelRect(rects: readonly GridRect[]): GridRect | null {
  return normalizeRegionRects(rects)
    .sort((left, right) => (
      right.width * right.height - left.width * left.height
      || left.y - right.y
      || left.x - right.x
    ))[0] ?? null;
}

function resolveRegionRectLayout(ctx: DecorationSyncContext, rect: GridRect) {
  return resolveViewportRectFromWorldGridRect({
    gridRect: rect,
    viewportBounds: ctx.viewportBounds,
    viewportCenter: {
      x: ctx.viewportState.centerX,
      y: ctx.viewportState.centerY,
    },
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
  });
}

function resolveRegionPoint(ctx: DecorationSyncContext, x: number, y: number) {
  return resolveViewportPointFromWorldPoint({
    viewportBounds: ctx.viewportBounds,
    viewportCenter: {
      x: ctx.viewportState.centerX,
      y: ctx.viewportState.centerY,
    },
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
    worldPoint: { x, y },
  });
}

function createRegionLabelStyle(color: number): TextStyleOptions {
  return {
    align: "center",
    fill: color,
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 14,
    stroke: {
      color: 0x101419,
      width: 3,
      alpha: 0.8,
    },
  };
}

function parseRegionColor(color: string): number {
  return Number.parseInt(color.slice(1), 16);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
