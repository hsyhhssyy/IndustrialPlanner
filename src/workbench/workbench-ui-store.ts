import type {
  DockId,
  DockState,
  LeftPanelMode,
  SimulationSpeedPreset,
  WorkbenchPhase,
  WorkbenchUiState,
  WorkbenchUiStateInput,
} from "@/workbench/workbench-ui-state";
import { DEFAULT_LOCALE, type AppLocale, type MessageKey } from "@/i18n/messages";
import {
  DEFAULT_WORKBENCH_LOG_LEVEL,
  type LogLevel,
} from "@/shared/logging/logger";
import { makeAutoObservable } from "@/shared/mobx";
import { createSnapshotBridge } from "@/shared/mobx/snapshot-bridge";
import type { ReadonlySnapshotStore } from "@/workbench/workspace-store";

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

function isSameDockState(left: DockState, right: DockState): boolean {
  return left.open === right.open && left.collapsed === right.collapsed;
}

export function isSameWorkbenchUiState(
  left: WorkbenchUiState,
  right: WorkbenchUiState,
): boolean {
  return (
    left.phase === right.phase &&
    left.locale === right.locale &&
    left.logLevel === right.logLevel &&
    left.leftPanelMode === right.leftPanelMode &&
    left.simulationSpeed === right.simulationSpeed &&
    isSameDockState(left.leftDock, right.leftDock) &&
    isSameDockState(left.rightDock, right.rightDock) &&
    left.diagnosticsVisible === right.diagnosticsVisible &&
    left.statusMessageKey === right.statusMessageKey
  );
}

export function getWorkbenchStatusMessageKeyForMode(
  phase: WorkbenchPhase,
): MessageKey {
  return phase === "edit" ? "status.edit" : "status.simulate";
}

export function createInitialWorkbenchUiState(): WorkbenchUiState {
  return {
    phase: "edit",
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
  const phase = stateInput.phase ?? initialState.phase;

  return {
    ...initialState,
    ...stateInput,
    phase,
    simulationSpeed: initialState.simulationSpeed,
    leftDock: mergeDockState(initialState.leftDock, stateInput.leftDock),
    rightDock: mergeDockState(initialState.rightDock, stateInput.rightDock),
    statusMessageKey:
      stateInput.statusMessageKey ??
      (stateInput.phase
        ? getWorkbenchStatusMessageKeyForMode(phase)
        : initialState.statusMessageKey),
  };
}

export interface WorkbenchUiStore
  extends ReadonlySnapshotStore<WorkbenchUiState> {
  phase: WorkbenchPhase;
  locale: AppLocale;
  logLevel: LogLevel;
  leftPanelMode: LeftPanelMode;
  simulationSpeed: SimulationSpeedPreset;
  leftDock: DockState;
  rightDock: DockState;
  diagnosticsVisible: boolean;
  statusMessageKey: MessageKey;
  setSnapshot: (
    stateInput: WorkbenchUiStateInput | WorkbenchUiState,
  ) => boolean;
  update: (updater: (state: WorkbenchUiState) => WorkbenchUiState) => boolean;
  setPhase: (phase: WorkbenchPhase) => void;
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
  phase: WorkbenchPhase;
  locale: AppLocale;
  logLevel: LogLevel;
  leftPanelMode: LeftPanelMode;
  simulationSpeed: SimulationSpeedPreset;
  leftDock: DockState;
  rightDock: DockState;
  diagnosticsVisible: boolean;
  statusMessageKey: MessageKey;

  readonly #snapshotBridge;

  constructor(initialState: WorkbenchUiStateInput = {}) {
    const initialSnapshot = createWorkbenchUiState(initialState);
    this.phase = initialSnapshot.phase;
    this.locale = initialSnapshot.locale;
    this.logLevel = initialSnapshot.logLevel;
    this.leftPanelMode = initialSnapshot.leftPanelMode;
    this.simulationSpeed = initialSnapshot.simulationSpeed;
    this.leftDock = { ...initialSnapshot.leftDock };
    this.rightDock = { ...initialSnapshot.rightDock };
    this.diagnosticsVisible = initialSnapshot.diagnosticsVisible;
    this.statusMessageKey = initialSnapshot.statusMessageKey;
    this.#snapshotBridge = createSnapshotBridge(initialSnapshot);

    makeAutoObservable(
      this,
      {
        getSnapshot: false,
        subscribe: false,
      },
      {
        autoBind: true,
      },
    );
  }

  getSnapshot() {
    return this.#snapshotBridge.getSnapshot();
  }

  subscribe(listener: () => void) {
    return this.#snapshotBridge.subscribe(listener);
  }

  setSnapshot(stateInput: WorkbenchUiStateInput | WorkbenchUiState): boolean {
    const nextState = createWorkbenchUiState(stateInput);
    const currentState = this.#snapshotBridge.getSnapshot();

    if (isSameWorkbenchUiState(currentState, nextState)) {
      return false;
    }

    this.applySnapshot(nextState);
    this.#snapshotBridge.publish(nextState);
    return true;
  }

  update(updater: (state: WorkbenchUiState) => WorkbenchUiState): boolean {
    const currentState = this.#snapshotBridge.getSnapshot();
    const nextState = updater(currentState);

    if (nextState === currentState) {
      return false;
    }

    return this.setSnapshot(nextState);
  }

  setPhase(phase: WorkbenchPhase): void {
    const statusMessageKey = getWorkbenchStatusMessageKeyForMode(phase);

    this.update((state) => {
      if (state.phase === phase && state.statusMessageKey === statusMessageKey) {
        return state;
      }

      return {
        ...state,
        phase,
        statusMessageKey,
      };
    });
  }

  setLocale(locale: AppLocale): void {
    this.update((state) => {
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
    this.update((state) => {
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
    this.update((state) => {
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
    this.update((state) => {
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
    void preset;
  }

  setDockOpen(dockId: DockId, open: boolean): void {
    this.update((state) => {
      const dockStateKey = DOCK_STATE_KEYS[dockId];
      const currentDock = state[dockStateKey];
      const nextDock = {
        ...currentDock,
        open,
        collapsed: open ? currentDock.collapsed : false,
      };

      if (isSameDockState(currentDock, nextDock)) {
        return state;
      }

      return {
        ...state,
        [dockStateKey]: nextDock,
      } as WorkbenchUiState;
    });
  }

  toggleDockCollapsed(dockId: DockId): void {
    this.update((state) => {
      const dockStateKey = DOCK_STATE_KEYS[dockId];
      const currentDock = state[dockStateKey];
      const nextDock = {
        open: true,
        collapsed: !currentDock.collapsed,
      };

      if (isSameDockState(currentDock, nextDock)) {
        return state;
      }

      return {
        ...state,
        [dockStateKey]: nextDock,
      } as WorkbenchUiState;
    });
  }

  setStatusMessageKey(messageKey: MessageKey): void {
    this.update((state) => {
      if (state.statusMessageKey === messageKey) {
        return state;
      }

      return {
        ...state,
        statusMessageKey: messageKey,
      };
    });
  }

  private applySnapshot(snapshot: WorkbenchUiState): void {
    if (this.phase !== snapshot.phase) {
      this.phase = snapshot.phase;
    }

    if (this.locale !== snapshot.locale) {
      this.locale = snapshot.locale;
    }

    if (this.logLevel !== snapshot.logLevel) {
      this.logLevel = snapshot.logLevel;
    }

    if (this.leftPanelMode !== snapshot.leftPanelMode) {
      this.leftPanelMode = snapshot.leftPanelMode;
    }

    if (this.simulationSpeed !== snapshot.simulationSpeed) {
      this.simulationSpeed = snapshot.simulationSpeed;
    }

    if (!isSameDockState(this.leftDock, snapshot.leftDock)) {
      this.leftDock = { ...snapshot.leftDock };
    }

    if (!isSameDockState(this.rightDock, snapshot.rightDock)) {
      this.rightDock = { ...snapshot.rightDock };
    }

    if (this.diagnosticsVisible !== snapshot.diagnosticsVisible) {
      this.diagnosticsVisible = snapshot.diagnosticsVisible;
    }

    if (this.statusMessageKey !== snapshot.statusMessageKey) {
      this.statusMessageKey = snapshot.statusMessageKey;
    }
  }
}

export function createWorkbenchUiStore(
  initialState: WorkbenchUiStateInput = {},
): WorkbenchUiStore {
  return new WorkbenchUiStoreImpl(initialState);
}

export const createInitialWorkbenchUiSnapshot = createInitialWorkbenchUiState;
export const createWorkbenchUiSnapshot = createWorkbenchUiState;
