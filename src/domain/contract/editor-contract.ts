import { EditorAction } from "../action/editor-action";
import { EditorQuery } from "../query/editor-query";


export interface EditorContract {
  queries: EditorQuery;
  actions: EditorAction;
}