import type { AppSettings } from "@/domain/state/types";

export const DEFAULT_WORKBENCH_KEYBINDINGS = {
  hypergryphConfirmShortcut: "F",
  hypergryphCancelShortcut: "G",
  hypergryphRotateShortcut: "R",
  hypergryphMarqueeToggleShortcut: "X",
} as const;

interface KeybindingMatchOptions {
  readonly binding: string | null | undefined;
  readonly code: string | null;
  readonly key: string | null;
  readonly modifiers: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}

export function matchesWorkbenchKeybinding(options: KeybindingMatchOptions): boolean {
  if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
    return false;
  }

  const normalizedBinding = normalizeWorkbenchKeybinding(options.binding);
  if (normalizedBinding === null) {
    return false;
  }

  const normalizedCode = resolveAlphaNumericCode(normalizedBinding);
  if (normalizedCode !== null && options.code === normalizedCode) {
    return true;
  }

  return normalizeWorkbenchKeybinding(options.key) === normalizedBinding;
}

export function matchesHypergryphRotateShortcut(
  settings: Pick<AppSettings, "hypergryphRotateShortcut">,
  options: Omit<KeybindingMatchOptions, "binding">,
): boolean {
  return matchesWorkbenchKeybinding({
    ...options,
    binding: settings.hypergryphRotateShortcut,
  });
}

export function matchesHypergryphMarqueeToggleShortcut(
  options: Omit<KeybindingMatchOptions, "binding">,
): boolean {
  return matchesWorkbenchKeybinding({
    ...options,
    binding: DEFAULT_WORKBENCH_KEYBINDINGS.hypergryphMarqueeToggleShortcut,
  });
}

function normalizeWorkbenchKeybinding(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function resolveAlphaNumericCode(binding: string): string | null {
  if (/^[A-Z]$/.test(binding)) {
    return `Key${binding}`;
  }

  if (/^[0-9]$/.test(binding)) {
    return `Digit${binding}`;
  }

  return null;
}