import { EditorContract } from "@/domain/contract/editor-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";


export interface EditorHost extends EditorContract {
}


export function createEditorHost(
  workspace: WorkspaceContract
): EditorHost {
  const host: EditorHost = {
    queries: {},
    actions: {}
  };
  return host;
}
