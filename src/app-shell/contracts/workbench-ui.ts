import type { AppLocale, MessageKey } from "@/i18n/messages";

export type WorkbenchMode = "edit" | "simulate";
export type LeftPanelMode = "placement" | "delete" | "blueprint" | "history";
export type SimulationSpeedPreset = "0.25x" | "1x" | "2x" | "4x" | "16x";

export type DockId = "left" | "right";

export interface DockState {
  open: boolean;
  collapsed: boolean;
}

export interface WorkbenchUiSnapshot {
  mode: WorkbenchMode;
  locale: AppLocale;
  leftPanelMode: LeftPanelMode;
  simulationSpeed: SimulationSpeedPreset;
  leftDock: DockState;
  rightDock: DockState;
  diagnosticsVisible: boolean;
  statusMessageKey: MessageKey;
}

export type WorkbenchUiSnapshotInput = Partial<
  Omit<WorkbenchUiSnapshot, "leftDock" | "rightDock">
> & {
  leftDock?: Partial<DockState>;
  rightDock?: Partial<DockState>;
};
