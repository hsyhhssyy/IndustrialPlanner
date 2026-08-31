import {
  doesShortcutPrimaryKeyMatch,
  parseShortcutBindings,
  type ParsedShortcutBinding,
  type ShortcutEventModifiers,
} from "@/app/actions";
import type { ActiveTool } from "@/domain/app";

import type {
  KeyboardGestureEvent,
  ShortcutInputLayer,
  ShortcutModifier,
  ShortcutScope,
  ShortcutTriggerPolicy,
} from "./types";

const MODIFIERS: readonly ShortcutModifier[] = ["alt", "ctrl", "meta", "shift"];

export const ALL_SHORTCUT_ACTIVE_TOOLS: readonly ActiveTool[] = [
  "select",
  "move",
  "marquee",
  "blueprint-placement",
  "single-placement",
  "logistics-placement",
  "dark-pipe-link",
];

export function shortcutScopeMatches(
  scope: ShortcutScope,
  inputLayer: ShortcutInputLayer,
  activeTool: ActiveTool,
): boolean {
  return scope.inputLayers.includes(inputLayer) && scope.activeTools.includes(activeTool);
}

export function shortcutScopesIntersect(left: ShortcutScope, right: ShortcutScope): boolean {
  return left.inputLayers.some((layer) => right.inputLayers.includes(layer))
    && left.activeTools.some((tool) => right.activeTools.includes(tool));
}

export function doesShortcutRouteMatchKeyboardEvent(options: {
  readonly binding: string;
  readonly triggerPolicy: ShortcutTriggerPolicy;
  readonly event: KeyboardGestureEvent;
}): boolean {
  return parseShortcutBindings(options.binding).some((parsed) => (
    doesShortcutPrimaryKeyMatch(parsed.primaryKey, options.event.code, options.event.key)
    && doesModifierStateMatch(
      parsed,
      options.triggerPolicy,
      normalizeActualModifiers(parsed.primaryKey, options.event.modifiers),
    )
  ));
}

export function shortcutTriggerSetsOverlap(options: {
  readonly leftBinding: string;
  readonly leftPolicy: ShortcutTriggerPolicy;
  readonly rightBinding: string;
  readonly rightPolicy: ShortcutTriggerPolicy;
}): boolean {
  const leftBindings = parseShortcutBindings(options.leftBinding);
  const rightBindings = parseShortcutBindings(options.rightBinding);

  for (const left of leftBindings) {
    for (const right of rightBindings) {
      if (left.primaryKey !== right.primaryKey) {
        continue;
      }

      for (let mask = 0; mask < 16; mask += 1) {
        const actual: Record<ShortcutModifier, boolean> = modifiersFromMask(mask);
        if (isModifierPrimary(left.primaryKey)) {
          actual[left.primaryKey] = false;
        }

        if (
          doesModifierStateMatch(left, options.leftPolicy, actual)
          && doesModifierStateMatch(right, options.rightPolicy, actual)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function doesModifierStateMatch(
  binding: ParsedShortcutBinding,
  policy: ShortcutTriggerPolicy,
  actual: Required<ShortcutEventModifiers>,
): boolean {
  for (const modifier of MODIFIERS) {
    if (binding.modifiers[modifier] && !actual[modifier]) {
      return false;
    }

    if (binding.modifiers[modifier] || !actual[modifier]) {
      continue;
    }

    if (policy.kind === "allow-any-additional-modifiers") {
      continue;
    }

    if (
      policy.kind === "allow-additional-modifiers"
      && policy.modifiers.includes(modifier)
    ) {
      continue;
    }

    return false;
  }

  return true;
}

function normalizeActualModifiers(
  primaryKey: string,
  modifiers: ShortcutEventModifiers,
): Required<ShortcutEventModifiers> {
  const normalized = {
    alt: modifiers.alt ?? false,
    ctrl: modifiers.ctrl ?? false,
    meta: modifiers.meta ?? false,
    shift: modifiers.shift ?? false,
  };
  if (isModifierPrimary(primaryKey)) {
    normalized[primaryKey] = false;
  }

  return normalized;
}

function modifiersFromMask(mask: number): Required<ShortcutEventModifiers> {
  return {
    alt: (mask & 1) !== 0,
    ctrl: (mask & 2) !== 0,
    meta: (mask & 4) !== 0,
    shift: (mask & 8) !== 0,
  };
}

function isModifierPrimary(value: string): value is ShortcutModifier {
  return value === "alt" || value === "ctrl" || value === "meta" || value === "shift";
}
