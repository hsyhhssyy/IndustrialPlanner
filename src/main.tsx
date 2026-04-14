import React from "react";
import ReactDOM from "react-dom/client";
import { WorkbenchApp } from "@/app-shell/workbench-app";
import { createAppHost } from "@/app/app-host";
import { createWorkbenchController } from "@/workbench/controller/workbench-controller";
import {
  LOG_LEVELS,
  isLogLevel,
  type LogLevel,
} from "@/shared/logging/logger";
import {
  createPlacementPreviewProfiler,
  type PlacementPreviewProfilingSnapshot,
} from "@/workbench/diagnostics/placement-preview-profiler";
import "@/styles.css";

const placementPreviewProfiler = createPlacementPreviewProfiler();
const controller = createWorkbenchController({
  placementPreviewProfiler,
});
const appHost = createAppHost(controller, {
  placementPreviewProfiler,
});

declare global {
  interface Window {
    __INDUSTRIAL_PLANNER_LOGS__?: {
      getLogLevel: () => LogLevel;
      getSupportedLevels: () => readonly LogLevel[];
      setLogLevel: (level: string) => void;
      placementPreviewProfiler: {
        getSnapshot: () => PlacementPreviewProfilingSnapshot;
        isEnabled: () => boolean;
        reset: () => void;
        setEnabled: (enabled: boolean) => void;
      };
    };
  }
}

if (typeof window !== "undefined") {
  window.__INDUSTRIAL_PLANNER_LOGS__ = {
    getLogLevel: () => controller.getLogLevel(),
    getSupportedLevels: () => LOG_LEVELS,
    setLogLevel: (level) => {
      if (!isLogLevel(level)) {
        console.warn(
          `[industrial-planner] Ignored unsupported log level "${level}". Supported levels: ${LOG_LEVELS.join(", ")}.`,
        );
        return;
      }

      controller.setLogLevel(level);
    },
    placementPreviewProfiler: {
      getSnapshot: () => placementPreviewProfiler.getSnapshot(),
      isEnabled: () => placementPreviewProfiler.isEnabled(),
      reset: () => placementPreviewProfiler.reset(),
      setEnabled: (enabled) => {
        placementPreviewProfiler.setEnabled(enabled);
      },
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkbenchApp appHost={appHost} />
  </React.StrictMode>,
);
