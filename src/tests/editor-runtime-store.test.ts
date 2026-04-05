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

    expect(store.getSnapshot().session.activeTool).toBe("select");
    expect(store.session.selection).toEqual(["reactor-1"]);
    expect(store.history.canUndo).toBe(false);
  });

  it("does not re-run observers that only read active tool when placement preview changes", () => {
    const store = createEditorRuntimeStore({
      session: createInitialEditorSession(),
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
    });
    const activeToolTracker = vi.fn();
    const stop = autorun(() => {
      activeToolTracker(store.session.activeTool);
    });

    expect(activeToolTracker).toHaveBeenCalledTimes(1);

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

    expect(activeToolTracker).toHaveBeenCalledTimes(1);

    stop();
  });
});
