import type { AppLocale, MessageKey } from "@/i18n/messages";
import type { LogLevel } from "@/shared/logging/logger";

export type WorkbenchPhase = "edit" | "simulate";
export type LeftPanelSection = "placement" | "delete" | "blueprint" | "history";
export type LeftPanelMode = LeftPanelSection;
export type SimulationSpeedPreset = "0.25x" | "1x" | "2x" | "4x" | "16x";

export type DockId = "left" | "right";

export interface DockState {
  open: boolean;
  collapsed: boolean;
}

export interface WorkbenchUiState {
  phase: WorkbenchPhase;
  locale: AppLocale;
  logLevel: LogLevel;
  leftPanelMode: LeftPanelSection;
  simulationSpeed: SimulationSpeedPreset;
  leftDock: DockState;
  rightDock: DockState;
  diagnosticsVisible: boolean;
  statusMessageKey: MessageKey;
}

export type WorkbenchUiStateInput = Partial<
  Omit<WorkbenchUiState, "leftDock" | "rightDock">
> & {
  leftDock?: Partial<DockState>;
  rightDock?: Partial<DockState>;
};

export type WorkbenchUiSnapshot = WorkbenchUiState;
export type WorkbenchUiSnapshotInput = WorkbenchUiStateInput;
