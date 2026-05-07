import { makeAutoObservable } from "mobx";

export interface HistoryState {
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly lastCommandId: string | null;
}

export interface WorkspaceState {
  readonly history: HistoryState;
}

export interface HistoryStateReadWrite extends HistoryState {
  undoDepth: number;
  redoDepth: number;
  lastCommandId: string | null;
}

export interface WorkspaceStateReadWrite extends WorkspaceState {
  history: HistoryStateReadWrite;
}

export class WorkspaceStateImpl implements WorkspaceStateReadWrite {
  history: HistoryStateReadWrite;

  public constructor() {
    this.history = {
      undoDepth: 0,
      redoDepth: 0,
      lastCommandId: null,
    };

    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createWorkspaceStateReadWrite(): WorkspaceStateReadWrite {
  return new WorkspaceStateImpl();
}

export function createWorkspaceState(): WorkspaceState {
  return createWorkspaceStateReadWrite();
}
