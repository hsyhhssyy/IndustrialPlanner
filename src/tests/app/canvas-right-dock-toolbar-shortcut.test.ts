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

  it("resolves the primary binding for a grouped directional prompt", () => {
    const definition: CanvasRightDockToolbarShortcutDefinition = {
      parts: [
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_UP,
          bindingDisplay: "primary",
        },
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_LEFT,
          bindingDisplay: "primary",
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
        { kind: "keyboard", value: "W" },
        { kind: "keyboard", value: "A" },
      ],
      separator: "gap",
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
