import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { WorldDocument } from "@/domain/entity/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type { EditorStateReadWrite } from "../state-impl";

export interface EditorQueriesContext {
  document: SnapshotStoreReadWrite<WorldDocument>;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}
