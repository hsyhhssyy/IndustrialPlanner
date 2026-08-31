import { describe, expect, it } from "vitest";

import {
  doesShortcutRouteMatchKeyboardEvent,
  shortcutScopesIntersect,
  shortcutTriggerSetsOverlap,
} from "@/app/input/gesture/actions/shortcut-route-matching";
import type { KeyboardGestureEvent, ShortcutScope } from "@/app/input/gesture/actions/types";

const OPERATION_SCOPE: ShortcutScope = {
  inputLayers: ["canvas"],
  activeTools: ["single-placement", "blueprint-placement", "logistics-placement", "move"],
};
const VIEWPORT_ROTATION_SCOPE: ShortcutScope = {
  inputLayers: ["canvas"],
  activeTools: ["select", "marquee", "dark-pipe-link"],
};

describe("shortcut route matching", () => {
  it("keeps R and Ctrl+R reusable because their executable scopes do not intersect", () => {
    expect(shortcutTriggerSetsOverlap({
      leftBinding: "R",
      leftPolicy: { kind: "allow-any-additional-modifiers" },
      rightBinding: "Ctrl+R",
      rightPolicy: { kind: "exact" },
    })).toBe(true);
    expect(shortcutScopesIntersect(OPERATION_SCOPE, VIEWPORT_ROTATION_SCOPE)).toBe(false);
  });

  it("does not overlap exact primary shortcuts with modified shortcuts", () => {
    expect(shortcutTriggerSetsOverlap({
      leftBinding: "S",
      leftPolicy: { kind: "exact" },
      rightBinding: "Ctrl+S",
      rightPolicy: { kind: "exact" },
    })).toBe(false);
  });

  it("detects an any-modifier primary route overlapping the corresponding chord", () => {
    expect(shortcutTriggerSetsOverlap({
      leftBinding: "F",
      leftPolicy: { kind: "allow-any-additional-modifiers" },
      rightBinding: "Ctrl+F",
      rightPolicy: { kind: "exact" },
    })).toBe(true);
  });

  it("treats modifier-only and a chord as different physical key events", () => {
    expect(shortcutTriggerSetsOverlap({
      leftBinding: "Ctrl",
      leftPolicy: { kind: "exact" },
      rightBinding: "Ctrl+R",
      rightPolicy: { kind: "exact" },
    })).toBe(false);
    expect(shortcutTriggerSetsOverlap({
      leftBinding: "Ctrl",
      leftPolicy: { kind: "exact" },
      rightBinding: "ControlRight",
      rightPolicy: { kind: "exact" },
    })).toBe(true);
  });

  it("requires modifiers configured on an operation route instead of dropping them", () => {
    expect(doesShortcutRouteMatchKeyboardEvent({
      binding: "Ctrl+R",
      triggerPolicy: { kind: "allow-any-additional-modifiers" },
      event: createKeyDownEvent("KeyR", "r", { ctrl: true }),
    })).toBe(true);
    expect(doesShortcutRouteMatchKeyboardEvent({
      binding: "Ctrl+R",
      triggerPolicy: { kind: "allow-any-additional-modifiers" },
      event: createKeyDownEvent("KeyR", "r", {}),
    })).toBe(false);
  });
});

function createKeyDownEvent(
  code: string,
  key: string,
  modifiers: Partial<KeyboardGestureEvent["modifiers"]>,
): KeyboardGestureEvent {
  return {
    type: "key down",
    code,
    key,
    keyCode: 0,
    gestureId: "test-key",
    modifiers: {
      alt: modifiers.alt ?? false,
      ctrl: modifiers.ctrl ?? false,
      meta: modifiers.meta ?? false,
      shift: modifiers.shift ?? false,
    },
    sourceEvent: null,
  };
}
