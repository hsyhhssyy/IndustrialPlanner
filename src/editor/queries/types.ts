import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type { EditorStateReadWrite } from "../state-impl";

export interface EditorQueriesContext {
  document: SnapshotStoreReadWrite<WorldDocument>;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}
