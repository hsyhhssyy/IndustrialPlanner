import type { WorldDocument } from "../document/world-document";
import { EditorAction } from "./editor-action";
import { EditorQuery } from "./editor-query";
import { EditorState } from "./editor-state";
import type { EditorSnapshotStore } from "./types/editor-types";

export type { EditorSnapshotStore } from "./types/editor-types";

export interface EditorContract {
  document: EditorSnapshotStore<WorldDocument>;
  readonly state: EditorState;
  queries: EditorQuery;
  actions: EditorAction;
}
