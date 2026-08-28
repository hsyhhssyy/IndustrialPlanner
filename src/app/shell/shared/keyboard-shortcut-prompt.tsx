import type { CSSProperties } from "react";

import {
  createAbsolutePublicAssetUrl,
  createPublicAssetUrl,
} from "@/shared/browser/public-asset-url";

import styles from "./keyboard-shortcut-prompt.module.scss";

type KeyboardShortcutPromptSize = "small" | "regular" | "large";

interface KeyboardShortcutPromptProps {
  readonly className?: string;
  readonly shortcut: string;
  readonly size?: KeyboardShortcutPromptSize;
}

type KeyboardShortcutPromptStyle = CSSProperties & {
  readonly "--keyboard-shortcut-prompt-mask": string;
  readonly "--keyboard-shortcut-prompt-scale": number;
};

const KEYBOARD_PROMPT_ASSET_SCALES: Readonly<Partial<Record<string, number>>> = {
  alt: 4 / 3,
  backspace: 4 / 3,
  capslock: 48 / 35,
  ctrl: 4 / 3,
  shift: 3 / 2,
  space: 12 / 7,
  tab: 4 / 3,
};

const SPECIAL_KEY_ASSET_NAMES: Readonly<Record<string, string>> = {
  alt: "alt",
  option: "option",
  ctrl: "ctrl",
  control: "ctrl",
  meta: "command",
  cmd: "command",
  command: "command",
  win: "win",
  shift: "shift",
  esc: "escape",
  escape: "escape",
  tab: "tab",
  space: "space",
  enter: "enter",
  return: "return",
  backspace: "backspace",
  delete: "delete",
  insert: "insert",
  home: "home",
  end: "end",
  pageup: "page_up",
  pagedown: "page_down",
  arrowup: "arrow_up",
  up: "arrow_up",
  arrowdown: "arrow_down",
  down: "arrow_down",
  arrowleft: "arrow_left",
  left: "arrow_left",
  arrowright: "arrow_right",
  right: "arrow_right",
  capslock: "capslock",
  numlock: "numlock",
  scrolllock: "scroll_lock",
  pause: "pause",
  printscreen: "printscreen",
  numpadenter: "numpad_enter",
  numpadadd: "numpad_plus",
  plus: "plus",
  "+": "plus",
  "-": "minus",
  minus: "minus",
  "=": "equals",
  equals: "equals",
  "[": "bracket_open",
  "]": "bracket_close",
  "<": "bracket_less",
  ">": "bracket_greater",
  "\\": "slash_back",
  "/": "slash_forward",
  ";": "semicolon",
  ":": "colon",
  "'": "apostrophe",
  "\"": "quote",
  ",": "comma",
  ".": "period",
  "`": "tilde",
  "~": "tilde",
  "*": "asterisk",
  "?": "question",
  "!": "exclamation",
  "^": "caret",
  "_": "underscore",
};

export function KeyboardShortcutPrompt({
  className,
  shortcut,
  size = "regular",
}: KeyboardShortcutPromptProps) {
  const bindings = shortcut
    .split(";")
    .slice(0, 2)
    .map((binding) => binding.trim())
    .filter((binding) => binding !== "");

  if (bindings.length === 0) {
    return null;
  }

  return (
    <span
      aria-label={shortcut}
      className={joinClassNames([
        styles["keyboard-shortcut-prompt"],
        styles[`is-${size}`],
        className,
      ])}
      role="img"
    >
      {bindings.map((binding, bindingIndex) => (
        <span className={styles["keyboard-shortcut-prompt-alternative"]} key={`${binding}-${bindingIndex}`}>
          {bindingIndex > 0 ? (
            <span aria-hidden="true" className={styles["keyboard-shortcut-prompt-alternative-separator"]}>/</span>
          ) : null}
          <span className={styles["keyboard-shortcut-prompt-binding"]}>
            {tokenizeShortcutBinding(binding).map((token, tokenIndex) => {
              const assetName = resolveKeyboardPromptAssetName(token);
              const assetPath = `input-prompts/keyboard_${assetName}_outline.svg`;
              const assetUrl = createPublicAssetUrl(assetPath);
              const maskAssetUrl = createAbsolutePublicAssetUrl(assetPath);

              return (
                <span
                  className={styles["keyboard-shortcut-prompt-key-part"]}
                  key={`${token}-${tokenIndex}`}
                >
                  {tokenIndex > 0 ? (
                    <span
                      aria-hidden="true"
                      className={styles["keyboard-shortcut-prompt-combination-separator"]}
                    >
                      +
                    </span>
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={styles["keyboard-shortcut-prompt-key-visual"]}
                    style={{
                      "--keyboard-shortcut-prompt-mask": `url("${maskAssetUrl}")`,
                      "--keyboard-shortcut-prompt-scale": KEYBOARD_PROMPT_ASSET_SCALES[assetName] ?? 1,
                    } as KeyboardShortcutPromptStyle}
                  >
                    <img
                      alt=""
                      aria-hidden="true"
                      className={styles["keyboard-shortcut-prompt-key"]}
                      data-key-token={token}
                      src={assetUrl}
                    />
                  </span>
                </span>
              );
            })}
          </span>
        </span>
      ))}
    </span>
  );
}

export function canRenderKeyboardShortcut(shortcut: string): boolean {
  const bindings = shortcut
    .split(";")
    .slice(0, 2)
    .map((binding) => binding.trim())
    .filter((binding) => binding !== "");

  return bindings.length > 0 && bindings.every((binding) => (
    tokenizeShortcutBinding(binding).every((token) => resolveKeyboardPromptAssetName(token) !== "any")
  ));
}

function tokenizeShortcutBinding(binding: string): readonly string[] {
  if (binding === "+") {
    return ["Plus"];
  }

  return binding
    .split("+")
    .map((token) => token.trim())
    .filter((token) => token !== "");
}

function resolveKeyboardPromptAssetName(token: string): string {
  const normalized = token.trim().toLowerCase().replace(/[\s_-]/g, "");

  if (/^[a-z]$/.test(normalized) || /^\d$/.test(normalized) || /^f(?:[1-9]|1[0-2])$/.test(normalized)) {
    return normalized;
  }

  return SPECIAL_KEY_ASSET_NAMES[normalized]
    ?? SPECIAL_KEY_ASSET_NAMES[token.trim().toLowerCase()]
    ?? "any";
}

function joinClassNames(values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}
