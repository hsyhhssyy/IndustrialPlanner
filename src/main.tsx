import React from "react";
import ReactDOM from "react-dom/client";
import { reaction } from "mobx";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import { createAppHost, type AppHost } from "@/app/host/app-host";
import "@/styles/global.scss";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { createRegistryContract } from "./registry";
import { WorkspaceContract } from "./domain/document/workspace-contract";
import { createWorkspaceState } from "./domain/document/workspace-state";
import { createEditorHost } from "./editor/editor-host";
import { createRenderHost } from "./renderer/renderer-host";
import { createSimulationHost } from "./simulation/simulation-host";

declare global {
  interface Window {
    __industrialPlannerAppHost?: AppHost;
  }
}

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
if (import.meta.env.DEV) {
  window.__industrialPlannerAppHost = appHost;
}
createEditorHost(workspace);
await createRenderHost(workspace);
const simulationHost = createSimulationHost(workspace, {
  getPerfEnabled: () => appHost.internalState.settings.debugMode,
  getActiveActivityIds: () => resolveEffectiveActivityIds({
    selectedActivityIds: appHost.internalState.settings.selectedActivityIds,
  }),
});

reaction(
  () => JSON.stringify(appHost.internalState.settings.selectedActivityIds),
  () => {
    if (simulationHost.internalState.hasStarted) {
      void simulationHost.internalActions.refreshFromCurrentDocument();
    }
  },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkbenchApp appHost={appHost} />
  </React.StrictMode>,
);
