import { makeAutoObservable } from "mobx";
import { HistoryState } from "./types";

export interface WorkspaceState {
  history: HistoryState;
}

export class WorkspaceStateImpl implements WorkspaceState {
  history: HistoryState;

  public constructor() {
    this.history = {
      undoDepth: 0,
      redoDepth: 0,
      lastCommandId: null,
    };

    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createWorkspaceState(): WorkspaceState {
  return new WorkspaceStateImpl();
}
