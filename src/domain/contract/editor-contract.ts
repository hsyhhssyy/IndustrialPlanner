import type { WorldDocument } from "../entity/world-document";
import { EditorAction } from "../action/editor-action";
import { EditorQuery } from "../query/editor-query";
import { EditorState } from "../state/types";

export interface EditorSnapshotStore<T> {
  getSnapshot(): T;
  subscribe(listener: (snapshot: T) => void): () => void;
}

export interface EditorContract {
  document: EditorSnapshotStore<WorldDocument>;
  readonly state: EditorState;
  queries: EditorQuery;
  actions: EditorAction;
}