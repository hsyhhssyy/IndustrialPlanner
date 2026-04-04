import type { PlacementPreviewState } from "@/editor/contracts/placement-preview";

const PLACEMENT_PREVIEW_PROFILING_STAGE_IDS = [
  "canvas.pointerMoveDispatch",
  "controller.total",
  "controller.resolveWorldInput",
  "editor.total",
  "editor.resolvePlacementPreview",
  "editor.hitTest",
  "editor.writeSession",
  "controller.sync.total",
  "controller.sync.worldBounds",
  "controller.sync.rootStoreSet",
  "controller.sync.topologyStoreSet",
  "controller.diagnostics",
  "workspaceDerived.recompute",
  "render.coordinator.collectInput",
  "render.coordinator.buildScene",
  "render.runtime.total",
  "render.runtime.staticLayers",
  "render.runtime.previewLayer",
  "render.runtime.diagnosticsHud",
  "render.runtime.appRender",
  "render.hud.recordFrame",
] as const;

const PLACEMENT_PREVIEW_REACT_SURFACE_IDS = [
  "CanvasPanel",
  "LeftDock",
  "RightDock",
  "BottomStatusBar",
] as const;

export type PlacementPreviewProfilingStageId =
  (typeof PLACEMENT_PREVIEW_PROFILING_STAGE_IDS)[number];

export type PlacementPreviewReactSurfaceId =
  (typeof PLACEMENT_PREVIEW_REACT_SURFACE_IDS)[number];

interface DurationMetricState {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number | null;
}

interface ReactMetricState {
  count: number;
  totalActualDurationMs: number;
  maxActualDurationMs: number;
  minActualDurationMs: number | null;
  totalBaseDurationMs: number;
  maxBaseDurationMs: number;
  minBaseDurationMs: number | null;
}

export interface PlacementPreviewProfilingDurationSnapshot {
  count: number;
  totalDurationMs: number;
  averageDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number | null;
}

export interface PlacementPreviewProfilingReactSnapshot {
  count: number;
  totalActualDurationMs: number;
  averageActualDurationMs: number;
  maxActualDurationMs: number;
  minActualDurationMs: number | null;
  totalBaseDurationMs: number;
  averageBaseDurationMs: number;
  maxBaseDurationMs: number;
  minBaseDurationMs: number | null;
}

export interface PlacementPreviewProfilingSnapshot {
  enabled: boolean;
  sampleStartedAt: number;
  lastRecordedAt: number | null;
  counts: {
    updateCalls: number;
    previewChangedCalls: number;
    previewUnchangedCalls: number;
    previewPresentCalls: number;
    previewMissingCalls: number;
  };
  latest:
    | {
        changed: boolean;
        previousPreview: PlacementPreviewState | null;
        nextPreview: PlacementPreviewState | null;
      }
    | null;
  stages: Record<
    PlacementPreviewProfilingStageId,
    PlacementPreviewProfilingDurationSnapshot
  >;
  reactSurfaces: Record<
    PlacementPreviewReactSurfaceId,
    PlacementPreviewProfilingReactSnapshot
  >;
}

export interface PlacementPreviewProfiler {
  isEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
  measureStage: <T>(
    stageId: PlacementPreviewProfilingStageId,
    callback: () => T,
  ) => T;
  recordStageDuration: (
    stageId: PlacementPreviewProfilingStageId,
    durationMs: number,
  ) => void;
  recordUpdateResult: (options: {
    changed: boolean;
    previousPreview: PlacementPreviewState | null;
    nextPreview: PlacementPreviewState | null;
  }) => void;
  recordReactCommit: (
    surfaceId: PlacementPreviewReactSurfaceId,
    actualDurationMs: number,
    baseDurationMs: number,
  ) => void;
  getSnapshot: () => PlacementPreviewProfilingSnapshot;
}

function getNowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function createDurationMetricState(): DurationMetricState {
  return {
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    minDurationMs: null,
  };
}

function createReactMetricState(): ReactMetricState {
  return {
    count: 0,
    totalActualDurationMs: 0,
    maxActualDurationMs: 0,
    minActualDurationMs: null,
    totalBaseDurationMs: 0,
    maxBaseDurationMs: 0,
    minBaseDurationMs: null,
  };
}

function createDurationMetricRecord(): Record<
  PlacementPreviewProfilingStageId,
  DurationMetricState
> {
  return Object.fromEntries(
    PLACEMENT_PREVIEW_PROFILING_STAGE_IDS.map((stageId) => [
      stageId,
      createDurationMetricState(),
    ]),
  ) as Record<PlacementPreviewProfilingStageId, DurationMetricState>;
}

function createReactMetricRecord(): Record<
  PlacementPreviewReactSurfaceId,
  ReactMetricState
> {
  return Object.fromEntries(
    PLACEMENT_PREVIEW_REACT_SURFACE_IDS.map((surfaceId) => [
      surfaceId,
      createReactMetricState(),
    ]),
  ) as Record<PlacementPreviewReactSurfaceId, ReactMetricState>;
}

function normalizeDurationMs(durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
}

function clonePlacementPreview(
  preview: PlacementPreviewState | null,
): PlacementPreviewState | null {
  if (!preview) {
    return null;
  }

  return {
    ...preview,
    gridPoint: {
      ...preview.gridPoint,
    },
  };
}

function toDurationSnapshot(
  metric: DurationMetricState,
): PlacementPreviewProfilingDurationSnapshot {
  return {
    count: metric.count,
    totalDurationMs: Number(metric.totalDurationMs.toFixed(3)),
    averageDurationMs:
      metric.count > 0
        ? Number((metric.totalDurationMs / metric.count).toFixed(3))
        : 0,
    maxDurationMs: Number(metric.maxDurationMs.toFixed(3)),
    minDurationMs:
      metric.minDurationMs === null
        ? null
        : Number(metric.minDurationMs.toFixed(3)),
  };
}

function toReactSnapshot(
  metric: ReactMetricState,
): PlacementPreviewProfilingReactSnapshot {
  return {
    count: metric.count,
    totalActualDurationMs: Number(metric.totalActualDurationMs.toFixed(3)),
    averageActualDurationMs:
      metric.count > 0
        ? Number((metric.totalActualDurationMs / metric.count).toFixed(3))
        : 0,
    maxActualDurationMs: Number(metric.maxActualDurationMs.toFixed(3)),
    minActualDurationMs:
      metric.minActualDurationMs === null
        ? null
        : Number(metric.minActualDurationMs.toFixed(3)),
    totalBaseDurationMs: Number(metric.totalBaseDurationMs.toFixed(3)),
    averageBaseDurationMs:
      metric.count > 0
        ? Number((metric.totalBaseDurationMs / metric.count).toFixed(3))
        : 0,
    maxBaseDurationMs: Number(metric.maxBaseDurationMs.toFixed(3)),
    minBaseDurationMs:
      metric.minBaseDurationMs === null
        ? null
        : Number(metric.minBaseDurationMs.toFixed(3)),
  };
}

export function createPlacementPreviewProfiler(): PlacementPreviewProfiler {
  let enabled = false;
  let sampleStartedAt = getNowMs();
  let lastRecordedAt: number | null = null;
  let counts = {
    updateCalls: 0,
    previewChangedCalls: 0,
    previewUnchangedCalls: 0,
    previewPresentCalls: 0,
    previewMissingCalls: 0,
  };
  let latest: PlacementPreviewProfilingSnapshot["latest"] = null;
  let stageMetrics = createDurationMetricRecord();
  let reactMetrics = createReactMetricRecord();

  const touch = () => {
    lastRecordedAt = getNowMs();
  };

  const recordStageDuration: PlacementPreviewProfiler["recordStageDuration"] = (
    stageId,
    durationMs,
  ) => {
    if (!enabled) {
      return;
    }

    const metric = stageMetrics[stageId];
    const normalizedDurationMs = normalizeDurationMs(durationMs);

    metric.count += 1;
    metric.totalDurationMs += normalizedDurationMs;
    metric.maxDurationMs = Math.max(metric.maxDurationMs, normalizedDurationMs);
    metric.minDurationMs =
      metric.minDurationMs === null
        ? normalizedDurationMs
        : Math.min(metric.minDurationMs, normalizedDurationMs);
    touch();
  };

  return {
    isEnabled: () => enabled,
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
    },
    reset() {
      sampleStartedAt = getNowMs();
      lastRecordedAt = null;
      counts = {
        updateCalls: 0,
        previewChangedCalls: 0,
        previewUnchangedCalls: 0,
        previewPresentCalls: 0,
        previewMissingCalls: 0,
      };
      latest = null;
      stageMetrics = createDurationMetricRecord();
      reactMetrics = createReactMetricRecord();
    },
    measureStage(stageId, callback) {
      if (!enabled) {
        return callback();
      }

      const startedAt = getNowMs();

      try {
        return callback();
      } finally {
        recordStageDuration(stageId, getNowMs() - startedAt);
      }
    },
    recordStageDuration,
    recordUpdateResult(options) {
      if (!enabled) {
        return;
      }

      counts.updateCalls += 1;

      if (options.changed) {
        counts.previewChangedCalls += 1;
      } else {
        counts.previewUnchangedCalls += 1;
      }

      if (options.nextPreview) {
        counts.previewPresentCalls += 1;
      } else {
        counts.previewMissingCalls += 1;
      }

      latest = {
        changed: options.changed,
        previousPreview: clonePlacementPreview(options.previousPreview),
        nextPreview: clonePlacementPreview(options.nextPreview),
      };
      touch();
    },
    recordReactCommit(surfaceId, actualDurationMs, baseDurationMs) {
      if (!enabled) {
        return;
      }

      const metric = reactMetrics[surfaceId];
      const normalizedActualDurationMs = normalizeDurationMs(actualDurationMs);
      const normalizedBaseDurationMs = normalizeDurationMs(baseDurationMs);

      metric.count += 1;
      metric.totalActualDurationMs += normalizedActualDurationMs;
      metric.maxActualDurationMs = Math.max(
        metric.maxActualDurationMs,
        normalizedActualDurationMs,
      );
      metric.minActualDurationMs =
        metric.minActualDurationMs === null
          ? normalizedActualDurationMs
          : Math.min(metric.minActualDurationMs, normalizedActualDurationMs);
      metric.totalBaseDurationMs += normalizedBaseDurationMs;
      metric.maxBaseDurationMs = Math.max(
        metric.maxBaseDurationMs,
        normalizedBaseDurationMs,
      );
      metric.minBaseDurationMs =
        metric.minBaseDurationMs === null
          ? normalizedBaseDurationMs
          : Math.min(metric.minBaseDurationMs, normalizedBaseDurationMs);
      touch();
    },
    getSnapshot() {
      return {
        enabled,
        sampleStartedAt: Number(sampleStartedAt.toFixed(3)),
        lastRecordedAt:
          lastRecordedAt === null ? null : Number(lastRecordedAt.toFixed(3)),
        counts: {
          ...counts,
        },
        latest,
        stages: Object.fromEntries(
          PLACEMENT_PREVIEW_PROFILING_STAGE_IDS.map((stageId) => [
            stageId,
            toDurationSnapshot(stageMetrics[stageId]),
          ]),
        ) as PlacementPreviewProfilingSnapshot["stages"],
        reactSurfaces: Object.fromEntries(
          PLACEMENT_PREVIEW_REACT_SURFACE_IDS.map((surfaceId) => [
            surfaceId,
            toReactSnapshot(reactMetrics[surfaceId]),
          ]),
        ) as PlacementPreviewProfilingSnapshot["reactSurfaces"],
      };
    },
  };
}
