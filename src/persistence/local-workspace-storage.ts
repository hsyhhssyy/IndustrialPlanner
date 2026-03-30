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
        return {
          ...createInitialWorkbenchUiState(),
          ...(JSON.parse(raw) as Partial<WorkbenchUiState>),
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
