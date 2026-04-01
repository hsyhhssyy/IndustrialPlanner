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

type PersistedWorkbenchUiSnapshot = WorkbenchUiSnapshotInput & {
  leftDockOpen?: boolean;
  rightDockOpen?: boolean;
  bottomDockOpen?: boolean;
  statusMessage?: string;
};

function toDockSnapshot(
  dockState: Partial<DockState> | undefined,
  legacyOpen: boolean | undefined,
): Partial<DockState> | undefined {
  const nextDockSnapshot: Partial<DockState> = {};

  if (dockState?.open !== undefined) {
    nextDockSnapshot.open = dockState.open;
  } else if (legacyOpen !== undefined) {
    nextDockSnapshot.open = legacyOpen;
  }

  if (dockState?.collapsed !== undefined) {
    nextDockSnapshot.collapsed = dockState.collapsed;
  }

  return Object.keys(nextDockSnapshot).length > 0 ? nextDockSnapshot : undefined;
}

function coercePersistedWorkbenchUiSnapshot(
  parsed: PersistedWorkbenchUiSnapshot,
): WorkbenchUiSnapshotInput {
  return {
    mode: parsed.mode,
    locale: parsed.locale,
    leftPanelMode: parsed.leftPanelMode,
    simulationSpeed: parsed.simulationSpeed,
    diagnosticsVisible: parsed.diagnosticsVisible,
    statusMessageKey: parsed.statusMessageKey,
    leftDock: toDockSnapshot(parsed.leftDock, parsed.leftDockOpen),
    rightDock: toDockSnapshot(parsed.rightDock, parsed.rightDockOpen),
  };
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
        const parsed = JSON.parse(raw) as PersistedWorkbenchUiSnapshot;

        return coercePersistedWorkbenchUiSnapshot(parsed);
      } catch {
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
