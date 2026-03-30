export type WorkbenchMode = "edit" | "simulate";

export interface WorkbenchUiState {
  mode: WorkbenchMode;
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  bottomDockOpen: boolean;
  diagnosticsVisible: boolean;
  statusMessage: string;
}

export function createInitialWorkbenchUiState(): WorkbenchUiState {
  return {
    mode: "edit",
    leftDockOpen: true,
    rightDockOpen: true,
    bottomDockOpen: true,
    diagnosticsVisible: true,
    statusMessage: "Stage1 scaffold ready.",
  };
}
