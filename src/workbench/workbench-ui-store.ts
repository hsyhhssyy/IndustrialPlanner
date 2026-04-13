import type {
  DockId,
  DockState,
  LeftPanelMode,
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
    left.locale === right.locale &&
    left.logLevel === right.logLevel &&
    left.leftPanelMode === right.leftPanelMode &&
    isSameDockState(left.leftDock, right.leftDock) &&
    isSameDockState(left.rightDock, right.rightDock) &&
    left.diagnosticsVisible === right.diagnosticsVisible &&
    left.statusMessageKey === right.statusMessageKey
  );
}

export function createInitialWorkbenchUiState(): WorkbenchUiState {
  return {
    locale: DEFAULT_LOCALE,
    logLevel: DEFAULT_WORKBENCH_LOG_LEVEL,
    leftPanelMode: "placement",
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

  return {
    ...initialState,
    ...stateInput,
    leftDock: mergeDockState(initialState.leftDock, stateInput.leftDock),
    rightDock: mergeDockState(initialState.rightDock, stateInput.rightDock),
    statusMessageKey: stateInput.statusMessageKey ?? initialState.statusMessageKey,
  };
}

export interface WorkbenchUiStore
  extends ReadonlySnapshotStore<WorkbenchUiState> {
  locale: AppLocale;
  logLevel: LogLevel;
  leftPanelMode: LeftPanelMode;
  leftDock: DockState;
  rightDock: DockState;
  diagnosticsVisible: boolean;
  statusMessageKey: MessageKey;
  setSnapshot: (
    stateInput: WorkbenchUiStateInput | WorkbenchUiState,
  ) => boolean;
  update: (updater: (state: WorkbenchUiState) => WorkbenchUiState) => boolean;
  setLocale: (locale: AppLocale) => void;
  setLogLevel: (level: LogLevel) => void;
  setDiagnosticsVisible: (visible: boolean) => void;
  setLeftPanelMode: (mode: LeftPanelMode) => void;
  setDockOpen: (dockId: DockId, open: boolean) => void;
  toggleDockCollapsed: (dockId: DockId) => void;
  setStatusMessageKey: (messageKey: MessageKey) => void;
}

class WorkbenchUiStoreImpl implements WorkbenchUiStore {
  locale: AppLocale;
  logLevel: LogLevel;
  leftPanelMode: LeftPanelMode;
  leftDock: DockState;
  rightDock: DockState;
  diagnosticsVisible: boolean;
  statusMessageKey: MessageKey;

  readonly #snapshotBridge;

  constructor(initialState: WorkbenchUiStateInput = {}) {
    const initialSnapshot = createWorkbenchUiState(initialState);
    this.locale = initialSnapshot.locale;
    this.logLevel = initialSnapshot.logLevel;
    this.leftPanelMode = initialSnapshot.leftPanelMode;
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
    if (this.locale !== snapshot.locale) {
      this.locale = snapshot.locale;
    }

    if (this.logLevel !== snapshot.logLevel) {
      this.logLevel = snapshot.logLevel;
    }

    if (this.leftPanelMode !== snapshot.leftPanelMode) {
      this.leftPanelMode = snapshot.leftPanelMode;
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
