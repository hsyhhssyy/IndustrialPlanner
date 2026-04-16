import React from "react";
import ReactDOM from "react-dom/client";
import { WorkbenchApp } from "@/app/app-shell/workbench-app";
import { createAppHost } from "@/app/app-host";
import "@/styles.css";
import { createWorkspace } from "./domain";

const workspace = createWorkspace();
const appHost = createAppHost(workspace);


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkbenchApp appHost={appHost} />
  </React.StrictMode>,
);
