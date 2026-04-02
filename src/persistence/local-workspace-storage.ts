import type {
  DockState,
  WorkbenchUiSnapshot,
  WorkbenchUiSnapshotInput,
} from "@/app-shell/contracts/workbench-ui";

const UI_STATE_KEY = "industrial-planner:workbench-ui-state";

export interface WorkspaceStorageGateway {
  loadUiSnapshot: () => WorkbenchUiSnapshotInput;
  saveUiSnapshot: (uiSnapshot: WorkbenchUiSnapshot) => void;
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

const DOCK_STATE_KEYS = new Set<keyof DockState>(["open", "collapsed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isDockStateInput(value: unknown): value is Partial<DockState> {
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

function isWorkbenchUiSnapshotInput(
  value: unknown,
): value is WorkbenchUiSnapshotInput {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(value, WORKBENCH_UI_SNAPSHOT_KEYS)
  ) {
    return false;
  }

  if (value.mode !== undefined && value.mode !== "edit" && value.mode !== "simulate") {
    return false;
  }

  if (
    value.locale !== undefined &&
    value.locale !== "zh-CN" &&
    value.locale !== "en-US"
  ) {
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

  if (
    value.diagnosticsVisible !== undefined &&
    typeof value.diagnosticsVisible !== "boolean"
  ) {
    return false;
  }

  if (
    value.statusMessageKey !== undefined &&
    typeof value.statusMessageKey !== "string"
  ) {
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

export function createWorkspaceStorageGateway(): WorkspaceStorageGateway {
  return {
    loadUiSnapshot: () => {
      if (!canUseStorage()) {
        return {};
      }

      const raw = localStorage.getItem(UI_STATE_KEY);

      if (!raw) {
        return {};
      }

      try {
        const parsed = JSON.parse(raw) as unknown;

        if (!isWorkbenchUiSnapshotInput(parsed)) {
          localStorage.removeItem(UI_STATE_KEY);
          return {};
        }

        return parsed;
      } catch {
        localStorage.removeItem(UI_STATE_KEY);
        return {};
      }
    },
    saveUiSnapshot: (uiSnapshot) => {
      if (!canUseStorage()) {
        return;
      }

      localStorage.setItem(UI_STATE_KEY, JSON.stringify(uiSnapshot));
    },
  };
}
