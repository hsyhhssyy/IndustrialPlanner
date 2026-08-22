import type { CSSProperties } from "react";

import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";

import styles from "./mouse-shortcut-prompt.module.scss";

type MouseShortcutPromptSize = "small" | "regular" | "large";

export type MouseShortcutInput = "left-button" | "wheel";

interface MouseShortcutPromptProps {
  readonly className?: string;
  readonly input: MouseShortcutInput;
  readonly size?: MouseShortcutPromptSize;
}

type MouseShortcutPromptStyle = CSSProperties & {
  readonly "--mouse-shortcut-prompt-mask": string;
};

const MOUSE_PROMPT_ASSET_NAMES: Readonly<
  Record<MouseShortcutInput, string>
> = {
  "left-button": "mouse_left_outline.svg",
  wheel: "mouse_scroll_vertical_outline.svg",
};

export function MouseShortcutPrompt({
  className,
  input,
  size = "regular",
}: MouseShortcutPromptProps) {
  const assetUrl = createPublicAssetUrl(
    `input-prompts/${MOUSE_PROMPT_ASSET_NAMES[input]}`,
  );

  return (
    <span
      aria-label={input}
      className={joinClassNames([
        styles["mouse-shortcut-prompt"],
        styles[`is-${size}`],
        className,
      ])}
      role="img"
      style={{
        "--mouse-shortcut-prompt-mask": `url("${assetUrl}")`,
      } as MouseShortcutPromptStyle}
    >
      <img
        alt=""
        aria-hidden="true"
        className={styles["mouse-shortcut-prompt-image"]}
        data-mouse-input={input}
        src={assetUrl}
      />
    </span>
  );
}

function joinClassNames(values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
