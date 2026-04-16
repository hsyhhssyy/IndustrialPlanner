import React from "react";
import ReactDOM from "react-dom/client";
import { WorkbenchApp } from "@/app/app-shell/workbench-app";
import { createAppHost } from "@/app/app-host";
import { createWorkspaceController } from "@/workspace/workspace-controller";
import "@/styles.css";

const controller = createWorkspaceController({
});
const appHost = createAppHost(controller, {
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkbenchApp appHost={appHost} />
  </React.StrictMode>,
);
