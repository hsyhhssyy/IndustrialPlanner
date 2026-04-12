import { createInitialEditorSession } from "@/editor/core/editor-session";
import {
  getManagedPlacementPreview,
  getSelectedEntityIds,
} from "@/editor/contracts/editor-session-helpers";
import { createPlacementInteractionMode } from "@/editor/contracts/interaction-mode";
import { createEditorRuntimeStore } from "@/editor/editor-runtime-store";
import { autorun } from "@/shared/mobx";
import { describe, expect, it, vi } from "vitest";

describe("EditorRuntimeStore", () => {
  it("hydrates the current editor session and history into observable runtime state", () => {
    const store = createEditorRuntimeStore({
      session: createInitialEditorSession(),
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
    });

    expect(store.getSnapshot().session.displayTool).toBe("select");
    expect(store.getSnapshot().session.currentMode).toMatchObject({ key: "select" });
    expect(getSelectedEntityIds(store.session)).toEqual(["reactor-1"]);
    expect(store.session.selectionInputMode).toBeNull();
    expect(store.history.canUndo).toBe(false);
  });

  it("tracks selection interaction mode in observable runtime state", () => {
    const store = createEditorRuntimeStore({
      session: createInitialEditorSession(),
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
    });

    store.setSnapshot({
      session: {
        ...store.getSnapshot().session,
        selectionInputMode: "touch",
      },
      history: store.getSnapshot().history,
    });

    expect(store.session.selectionInputMode).toBe("touch");
  });

  it("hydrates draft entities into observable runtime state", () => {
    const store = createEditorRuntimeStore({
      session: createInitialEditorSession(),
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
    });

    store.setSnapshot({
      session: {
        ...store.getSnapshot().session,
        drafts: {
          entities: {
            "draft:placement-preview": {
              id: "draft:placement-preview",
              definitionId: "belt_straight_1x1",
              position: { x: 8, y: 5 },
              rotation: 0,
              config: {},
              tags: [],
              sourceEntityId: null,
              valid: true,
              invalidReason: null,
            },
          },
        },
      },
      history: store.getSnapshot().history,
    });

    expect(store.session.drafts.entities["draft:placement-preview"]).toMatchObject({
      definitionId: "belt_straight_1x1",
      position: { x: 8, y: 5 },
      valid: true,
    });
  });

  it("does not re-run observers that only read display tool when placement preview changes", () => {
    const store = createEditorRuntimeStore({
      session: createInitialEditorSession(),
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
    });
    const displayToolTracker = vi.fn();
    const stop = autorun(() => {
      displayToolTracker(store.session.displayTool);
    });

    expect(displayToolTracker).toHaveBeenCalledTimes(1);

    store.setSnapshot({
      session: {
        ...store.getSnapshot().session,
        currentMode: createPlacementInteractionMode({
          definitionId: "belt_straight_1x1",
          inputMode: "pointer",
        }),
        drafts: {
          entities: {
            "draft:placement-preview": {
              id: "draft:placement-preview",
              definitionId: "belt_straight_1x1",
              position: { x: 4, y: 5 },
              rotation: 0,
              config: {},
              tags: [],
              sourceEntityId: null,
              valid: true,
              invalidReason: null,
            },
          },
        },
        draftEntities: {
          ids: ["draft:placement-preview"],
          boundsDerived: null,
          geometricCenterCellsDerived: null,
        },
      },
      history: store.getSnapshot().history,
    });

    expect(getManagedPlacementPreview(store.session)).toMatchObject({
      definitionId: "belt_straight_1x1",
      gridPoint: { x: 4, y: 5 },
      rotation: 0,
      valid: true,
    });

    expect(displayToolTracker).toHaveBeenCalledTimes(1);

    stop();
  });
});
