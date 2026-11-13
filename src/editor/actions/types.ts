import type { EditorServices } from "../editor-services";
import type { EditorQuery } from "@/domain/editor/editor-query";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type {
  EditorDocumentWriter,
  EditorHistoryRuntime,
} from "../history";
import type { EditorStateReadWrite } from "../state-impl";
import type { EditorDocumentRepository } from "../document-repository";
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
// import type { ViewportBounds } from "../viewport-settings";

export interface EditorActionsContext {
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
//   readonly viewportBounds?: ViewportBounds;
  document: SnapshotStoreReadWrite<WorldDocument>;
  documentWriter: EditorDocumentWriter;
  documents: EditorDocumentRepository;
  history: EditorHistoryRuntime;
  state: EditorStateReadWrite;
  queries: EditorQuery;
  workspace: EditorServices;
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: Editor 不再持有 viewport；Replacement: main 显式 View 绑定；Risk: 需回归；Human Review: Required
// Original code:
//   persistViewportSettings(): void;
  beforeDocumentChange(): void;
  captureOperationGuard(): () => boolean;
}
