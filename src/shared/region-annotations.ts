import type { RegionAnnotation } from "@/domain/document/region-annotation";
import {
  isValidRegionGridRect,
  normalizeRegionRects,
  resolveRegionGridArea,
} from "@/shared/geometry/region-rects";

const REGION_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const MAX_REGION_COUNT = 1_000;
const MAX_REGION_RECT_COUNT = 10_000;
const MAX_REGION_TEXT_LENGTH = 10_000;

export function normalizeRegionColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return REGION_COLOR_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeRegionAnnotations(value: unknown): RegionAnnotation[] | null {
  if (!Array.isArray(value) || value.length > MAX_REGION_COUNT) {
    return null;
  }

  const ids = new Set<string>();
  const normalizedRegions: RegionAnnotation[] = [];

  for (const entry of value) {
    if (!isRecord(entry)
      || typeof entry.id !== "string"
      || entry.id.trim().length === 0
      || ids.has(entry.id)
      || typeof entry.name !== "string"
      || entry.name.trim().length === 0
      || entry.name.length > MAX_REGION_TEXT_LENGTH
      || typeof entry.description !== "string"
      || entry.description.length > MAX_REGION_TEXT_LENGTH
      || typeof entry.color !== "string"
      || !Array.isArray(entry.rects)
      || entry.rects.length === 0
      || entry.rects.length > MAX_REGION_RECT_COUNT
      || !entry.rects.every(isRegionGridRectLike)) {
      return null;
    }

    const color = normalizeRegionColor(entry.color);
    if (color === null) {
      return null;
    }

    const rects = normalizeRegionRects(entry.rects);
    if (
      rects.length === 0
      || rects.length > MAX_REGION_RECT_COUNT
      || !Number.isSafeInteger(resolveRegionGridArea(rects))
    ) {
      return null;
    }

    ids.add(entry.id);
    normalizedRegions.push({
      id: entry.id,
      name: entry.name.trim(),
      description: entry.description,
      color,
      rects,
    });
  }

  return normalizedRegions;
}

export function cloneRegionAnnotation(region: RegionAnnotation): RegionAnnotation {
  return {
    ...region,
    rects: region.rects.map((rect) => ({ ...rect })),
  };
}

function isRegionGridRectLike(value: unknown): value is RegionAnnotation["rects"][number] {
  return isRecord(value)
    && typeof value.x === "number"
    && typeof value.y === "number"
    && typeof value.width === "number"
    && typeof value.height === "number"
    && isValidRegionGridRect(value as unknown as RegionAnnotation["rects"][number]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
