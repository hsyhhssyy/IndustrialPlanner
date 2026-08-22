import type { ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { MouseShortcutInput } from "@/app/shell/shared";

// AI-REMOVED 2026-08-22:
// Reason: 鼠标提示原子不应反向依赖右侧工具栏的私有类型。
// Trigger: 模块隔离审计发现 shell/shared 不能引用同级 canvas 的内部文件。
// Evidence: 项目模块隔离开发规范 4.6 要求同级目录只能引用 index.ts 公共出口。
// Replacement: MouseShortcutInput from @/app/shell/shared。
// Risk: Low
// Human Review: Required
//
// Original code:
// export type CanvasRightDockToolbarMouseInput = "left-button" | "wheel";

export type CanvasRightDockToolbarShortcutPartDefinition =
  | {
    readonly kind: "shortcut-key";
    readonly shortcutKeyId: ShortcutKeyId;
    readonly bindingDisplay?: "all" | "primary";
  }
  | {
    readonly kind: "fixed-key";
    readonly value: string;
  }
  | {
    readonly kind: "mouse";
    readonly input: MouseShortcutInput;
  };

export interface CanvasRightDockToolbarShortcutDefinition {
  readonly parts: readonly CanvasRightDockToolbarShortcutPartDefinition[];
  readonly separator?: "gap" | "plus";
}

export type ResolvedCanvasRightDockToolbarShortcutPart =
  | {
    readonly kind: "keyboard";
    readonly value: string;
  }
  | {
    readonly kind: "mouse";
    readonly input: MouseShortcutInput;
  };

export interface ResolvedCanvasRightDockToolbarShortcut {
  readonly parts: readonly ResolvedCanvasRightDockToolbarShortcutPart[];
  readonly separator: "gap" | "plus";
}

export function resolveCanvasRightDockToolbarShortcut(
  definition: CanvasRightDockToolbarShortcutDefinition,
  getKeyboardShortcutFor: (shortcutKeyId: ShortcutKeyId) => string,
): ResolvedCanvasRightDockToolbarShortcut | null {
  if (definition.parts.length === 0) {
    return null;
  }

  const parts: ResolvedCanvasRightDockToolbarShortcutPart[] = [];

  for (const part of definition.parts) {
    if (part.kind === "mouse") {
      parts.push(part);
      continue;
    }

    const unresolvedValue = part.kind === "fixed-key"
      ? part.value
      : getKeyboardShortcutFor(part.shortcutKeyId);
    const value = part.kind === "shortcut-key" && part.bindingDisplay === "primary"
      ? unresolvedValue.split(";", 1)[0]?.trim() ?? ""
      : unresolvedValue.trim();

    if (value === "") {
      return null;
    }

    parts.push({ kind: "keyboard", value });
  }

  return {
    parts,
    separator: definition.separator ?? "plus",
  };
}
