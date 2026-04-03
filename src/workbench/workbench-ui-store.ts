import type {
  DockId,
  DockState,
  LeftPanelMode,
  SimulationSpeedPreset,
  WorkbenchMode,
  WorkbenchUiState,
  WorkbenchUiStateInput,
} from "@/workbench/workbench-ui-state";
import { DEFAULT_LOCALE, type AppLocale, type MessageKey } from "@/i18n/messages";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import {
  DEFAULT_WORKBENCH_LOG_LEVEL,
  type LogLevel,
} from "@/shared/logging/logger";

const DOCK_STATE_KEYS = {
  left: "leftDock",
  right: "rightDock",
} as const;

function mergeDockState(
  defaultDock: DockState,
  dockInput?: Partial<DockState>,
): DockState {
  return {
    ...defaultDock,
    ...dockInput,
  };
}

function updateDockState(
  state: WorkbenchUiState,
  dockId: DockId,
  updater: (dock: DockState) => DockState,
): WorkbenchUiState {
  const dockStateKey = DOCK_STATE_KEYS[dockId];
  const currentDock = state[dockStateKey];
  const nextDock = updater(currentDock);

  if (currentDock.open === nextDock.open && currentDock.collapsed === nextDock.collapsed) {
    return state;
  }

  return {
    ...state,
    [dockStateKey]: nextDock,
  } as WorkbenchUiState;
}

export function getWorkbenchStatusMessageKeyForMode(
  mode: WorkbenchMode,
): MessageKey {
  return mode === "edit" ? "status.edit" : "status.simulate";
}

export function createInitialWorkbenchUiState(): WorkbenchUiState {
  return {
    mode: "edit",
    locale: DEFAULT_LOCALE,
    logLevel: DEFAULT_WORKBENCH_LOG_LEVEL,
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

export function createWorkbenchUiState(
  stateInput: WorkbenchUiStateInput = {},
): WorkbenchUiState {
  const initialState = createInitialWorkbenchUiState();
  const mode = stateInput.mode ?? initialState.mode;

  return {
    ...initialState,
    ...stateInput,
    mode,
    leftDock: mergeDockState(initialState.leftDock, stateInput.leftDock),
    rightDock: mergeDockState(initialState.rightDock, stateInput.rightDock),
    statusMessageKey:
      stateInput.statusMessageKey ??
      (stateInput.mode
        ? getWorkbenchStatusMessageKeyForMode(mode)
        : initialState.statusMessageKey),
  };
}

export interface WorkbenchUiStore
  extends Pick<SnapshotStore<WorkbenchUiState>, "getSnapshot" | "subscribe"> {
  setMode: (mode: WorkbenchMode) => void;
  setLocale: (locale: AppLocale) => void;
  setLogLevel: (level: LogLevel) => void;
  setDiagnosticsVisible: (visible: boolean) => void;
  setLeftPanelMode: (mode: LeftPanelMode) => void;
  setSimulationSpeedPreset: (preset: SimulationSpeedPreset) => void;
  setDockOpen: (dockId: DockId, open: boolean) => void;
  toggleDockCollapsed: (dockId: DockId) => void;
  setStatusMessageKey: (messageKey: MessageKey) => void;
}

class WorkbenchUiStoreImpl implements WorkbenchUiStore {
  private readonly store: SnapshotStore<WorkbenchUiState>;

  constructor(initialState: WorkbenchUiStateInput = {}) {
    this.store = createSnapshotStore(createWorkbenchUiState(initialState));
  }

  getSnapshot = () => this.store.getSnapshot();

  subscribe = (listener: () => void) => this.store.subscribe(listener);

  setMode(mode: WorkbenchMode): void {
    const statusMessageKey = getWorkbenchStatusMessageKeyForMode(mode);

    this.updateState((state) => {
      if (state.mode === mode && state.statusMessageKey === statusMessageKey) {
        return state;
      }

      return {
        ...state,
        mode,
        statusMessageKey,
      };
    });
  }

  setLocale(locale: AppLocale): void {
    this.updateState((state) => {
      if (state.locale === locale) {
        return state;
      }

      return {
        ...state,
        locale,
      };
    });
  }

  setLogLevel(level: LogLevel): void {
    this.updateState((state) => {
      if (state.logLevel === level) {
        return state;
      }

      return {
        ...state,
        logLevel: level,
      };
    });
  }

  setDiagnosticsVisible(visible: boolean): void {
    this.updateState((state) => {
      if (state.diagnosticsVisible === visible) {
        return state;
      }

      return {
        ...state,
        diagnosticsVisible: visible,
      };
    });
  }

  setLeftPanelMode(mode: LeftPanelMode): void {
    this.updateState((state) => {
      if (state.leftPanelMode === mode) {
        return state;
      }

      return {
        ...state,
        leftPanelMode: mode,
      };
    });
  }

  setSimulationSpeedPreset(preset: SimulationSpeedPreset): void {
    this.updateState((state) => {
      if (state.simulationSpeed === preset) {
        return state;
      }

      return {
        ...state,
        simulationSpeed: preset,
      };
    });
  }

  setDockOpen(dockId: DockId, open: boolean): void {
    this.updateState((state) =>
      updateDockState(state, dockId, (dock) => ({
        ...dock,
        open,
        collapsed: open ? dock.collapsed : false,
      })),
    );
  }

  toggleDockCollapsed(dockId: DockId): void {
    this.updateState((state) =>
      updateDockState(state, dockId, (dock) => ({
        open: true,
        collapsed: !dock.collapsed,
      })),
    );
  }

  setStatusMessageKey(messageKey: MessageKey): void {
    this.updateState((state) => {
      if (state.statusMessageKey === messageKey) {
        return state;
      }

      return {
        ...state,
        statusMessageKey: messageKey,
      };
    });
  }

  private updateState(
    updater: (state: WorkbenchUiState) => WorkbenchUiState,
  ): void {
    this.store.update(updater);
  }
}

export function createWorkbenchUiStore(
  initialState: WorkbenchUiStateInput = {},
): WorkbenchUiStore {
  return new WorkbenchUiStoreImpl(initialState);
}

export const createInitialWorkbenchUiSnapshot = createInitialWorkbenchUiState;
export const createWorkbenchUiSnapshot = createWorkbenchUiState;
