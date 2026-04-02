import type { WorkbenchUiSnapshotInput } from "@/app-shell/contracts/workbench-ui";
import type { CanvasPoint, CanvasViewport } from "@/canvas/canvas-host";

const UI_STATE_KEY = "industrial-planner:workbench-ui-state";

export interface WorkspacePersistenceSnapshot {
  ui: WorkbenchUiSnapshotInput;
  canvasViewport?: Partial<CanvasViewport>;
}

export interface WorkspaceStorageGateway {
  loadWorkspaceSnapshot: () => WorkspacePersistenceSnapshot;
  saveWorkspaceSnapshot: (snapshot: WorkspacePersistenceSnapshot) => void;
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

const WORKBENCH_UI_SNAPSHOT_KEYS = new Set<keyof WorkbenchUiSnapshotInput>([
  "mode",
  "locale",
  "leftPanelMode",
  "simulationSpeed",
  "diagnosticsVisible",
  "statusMessageKey",
  "leftDock",
  "rightDock",
]);

const WORKSPACE_PERSISTENCE_KEYS = new Set([
  "canvasViewport",
  ...WORKBENCH_UI_SNAPSHOT_KEYS,
]);
const DOCK_STATE_KEYS = new Set(["open", "collapsed"]);
const CANVAS_POINT_KEYS = new Set(["x", "y"]);
const CANVAS_VIEWPORT_KEYS = new Set(["offset", "zoom", "size"]);

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

function isCanvasViewportInput(value: unknown): value is Partial<CanvasViewport> {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, CANVAS_VIEWPORT_KEYS)) {
    return false;
  }

  if (value.offset !== undefined && !isCanvasPointInput(value.offset)) {
    return false;
  }

  if (value.size !== undefined && !isCanvasPointInput(value.size)) {
    return false;
  }

  if (value.zoom !== undefined && typeof value.zoom !== "number") {
    return false;
  }

  return true;
}

function isWorkbenchUiSnapshotInput(
  value: unknown,
): value is WorkbenchUiSnapshotInput {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, WORKBENCH_UI_SNAPSHOT_KEYS)) {
    return false;
  }

  if (value.mode !== undefined && value.mode !== "edit" && value.mode !== "simulate") {
    return false;
  }

  if (value.locale !== undefined && value.locale !== "zh-CN" && value.locale !== "en-US") {
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

  if (
    value.simulationSpeed !== undefined &&
    value.simulationSpeed !== "0.25x" &&
    value.simulationSpeed !== "1x" &&
    value.simulationSpeed !== "2x" &&
    value.simulationSpeed !== "4x" &&
    value.simulationSpeed !== "16x"
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

export function createWorkspaceStorageGateway(): WorkspaceStorageGateway {
  return {
    loadWorkspaceSnapshot: () => {
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
          localStorage.removeItem(UI_STATE_KEY);
          return { ui: {} };
        }

        const { canvasViewport, ...uiCandidate } = parsed;

        if (!isWorkbenchUiSnapshotInput(uiCandidate)) {
          localStorage.removeItem(UI_STATE_KEY);
          return { ui: {} };
        }

        if (canvasViewport !== undefined && !isCanvasViewportInput(canvasViewport)) {
          localStorage.removeItem(UI_STATE_KEY);
          return { ui: {} };
        }

        return {
          ui: uiCandidate,
          canvasViewport,
        };
      } catch {
        localStorage.removeItem(UI_STATE_KEY);
        return { ui: {} };
      }
    },
    saveWorkspaceSnapshot: (snapshot) => {
      if (!canUseStorage()) {
        return;
      }

      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          ...snapshot.ui,
          canvasViewport: snapshot.canvasViewport,
        }),
      );
    },
  };
}
