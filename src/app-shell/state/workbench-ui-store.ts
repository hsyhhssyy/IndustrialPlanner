import type {
  DockId,
  DockState,
  LeftPanelMode,
  SimulationSpeedPreset,
  WorkbenchMode,
  WorkbenchUiSnapshot,
  WorkbenchUiSnapshotInput,
} from "@/app-shell/contracts/workbench-ui";
import { DEFAULT_LOCALE, type AppLocale, type MessageKey } from "@/i18n/messages";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";

const DOCK_SNAPSHOT_KEYS = {
  left: "leftDock",
  right: "rightDock",
} as const;

function mergeDockSnapshot(
  defaultDock: DockState,
  dockInput?: Partial<DockState>,
): DockState {
  return {
    ...defaultDock,
    ...dockInput,
  };
}

function updateDockSnapshot(
  snapshot: WorkbenchUiSnapshot,
  dockId: DockId,
  updater: (dock: DockState) => DockState,
): WorkbenchUiSnapshot {
  const dockSnapshotKey = DOCK_SNAPSHOT_KEYS[dockId];
  const currentDock = snapshot[dockSnapshotKey];
  const nextDock = updater(currentDock);

  if (
    currentDock.open === nextDock.open &&
    currentDock.collapsed === nextDock.collapsed
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    [dockSnapshotKey]: nextDock,
  } as WorkbenchUiSnapshot;
}

export function getWorkbenchStatusMessageKeyForMode(
  mode: WorkbenchMode,
): MessageKey {
  return mode === "edit" ? "status.edit" : "status.simulate";
}

export function createInitialWorkbenchUiSnapshot(): WorkbenchUiSnapshot {
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

export function createWorkbenchUiSnapshot(
  snapshotInput: WorkbenchUiSnapshotInput = {},
): WorkbenchUiSnapshot {
  const initialSnapshot = createInitialWorkbenchUiSnapshot();
  const mode = snapshotInput.mode ?? initialSnapshot.mode;

  return {
    ...initialSnapshot,
    ...snapshotInput,
    mode,
    leftDock: mergeDockSnapshot(initialSnapshot.leftDock, snapshotInput.leftDock),
    rightDock: mergeDockSnapshot(initialSnapshot.rightDock, snapshotInput.rightDock),
    statusMessageKey:
      snapshotInput.statusMessageKey ??
      (snapshotInput.mode
        ? getWorkbenchStatusMessageKeyForMode(mode)
        : initialSnapshot.statusMessageKey),
  };
}

export interface WorkbenchUiStore
  extends Pick<SnapshotStore<WorkbenchUiSnapshot>, "getSnapshot" | "subscribe"> {
  setMode: (mode: WorkbenchMode) => void;
  setLocale: (locale: AppLocale) => void;
  setDiagnosticsVisible: (visible: boolean) => void;
  setLeftPanelMode: (mode: LeftPanelMode) => void;
  setSimulationSpeedPreset: (preset: SimulationSpeedPreset) => void;
  setDockOpen: (dockId: DockId, open: boolean) => void;
  toggleDockCollapsed: (dockId: DockId) => void;
  setStatusMessageKey: (messageKey: MessageKey) => void;
}

class WorkbenchUiStoreImpl implements WorkbenchUiStore {
  private readonly store: SnapshotStore<WorkbenchUiSnapshot>;

  constructor(initialSnapshot: WorkbenchUiSnapshotInput = {}) {
    this.store = createSnapshotStore(createWorkbenchUiSnapshot(initialSnapshot));
  }

  getSnapshot = () => this.store.getSnapshot();

  subscribe = (listener: () => void) => this.store.subscribe(listener);

  setMode(mode: WorkbenchMode): void {
    const statusMessageKey = getWorkbenchStatusMessageKeyForMode(mode);

    this.updateSnapshot((snapshot) => {
      if (
        snapshot.mode === mode &&
        snapshot.statusMessageKey === statusMessageKey
      ) {
        return snapshot;
      }

      return {
        ...snapshot,
        mode,
        statusMessageKey,
      };
    });
  }

  setLocale(locale: AppLocale): void {
    this.updateSnapshot((snapshot) => {
      if (snapshot.locale === locale) {
        return snapshot;
      }

      return {
        ...snapshot,
        locale,
      };
    });
  }

  setDiagnosticsVisible(visible: boolean): void {
    this.updateSnapshot((snapshot) => {
      if (snapshot.diagnosticsVisible === visible) {
        return snapshot;
      }

      return {
        ...snapshot,
        diagnosticsVisible: visible,
      };
    });
  }

  setLeftPanelMode(mode: LeftPanelMode): void {
    this.updateSnapshot((snapshot) => {
      if (snapshot.leftPanelMode === mode) {
        return snapshot;
      }

      return {
        ...snapshot,
        leftPanelMode: mode,
      };
    });
  }

  setSimulationSpeedPreset(preset: SimulationSpeedPreset): void {
    this.updateSnapshot((snapshot) => {
      if (snapshot.simulationSpeed === preset) {
        return snapshot;
      }

      return {
        ...snapshot,
        simulationSpeed: preset,
      };
    });
  }

  setDockOpen(dockId: DockId, open: boolean): void {
    this.updateSnapshot((snapshot) =>
      updateDockSnapshot(snapshot, dockId, (dock) => ({
        ...dock,
        open,
        collapsed: open ? dock.collapsed : false,
      })),
    );
  }

  toggleDockCollapsed(dockId: DockId): void {
    this.updateSnapshot((snapshot) =>
      updateDockSnapshot(snapshot, dockId, (dock) => ({
        open: true,
        collapsed: !dock.collapsed,
      })),
    );
  }

  setStatusMessageKey(messageKey: MessageKey): void {
    this.updateSnapshot((snapshot) => {
      if (snapshot.statusMessageKey === messageKey) {
        return snapshot;
      }

      return {
        ...snapshot,
        statusMessageKey: messageKey,
      };
    });
  }

  private updateSnapshot(
    updater: (snapshot: WorkbenchUiSnapshot) => WorkbenchUiSnapshot,
  ): void {
    const currentSnapshot = this.store.getSnapshot();
    const nextSnapshot = updater(currentSnapshot);

    if (nextSnapshot === currentSnapshot) {
      return;
    }

    this.store.setSnapshot(nextSnapshot);
  }
}

export function createWorkbenchUiStore(
  initialSnapshot: WorkbenchUiSnapshotInput = {},
): WorkbenchUiStore {
  return new WorkbenchUiStoreImpl(initialSnapshot);
}
