import { makeAutoObservable } from "mobx";
import { createWorldDocument, WorldDocument } from "@/domain/entity/world-document";
import { SnapshotStore,createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { EditorState, HistoryState, UiState } from "./types";

export interface WorkspaceState {
  document: SnapshotStore<WorldDocument>;
  editor: EditorState;
  history: HistoryState;
  ui: UiState;
}

export function createWorkspaceState(): WorkspaceState {
  const state: WorkspaceState = {
    document: createSnapshotStore(createWorldDocument()),
    editor: {
      drafts: {},
      selectedEntities: {},
      previewEntities: {}
    },
    history: {
      undoDepth: 0,
      redoDepth: 0,
      lastCommandId: null,
    },
    ui: {
      leftDockOpen: true,
      rightDockOpen: true,
      bottomBarOpen: true,
      activePanel: null,
    }
  };

  makeAutoObservable(state, { document: false }, { autoBind: true });

  return state;
}
