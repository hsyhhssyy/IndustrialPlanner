import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type { EditorStateReadWrite } from "../state-impl";
import type { EditorDocumentRepository } from "../document-repository";

export interface EditorQueriesContext {
  document: SnapshotStoreReadWrite<WorldDocument>;
  documents: EditorDocumentRepository;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}
