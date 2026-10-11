import { createAppHost } from "@/app/host/app-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";

/** 组合真实主机；未参与用例的模块保持未装配，不构造假的业务接口。 */
export function createAppTestWorkspace() {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null,
    sync: null, audio: null, blueprintPlanner: null,
  };
  const app = createAppHost(workspace);
  return { workspace, app };
}
