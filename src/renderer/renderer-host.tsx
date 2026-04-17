import { RenderContract } from "@/domain/contract/render-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";


export interface RenderHost extends RenderContract {
}


export function createRenderHost(
  workspace: WorkspaceContract
): RenderHost {
  const host: RenderHost = {
    queries: {},
    actions: {}
  };
  return host;
}
