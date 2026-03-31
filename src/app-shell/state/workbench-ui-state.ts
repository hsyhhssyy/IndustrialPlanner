import { DEFAULT_LOCALE, type AppLocale, type MessageKey } from "@/i18n/messages";

export type WorkbenchMode = "edit" | "simulate";
export type LeftPanelMode = "placement" | "delete" | "blueprint" | "history";
export type SimulationSpeedPreset = "0.25x" | "1x" | "2x" | "4x" | "16x";

export type DockId = "left" | "right";

export interface DockState {
  open: boolean;
  collapsed: boolean;
}

export interface WorkbenchUiState {
  mode: WorkbenchMode;
  locale: AppLocale;
  leftPanelMode: LeftPanelMode;
  simulationSpeed: SimulationSpeedPreset;
  leftDock: DockState;
  rightDock: DockState;
  diagnosticsVisible: boolean;
  statusMessageKey: MessageKey;
}

const DOCK_STATE_KEYS = {
  left: "leftDock",
  right: "rightDock",
} as const;

export function createInitialWorkbenchUiState(): WorkbenchUiState {
  return {
    mode: "edit",
    locale: DEFAULT_LOCALE,
    leftPanelMode: "placement",
    simulationSpeed: "1x",
    leftDock: {
      open: true,
      collapsed: false,
    },
    rightDock: {
      open: true,
      collapsed: false,
    },
    diagnosticsVisible: true,
    statusMessageKey: "status.ready",
  };
}

export function setDockOpen(
  uiState: WorkbenchUiState,
  dockId: DockId,
  open: boolean,
): WorkbenchUiState {
  const dockStateKey = DOCK_STATE_KEYS[dockId];
  const dockState = uiState[dockStateKey];

  return {
    ...uiState,
    [dockStateKey]: {
      ...dockState,
      open,
      collapsed: open ? dockState.collapsed : false,
    },
  } as WorkbenchUiState;
}

export function toggleDockCollapsed(
  uiState: WorkbenchUiState,
  dockId: DockId,
): WorkbenchUiState {
  const dockStateKey = DOCK_STATE_KEYS[dockId];
  const dockState = uiState[dockStateKey];

  return {
    ...uiState,
    [dockStateKey]: {
      open: true,
      collapsed: !dockState.collapsed,
    },
  } as WorkbenchUiState;
}

export function setDiagnosticsVisible(
  uiState: WorkbenchUiState,
  diagnosticsVisible: boolean,
): WorkbenchUiState {
  return {
    ...uiState,
    diagnosticsVisible,
  };
}

export function setLocale(
  uiState: WorkbenchUiState,
  locale: AppLocale,
): WorkbenchUiState {
  return {
    ...uiState,
    locale,
  };
}

export function setLeftPanelMode(
  uiState: WorkbenchUiState,
  leftPanelMode: LeftPanelMode,
): WorkbenchUiState {
  return {
    ...uiState,
    leftPanelMode,
  };
}

export function setSimulationSpeed(
  uiState: WorkbenchUiState,
  simulationSpeed: SimulationSpeedPreset,
): WorkbenchUiState {
  return {
    ...uiState,
    simulationSpeed,
  };
}
