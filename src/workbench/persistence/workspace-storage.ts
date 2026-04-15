import type { WorkbenchUiStateInput } from "@/workbench/state/workbench-ui-state";
import type {
  CanvasPoint,
  CanvasViewState,
} from "@/workspace/workspace-state";
import {
  createLogger,
  isLogLevel,
} from "@/shared/logging/logger";

const UI_STATE_KEY = "industrial-planner:workbench-ui-state";
const logger = createLogger("workbench.storage");

export interface WorkspacePersistenceState {
  ui: WorkbenchUiStateInput;
  canvasView?: Partial<CanvasViewState>;
}

export interface WorkspaceStorage {
  loadWorkspaceState: () => WorkspacePersistenceState;
  saveWorkspaceState: (state: WorkspacePersistenceState) => void;
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

const WORKBENCH_UI_STATE_KEYS = new Set<keyof WorkbenchUiStateInput>([
  "locale",
  "logLevel",
  "leftPanelMode",
  "diagnosticsVisible",
  "statusMessageKey",
  "leftDock",
  "rightDock",
]);
const LEGACY_WORKBENCH_UI_STATE_KEYS = new Set([
  "mode",
  "phase",
  "simulationSpeed",
]);

const WORKSPACE_PERSISTENCE_KEYS = new Set([
  "canvasView",
  "canvasViewport",
  ...LEGACY_WORKBENCH_UI_STATE_KEYS,
  ...WORKBENCH_UI_STATE_KEYS,
]);
const DOCK_STATE_KEYS = new Set(["open", "collapsed"]);
const CANVAS_POINT_KEYS = new Set(["x", "y"]);
const CANVAS_VIEW_KEYS = new Set(["offset", "zoom"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isDockStateInput(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, DOCK_STATE_KEYS)) {
    return false;
  }

  if (value.open !== undefined && typeof value.open !== "boolean") {
    return false;
  }

  if (value.collapsed !== undefined && typeof value.collapsed !== "boolean") {
    return false;
  }

  return true;
}

function isCanvasPointInput(value: unknown): value is Partial<CanvasPoint> {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, CANVAS_POINT_KEYS)) {
    return false;
  }

  if (value.x !== undefined && typeof value.x !== "number") {
    return false;
  }

  if (value.y !== undefined && typeof value.y !== "number") {
    return false;
  }

  return true;
}

function isCanvasViewInput(value: unknown): value is Partial<CanvasViewState> {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, CANVAS_VIEW_KEYS)) {
    return false;
  }

  if (value.offset !== undefined && !isCanvasPointInput(value.offset)) {
    return false;
  }

  if (value.zoom !== undefined && typeof value.zoom !== "number") {
    return false;
  }

  return true;
}

function isWorkbenchUiStateInput(
  value: unknown,
): value is WorkbenchUiStateInput {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, WORKBENCH_UI_STATE_KEYS)) {
    return false;
  }

  if (
    value.locale !== undefined &&
    value.locale !== "zh-CN" &&
    value.locale !== "en-US"
  ) {
    return false;
  }

  if (value.logLevel !== undefined && !isLogLevel(value.logLevel)) {
    return false;
  }

  if (
    value.leftPanelMode !== undefined &&
    value.leftPanelMode !== "placement" &&
    value.leftPanelMode !== "delete" &&
    value.leftPanelMode !== "blueprint" &&
    value.leftPanelMode !== "history"
  ) {
    return false;
  }

  if (value.diagnosticsVisible !== undefined && typeof value.diagnosticsVisible !== "boolean") {
    return false;
  }

  if (value.statusMessageKey !== undefined && typeof value.statusMessageKey !== "string") {
    return false;
  }

  if (value.leftDock !== undefined && !isDockStateInput(value.leftDock)) {
    return false;
  }

  if (value.rightDock !== undefined && !isDockStateInput(value.rightDock)) {
    return false;
  }

  return true;
}

function isWorkspacePersistenceInput(
  value: unknown,
): value is Record<string, unknown> {
  return isRecord(value) && hasOnlyAllowedKeys(value, WORKSPACE_PERSISTENCE_KEYS);
}

function normalizePersistedUiCandidate(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const {
    mode: _legacyMode,
    phase: _legacyPhase,
    simulationSpeed: _legacySimulationSpeed,
    ...rest
  } = value;

  if (rest.statusMessageKey === "status.simulate") {
    return {
      ...rest,
      statusMessageKey: "status.edit",
    };
  }

  return rest;
}

export function createWorkspaceStorage(): WorkspaceStorage {
  return {
    loadWorkspaceState: () => {
      if (!canUseStorage()) {
        return { ui: {} };
      }

      const raw = localStorage.getItem(UI_STATE_KEY);

      if (!raw) {
        return { ui: {} };
      }

      try {
        const parsed = JSON.parse(raw) as unknown;

        if (!isWorkspacePersistenceInput(parsed)) {
          logger.warn(
            "Discarded incompatible persisted workspace snapshot because the root shape is invalid.",
          );
          localStorage.removeItem(UI_STATE_KEY);
          return { ui: {} };
        }

        const { canvasView, canvasViewport, ...rawUiCandidate } = parsed;
        const persistedCanvasView = canvasView ?? canvasViewport;
        const uiCandidate = normalizePersistedUiCandidate(rawUiCandidate);

        if (!isWorkbenchUiStateInput(uiCandidate)) {
          logger.warn(
            "Discarded incompatible persisted workspace snapshot because the UI state is invalid.",
          );
          localStorage.removeItem(UI_STATE_KEY);
          return { ui: {} };
        }

        if (persistedCanvasView !== undefined && !isCanvasViewInput(persistedCanvasView)) {
          logger.warn(
            "Discarded incompatible persisted workspace snapshot because the canvas view is invalid.",
          );
          localStorage.removeItem(UI_STATE_KEY);
          return { ui: {} };
        }

        return {
          ui: uiCandidate,
          canvasView: persistedCanvasView,
        };
      } catch (error) {
        logger.warn(
          "Failed to parse persisted workspace snapshot. Clearing the stored snapshot.",
          error,
        );
        localStorage.removeItem(UI_STATE_KEY);
        return { ui: {} };
      }
    },
    saveWorkspaceState: (state) => {
      if (!canUseStorage()) {
        return;
      }

      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          ...state.ui,
          canvasViewport: state.canvasView,
        }),
      );
    },
  };
}

export type WorkspacePersistenceSnapshot = WorkspacePersistenceState;
export type WorkspaceStorageGateway = WorkspaceStorage;
export const createWorkspaceStorageGateway = createWorkspaceStorage;
