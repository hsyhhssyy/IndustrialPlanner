import type { AppLocale } from "@/i18n/messages";
import type { LogLevel } from "@/shared/logging/logger";
import type {
  DockId,
  LeftPanelMode,
} from "@/workbench/state/workbench-ui-state";

export interface AppFacadeQuery {
  getLogLevel: () => LogLevel;
}

export interface AppFacadeAction {
  setLeftPanelMode: (mode: LeftPanelMode) => void;
  setLocale: (locale: AppLocale) => void;
  setLogLevel: (level: LogLevel) => void;
  setDiagnosticsVisible: (visible: boolean) => void;
  setDockOpen: (dockId: DockId, open: boolean) => void;
  toggleDockCollapsed: (dockId: DockId) => void;
}

export interface AppFacade {
  readonly query: AppFacadeQuery;
  readonly action: AppFacadeAction;
}