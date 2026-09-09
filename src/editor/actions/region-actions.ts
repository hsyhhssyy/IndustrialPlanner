import type { RegionAnnotation } from "@/domain/document/region-annotation";
import type { EditorAction } from "@/domain/editor/editor-action";
import { createUuid } from "@/domain/shared/uuid";
import {
  addRegionRect,
  resolveRegionGridBounds,
  subtractRegionRect,
} from "@/shared/geometry/region-rects";
import {
  cloneRegionAnnotation,
  normalizeRegionColor,
} from "@/shared/region-annotations";
import { action } from "mobx";

import { persistWorldDocumentViewportSettings } from "../document-viewport";
import {
  clampViewportGridSize,
  resolveViewportGridCellPixelSize,
} from "../viewport-settings";
import { EDITOR_GRID_CELL_PIXEL_SIZE } from "../viewport-constants";
import type { EditorActionsContext } from "./types";

const DEFAULT_REGION_COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
] as const;
const REGION_FOCUS_PADDING_RATIO = 0.82;

type EditorRegionActions = Pick<
  EditorAction,
  | "applyRegionDraftMarquee"
  | "beginRegionDraft"
  | "cancelRegionDraft"
  | "commitRegionDraft"
  | "deleteRegion"
  | "focusOnRegion"
  | "resetRegionInteraction"
  | "selectRegion"
  | "setRegionDraftMarquee"
  | "setRegionDraftOperation"
  | "setRegionHovered"
  | "setRegionVisible"
  | "updateRegionDraft"
>;

export function createEditorRegionActions({
  document,
  documentWriter,
  state,
}: EditorActionsContext): EditorRegionActions {
  let draftSourceRegion: RegionAnnotation | null = null;

  const clearDraft = (): void => {
    state.regionAnnotations.draft = null;
    state.regionAnnotations.draftOperation = "add";
    state.regionAnnotations.draftMarqueeGridRect = null;
    draftSourceRegion = null;
  };

  const resetInteraction = (): void => {
    state.regionAnnotations.selectedId = null;
    state.regionAnnotations.hoveredId = null;
    state.regionAnnotations.moveFeedback = null;
    clearDraft();
  };

  return {
    beginRegionDraft: action((regionId) => {
      const currentDocument = document.getSnapshot();
      const existingRegion = regionId === undefined
        ? null
        : currentDocument.regions.find((region) => region.id === regionId) ?? null;
      draftSourceRegion = existingRegion === null ? null : cloneRegionAnnotation(existingRegion);
      state.regionAnnotations.draft = existingRegion === null
        ? {
          id: createUuid(),
          name: resolveDefaultRegionName(currentDocument.regions),
          description: "",
          color: DEFAULT_REGION_COLORS[currentDocument.regions.length % DEFAULT_REGION_COLORS.length]
            ?? DEFAULT_REGION_COLORS[0],
          rects: [],
        }
        : cloneRegionAnnotation(existingRegion);
      state.regionAnnotations.selectedId = existingRegion?.id ?? null;
      state.regionAnnotations.draftOperation = "add";
      state.regionAnnotations.draftMarqueeGridRect = null;
      state.regionAnnotations.moveFeedback = null;
    }),

    updateRegionDraft: action((patch) => {
      const draft = state.regionAnnotations.draft;
      if (draft === null) {
        return;
      }

      const color = patch.color === undefined
        ? draft.color
        : normalizeRegionColor(patch.color);
      if (color === null) {
        return;
      }

      state.regionAnnotations.draft = {
        ...draft,
        name: patch.name ?? draft.name,
        description: patch.description ?? draft.description,
        color,
      };
    }),

    setRegionDraftOperation: action((operation) => {
      if (state.regionAnnotations.draft === null) {
        return;
      }
      state.regionAnnotations.draftOperation = operation;
    }),

    setRegionDraftMarquee: action((rect) => {
      state.regionAnnotations.draftMarqueeGridRect = rect === null ? null : { ...rect };
    }),

    applyRegionDraftMarquee: action(() => {
      const draft = state.regionAnnotations.draft;
      const marquee = state.regionAnnotations.draftMarqueeGridRect;
      if (draft === null || marquee === null) {
        return;
      }

      state.regionAnnotations.draft = {
        ...draft,
        rects: state.regionAnnotations.draftOperation === "add"
          ? addRegionRect(draft.rects, marquee)
          : subtractRegionRect(draft.rects, marquee),
      };
      state.regionAnnotations.draftMarqueeGridRect = null;
    }),

    commitRegionDraft: action(() => {
      const draft = state.regionAnnotations.draft;
      if (draft === null || draft.rects.length === 0) {
        return false;
      }

      const color = normalizeRegionColor(draft.color);
      if (color === null) {
        return false;
      }

      const currentDocument = document.getSnapshot();
      const existingIndex = currentDocument.regions.findIndex((region) => region.id === draft.id);
      if (draftSourceRegion !== null) {
        const currentSource = currentDocument.regions[existingIndex];
        if (currentSource === undefined || !areRegionsEqual(currentSource, draftSourceRegion)) {
          return false;
        }
      } else if (existingIndex >= 0) {
        return false;
      }

      const committedRegion: RegionAnnotation = {
        ...cloneRegionAnnotation(draft),
        name: draft.name.trim() || resolveDefaultRegionName(currentDocument.regions),
        description: draft.description.trim(),
        color,
      };
      const nextRegions = existingIndex >= 0
        ? currentDocument.regions.map((region, index) => (
          index === existingIndex ? committedRegion : region
        ))
        : [...currentDocument.regions, committedRegion];
      const committed = documentWriter.commit({
        action: {
          type: existingIndex >= 0 ? "region.edit" : "region.create",
          label: existingIndex >= 0 ? "编辑区域" : "创建区域",
          detail: committedRegion.name,
        },
        update: (documentSnapshot) => ({
          ...documentSnapshot,
          regions: nextRegions,
        }),
      });
      if (committed === null) {
        return false;
      }

      state.regionAnnotations.selectedId = committedRegion.id;
      clearDraft();
      return true;
    }),

    cancelRegionDraft: action(() => {
      clearDraft();
    }),

    deleteRegion: action((regionId) => {
      const currentDocument = document.getSnapshot();
      const region = currentDocument.regions.find((candidate) => candidate.id === regionId);
      if (region === undefined) {
        return;
      }

      documentWriter.commit({
        action: {
          type: "region.delete",
          label: "删除区域",
          detail: region.name,
        },
        update: (documentSnapshot) => ({
          ...documentSnapshot,
          regions: documentSnapshot.regions.filter((candidate) => candidate.id !== regionId),
        }),
      });
      if (state.regionAnnotations.selectedId === regionId) {
        state.regionAnnotations.selectedId = null;
      }
      if (state.regionAnnotations.hoveredId === regionId) {
        state.regionAnnotations.hoveredId = null;
      }
      state.regionAnnotations.hiddenIds.replace(
        state.regionAnnotations.hiddenIds.filter((id) => id !== regionId),
      );
      if (state.regionAnnotations.draft?.id === regionId) {
        clearDraft();
      }
    }),

    selectRegion: action((regionId) => {
      state.regionAnnotations.selectedId = regionId !== null
        && document.getSnapshot().regions.some((region) => region.id === regionId)
        ? regionId
        : null;
    }),

    setRegionHovered: action((regionId) => {
      state.regionAnnotations.hoveredId = regionId !== null
        && document.getSnapshot().regions.some((region) => region.id === regionId)
        ? regionId
        : null;
    }),

    setRegionVisible: action((regionId, visible) => {
      const hiddenIds = state.regionAnnotations.hiddenIds;
      const existingIndex = hiddenIds.indexOf(regionId);
      if (visible && existingIndex >= 0) {
        hiddenIds.splice(existingIndex, 1);
      } else if (!visible && existingIndex < 0
        && document.getSnapshot().regions.some((region) => region.id === regionId)) {
        hiddenIds.push(regionId);
      }
    }),

    focusOnRegion: action((regionId) => {
      const region = document.getSnapshot().regions.find((candidate) => candidate.id === regionId);
      const bounds = region === undefined ? null : resolveRegionGridBounds(region.rects);
      if (bounds === null) {
        return;
      }

      const nextGridSize = clampViewportGridSize(Math.min(
        state.viewport.clientRect.width * REGION_FOCUS_PADDING_RATIO
          / Math.max(1, bounds.width * EDITOR_GRID_CELL_PIXEL_SIZE),
        state.viewport.clientRect.height * REGION_FOCUS_PADDING_RATIO
          / Math.max(1, bounds.height * EDITOR_GRID_CELL_PIXEL_SIZE),
      ));
      state.viewport.center.x = bounds.x + bounds.width / 2;
      state.viewport.center.y = bounds.y + bounds.height / 2;
      state.viewport.gridSize = nextGridSize;
      state.viewport.gridCellPixelSize = resolveViewportGridCellPixelSize(nextGridSize);
      persistWorldDocumentViewportSettings({ document, documentWriter, state });
    }),

    resetRegionInteraction: action(() => {
      resetInteraction();
    }),
  };
}

function resolveDefaultRegionName(regions: readonly RegionAnnotation[]): string {
  const usedNames = new Set(regions.map((region) => region.name));
  let sequence = 1;
  while (usedNames.has(`区域 ${sequence}`)) {
    sequence += 1;
  }
  return `区域 ${sequence}`;
}

function areRegionsEqual(left: RegionAnnotation, right: RegionAnnotation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
