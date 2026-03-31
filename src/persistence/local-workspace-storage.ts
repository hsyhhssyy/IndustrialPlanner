import {
  createInitialWorkbenchUiState,
  type WorkbenchUiState,
} from "@/app-shell/state/workbench-ui-state";

const UI_STATE_KEY = "industrial-planner:workbench-ui-state";

export interface WorkspaceStorageGateway {
  loadUiState: () => WorkbenchUiState;
  saveUiState: (uiState: WorkbenchUiState) => void;
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function createWorkspaceStorageGateway(): WorkspaceStorageGateway {
  return {
    loadUiState: () => {
      if (!canUseStorage()) {
        return createInitialWorkbenchUiState();
      }

      const raw = localStorage.getItem(UI_STATE_KEY);

      if (!raw) {
        return createInitialWorkbenchUiState();
      }

      try {
        const initialState = createInitialWorkbenchUiState();
        const parsed = JSON.parse(raw) as Partial<
          WorkbenchUiState & {
            leftDockOpen?: boolean;
            rightDockOpen?: boolean;
            bottomDockOpen?: boolean;
            statusMessage?: string;
          }
        >;

        return {
          ...initialState,
          ...parsed,
          leftDock: {
            ...initialState.leftDock,
            ...parsed.leftDock,
            open: parsed.leftDock?.open ?? parsed.leftDockOpen ?? initialState.leftDock.open,
          },
          rightDock: {
            ...initialState.rightDock,
            ...parsed.rightDock,
            open:
              parsed.rightDock?.open ?? parsed.rightDockOpen ?? initialState.rightDock.open,
          },
          leftPanelMode: parsed.leftPanelMode ?? initialState.leftPanelMode,
          simulationSpeed:
            parsed.simulationSpeed ?? initialState.simulationSpeed,
          statusMessageKey:
            parsed.statusMessageKey ?? initialState.statusMessageKey,
        };
      } catch {
        return createInitialWorkbenchUiState();
      }
    },
    saveUiState: (uiState) => {
      if (!canUseStorage()) {
        return;
      }

      localStorage.setItem(UI_STATE_KEY, JSON.stringify(uiState));
    },
  };
}
