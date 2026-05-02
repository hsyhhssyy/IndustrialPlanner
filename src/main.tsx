import React from "react";
import ReactDOM from "react-dom/client";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import { createAppHost } from "@/app/host/app-host";
import "@/styles.css";
import { createRegistryContract } from "./registry";
import { WorkspaceContract } from "./domain/contract/workspace-contract";
import { createWorkspaceState } from "./domain/state/workspace-state";
import { createEditorHost } from "./editor/editor-host";
import { createRenderHost } from "./renderer/renderer-host";
import { createSimulationHost } from "./simulation/simulation-host";

const registry = createRegistryContract();

const workspace : WorkspaceContract = {
  state: createWorkspaceState(),
  registry: registry,
  app: null,
  editor: null,
  render: null,
  simulation: null,
}

const appHost = createAppHost(workspace);
createEditorHost(workspace);
await createRenderHost(workspace);
createSimulationHost(workspace);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkbenchApp appHost={appHost} />
  </React.StrictMode>,
);
