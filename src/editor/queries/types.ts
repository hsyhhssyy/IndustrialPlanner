import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type { EditorStateReadWrite } from "../state-impl";
import type { EditorDocumentRepository } from "../document-repository";
import type { EditorHistoryRuntime } from "../history";

export interface EditorQueriesContext {
  history: EditorHistoryRuntime;
  document: SnapshotStoreReadWrite<WorldDocument>;
  documents: EditorDocumentRepository;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}
