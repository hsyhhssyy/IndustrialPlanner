import { createInitialEditorSession } from "@/editor/core/editor-session";
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
    expect(store.session.selection).toEqual(["reactor-1"]);
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
        placementPreview: {
          definitionId: "belt_straight_1x1",
          interactionMode: "pointer",
          gridPoint: { x: 4, y: 5 },
          rotation: 0,
          valid: true,
        },
      },
      history: store.getSnapshot().history,
    });

    expect(displayToolTracker).toHaveBeenCalledTimes(1);

    stop();
  });
});
