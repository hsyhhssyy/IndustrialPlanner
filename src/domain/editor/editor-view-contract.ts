import type { EditorViewAction } from "./editor-view-action";
import type { EditorViewQuery } from "./editor-view-query";
import type { EditorViewState } from "./editor-view-state";

export interface EditorViewContract {
  readonly id: string;
  readonly state: EditorViewState;
  readonly actions: EditorViewAction;
  readonly queries: EditorViewQuery;
  dispose(): void;
}
