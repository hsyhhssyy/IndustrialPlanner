import type { WorldDocument } from "../entity/world-document";
import { EditorAction } from "../action/editor-action";
import { EditorQuery } from "../query/editor-query";
import { EditorState } from "../state/types";
import type { SnapshotStore } from "@/shared/snapshot/snapshot-store";


export interface EditorContract {
  document: SnapshotStore<WorldDocument>;
  readonly state: EditorState;
  queries: EditorQuery;
  actions: EditorAction;
}