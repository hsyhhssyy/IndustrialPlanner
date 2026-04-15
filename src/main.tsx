import React from "react";
import ReactDOM from "react-dom/client";
import { WorkbenchApp } from "@/app/app-shell/workbench-app";
import { createAppHost } from "@/app/app-host";
import { createWorkbenchController } from "@/workspace/workspace-controller";
import {
  LOG_LEVELS,
  isLogLevel,
  type LogLevel,
} from "@/shared/logging/logger";
import "@/styles.css";

const controller = createWorkbenchController({
});
const appHost = createAppHost(controller, {
});

declare global {
  interface Window {
    __INDUSTRIAL_PLANNER_LOGS__?: {
      getLogLevel: () => LogLevel;
      getSupportedLevels: () => readonly LogLevel[];
      setLogLevel: (level: string) => void;
    };
  }
}

if (typeof window !== "undefined") {
  window.__INDUSTRIAL_PLANNER_LOGS__ = {
    getLogLevel: () => controller.app.query.getLogLevel(),
    getSupportedLevels: () => LOG_LEVELS,
    setLogLevel: (level) => {
      if (!isLogLevel(level)) {
        console.warn(
          `[industrial-planner] Ignored unsupported log level "${level}". Supported levels: ${LOG_LEVELS.join(", ")}.`,
        );
        return;
      }

      controller.app.action.setLogLevel(level);
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkbenchApp appHost={appHost} />
  </React.StrictMode>,
);
