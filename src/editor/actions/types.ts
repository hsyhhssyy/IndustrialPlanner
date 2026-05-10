import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type {
  EditorDocumentWriter,
} from "../history";
import type { EditorStateReadWrite } from "../state-impl";

export interface EditorActionsContext {
  document: SnapshotStoreReadWrite<WorldDocument>;
  documentWriter: EditorDocumentWriter;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}
