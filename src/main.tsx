import React from "react";
import ReactDOM from "react-dom/client";
import { WorkbenchApp } from "@/app-shell/workbench-app";
import { createWorkbenchController } from "@/workbench/controller/workbench-controller";
import "@/styles.css";

const controller = createWorkbenchController();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkbenchApp controller={controller} />
  </React.StrictMode>,
);
