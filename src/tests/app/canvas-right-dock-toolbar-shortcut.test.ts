import { describe, expect, it } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import {
  resolveCanvasRightDockToolbarShortcut,
  type CanvasRightDockToolbarShortcutDefinition,
} from "@/app/shell/canvas/canvas-right-dock-toolbar-shortcut";

describe("canvas right dock toolbar shortcut", () => {
  it("composes a configured keyboard shortcut with a fixed mouse input", () => {
    const definition: CanvasRightDockToolbarShortcutDefinition = {
      parts: [
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.ROTATE,
        },
        {
          kind: "mouse",
          input: "left-button",
        },
      ],
      separator: "plus",
    };

    expect(resolveCanvasRightDockToolbarShortcut(
      definition,
      (shortcutKeyId) => shortcutKeyId === SHORTCUT_KEY.ROTATE ? "Ctrl" : "",
    )).toEqual({
      parts: [
        { kind: "keyboard", value: "Ctrl" },
        { kind: "mouse", input: "left-button" },
      ],
      separator: "plus",
    });
  });

  it("preserves every configured binding for grouped directional prompts", () => {
    const definition: CanvasRightDockToolbarShortcutDefinition = {
      parts: [
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_UP,
        },
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_LEFT,
        },
      ],
      separator: "gap",
    };

    expect(resolveCanvasRightDockToolbarShortcut(
      definition,
      (shortcutKeyId) => shortcutKeyId === SHORTCUT_KEY.PAN_VIEWPORT_UP
        ? "W;ArrowUp"
        : "A;ArrowLeft",
    )).toEqual({
      parts: [
        { kind: "keyboard", value: "W;ArrowUp" },
        { kind: "keyboard", value: "A;ArrowLeft" },
      ],
      separator: "gap",
    });
  });

  it("preserves secondary bindings when composing different input alternatives", () => {
    const definition: CanvasRightDockToolbarShortcutDefinition = {
      parts: [
        { kind: "fixed-label", labelKey: "input.mouseLongPress" },
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.MOVE_SELECTION,
        },
      ],
      separator: "alternative",
    };

    expect(resolveCanvasRightDockToolbarShortcut(
      definition,
      (shortcutKeyId) => shortcutKeyId === SHORTCUT_KEY.MOVE_SELECTION
        ? "M;N"
        : "",
    )).toEqual({
      parts: [
        { kind: "label", labelKey: "input.mouseLongPress" },
        { kind: "keyboard", value: "M;N" },
      ],
      separator: "alternative",
    });
  });

  it("preserves right mouse input prompts", () => {
    const definition: CanvasRightDockToolbarShortcutDefinition = {
      parts: [{ kind: "mouse", input: "right-button" }],
    };

    expect(resolveCanvasRightDockToolbarShortcut(definition, () => "")).toEqual({
      parts: [{ kind: "mouse", input: "right-button" }],
      separator: "plus",
    });
  });

  it("hides the whole shortcut when one configured keyboard part is empty", () => {
    const definition: CanvasRightDockToolbarShortcutDefinition = {
      parts: [
        {
          kind: "fixed-key",
          value: "Ctrl",
        },
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.ROTATE,
        },
        {
          kind: "mouse",
          input: "left-button",
        },
      ],
    };

    expect(resolveCanvasRightDockToolbarShortcut(definition, () => "")).toBeNull();
  });
});
