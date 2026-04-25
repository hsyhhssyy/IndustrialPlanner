import { describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/app-host";
import type { KeyboardSnapshot } from "@/app/input/gesture-adapter";
import {
  createHypergryphMoveModeToggleModule,
  type GestureActionContext,
} from "@/app/input/gesture-actions";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { WorldEntity } from "@/domain/entity/world-document";

describe("createHypergryphMoveModeToggleModule", () => {
  it("enters move mode as soon as mouse long press becomes ready", () => {
    const { context, setActiveTool } = createContext();
    const module = createHypergryphMoveModeToggleModule();

    const result = module.handle(
      {
        type: "mouse-long-press-ready",
        gestureId: "mouse-ready-1",
        button: 0,
        buttons: 1,
        position: { x: 42, y: 18 },
        pointerEntity: entity("entity-1"),
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(setActiveTool).toHaveBeenCalledWith("move");
  });

  it("ignores ready events when no entity is under the pointer", () => {
    const { context, setActiveTool } = createContext();
    const module = createHypergryphMoveModeToggleModule();

    const result = module.handle(
      {
        type: "tap-long-press-ready",
        gestureId: "touch-ready-1",
        primaryId: 7,
        position: { x: 84, y: 36 },
        activeTouchCount: 1,
        pointerEntity: null,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(setActiveTool).not.toHaveBeenCalled();
  });
});

function createContext(): {
  context: GestureActionContext<AppHost>;
  setActiveTool: ReturnType<typeof vi.fn>;
} {
  const setActiveTool = vi.fn();

  return {
    context: {
      workspace: {} as WorkspaceContract,
      appHost: {
        state: {
          settings: {
            hypergryphOperationMode: true,
          },
        },
        internalState: {
          runtime: {
            activeTool: "select",
          },
        },
        internalActions: {
          setActiveTool,
        },
      } as unknown as AppHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    setActiveTool,
  };
}

function entity(id: string): WorldEntity {
  return {
    id,
    definitionId: "belt_straight_1x1",
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function emptyKeyboardSnapshot(): KeyboardSnapshot {
  return {
    pressedKeys: new Set(),
    lastCode: null,
    lastKey: null,
    lastKeyCode: null,
    modifiers: emptyModifiers(),
  };
}

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}