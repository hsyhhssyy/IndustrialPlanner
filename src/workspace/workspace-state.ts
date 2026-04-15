import { makeAutoObservable } from "mobx";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createSnapshotStore } from "@/shared/snapshot-store/snapshot-store";
import type {
  WorkspaceState,
} from "./types";

export function createWorkspaceState(): WorkspaceState {
  const state: WorkspaceState = {
    document: createSnapshotStore(createStage1SeedWorldDocument()),
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
