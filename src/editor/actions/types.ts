import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type {
  EditorDocumentWriter,
  EditorHistoryRuntime,
} from "../history";
import type { EditorStateReadWrite } from "../state-impl";
import type { EditorDocumentRepository } from "../document-repository";
import type { ViewportBounds } from "../viewport-settings";

export interface EditorActionsContext {
  readonly viewportBounds?: ViewportBounds;
  document: SnapshotStoreReadWrite<WorldDocument>;
  documentWriter: EditorDocumentWriter;
  documents: EditorDocumentRepository;
  history: EditorHistoryRuntime;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
  persistViewportSettings(): void;
  flushViewportSettings(): void;
}
