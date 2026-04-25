import type { WorldDocument } from "@/domain/entity/world-document";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";

import type { EditorStateReadWrite } from "../state-impl";

export interface EditorActionsContext {
  document: SnapshotStoreReadWrite<WorldDocument>;
  state: EditorStateReadWrite;
}
