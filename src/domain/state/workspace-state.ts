import { makeAutoObservable } from "mobx";
import { WorkspaceState } from "../types/workspace/types";

export function createWorkspaceState(): WorkspaceState {
  const state: WorkspaceState = {
    document: null,
    topology: {
      version: 0,
      nodes: [],
      links: [],
      diagnostics: [],
    },
    editorSession: {
      displayTool: "select",
      currentMode: {
        kind: "select",
        anchorEntityId: null,
      },
      drafts: {},
      selectedEntities: [],
      draftEntities: [],
      marqueeRange: null,
      selectionInputMode: null,
    },
    editorHistory: {
      undoDepth: 0,
      redoDepth: 0,
      lastCommandId: null,
    },
    ui: {
      leftDockOpen: true,
      rightDockOpen: true,
      bottomBarOpen: true,
      activePanel: null,
    },
    canvasView: {
      offset: { x: 0, y: 0 },
      zoom: 1,
    },
  };

  makeAutoObservable(state, {}, { autoBind: true });

  return state;
}
