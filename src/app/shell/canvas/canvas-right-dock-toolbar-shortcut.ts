import type { ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import type { MouseShortcutInput } from "@/app/shell/shared";
import type { UiKey } from "@/shared/i18n";

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
    // AI-REMOVED 2026-08-22:
    // Reason: 右侧工具栏必须展示快捷键配置中的全部绑定，调用方不得只截取主绑定。
    // Trigger: 用户明确要求任何快捷键配置了第二快捷键时，都显示“主快捷键 / 第二快捷键”。
    // Evidence: KeyboardShortcutPrompt 已原生将分号分隔的绑定渲染为斜杠分隔的候选快捷键。
    // Replacement: resolveCanvasRightDockToolbarShortcut 完整保留 getKeyboardShortcutFor 的返回值。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // readonly bindingDisplay?: "all" | "primary";
  }
  | {
    readonly kind: "shortcut-key-slot";
    readonly shortcutKeyId: ShortcutKeyId;
    readonly slotIndex: 0 | 1;
  }
  | {
    readonly kind: "fixed-key";
    readonly value: string;
  }
  | {
    readonly kind: "fixed-label";
    readonly labelKey: UiKey;
  }
  | {
    readonly kind: "mouse";
    readonly input: MouseShortcutInput;
  };

export interface CanvasRightDockToolbarShortcutGroupDefinition {
  readonly parts: readonly CanvasRightDockToolbarShortcutPartDefinition[];
  readonly separator?: "alternative" | "gap" | "plus";
}

export interface CanvasRightDockToolbarShortcutRowDefinition {
  readonly groups: readonly CanvasRightDockToolbarShortcutGroupDefinition[];
  readonly separator?: "alternative" | "gap" | "plus";
}

export interface CanvasRightDockToolbarShortcutDefinition {
  readonly parts?: readonly CanvasRightDockToolbarShortcutPartDefinition[];
  readonly separator?: "alternative" | "gap" | "plus";
  readonly rows?: readonly CanvasRightDockToolbarShortcutRowDefinition[];
}

export type ResolvedCanvasRightDockToolbarShortcutPart =
  | {
    readonly kind: "keyboard";
    readonly value: string;
  }
  | {
    readonly kind: "label";
    readonly labelKey: UiKey;
  }
  | {
    readonly kind: "mouse";
    readonly input: MouseShortcutInput;
  };

export interface ResolvedCanvasRightDockToolbarShortcut {
  readonly parts: readonly ResolvedCanvasRightDockToolbarShortcutPart[];
  readonly separator: "alternative" | "gap" | "plus";
  readonly rows?: readonly ResolvedCanvasRightDockToolbarShortcutRow[];
}

export interface ResolvedCanvasRightDockToolbarShortcutRow {
  readonly groups: readonly ResolvedCanvasRightDockToolbarShortcutGroup[];
  readonly separator: "alternative" | "gap" | "plus";
}

export interface ResolvedCanvasRightDockToolbarShortcutGroup {
  readonly parts: readonly ResolvedCanvasRightDockToolbarShortcutPart[];
  readonly separator: "alternative" | "gap" | "plus";
}

export function resolveCanvasRightDockToolbarShortcut(
  definition: CanvasRightDockToolbarShortcutDefinition,
  getKeyboardShortcutFor: (shortcutKeyId: ShortcutKeyId) => string,
): ResolvedCanvasRightDockToolbarShortcut | null {
  if (definition.rows !== undefined) {
    const rows = definition.rows
      .map((row) => resolveShortcutRow(row, getKeyboardShortcutFor))
      .filter((row): row is ResolvedCanvasRightDockToolbarShortcutRow => row !== null);

    return rows.length === 0
      ? null
      : {
        parts: [],
        separator: "gap",
        rows,
      };
  }

  const group = resolveShortcutGroup({
    parts: definition.parts ?? [],
    separator: definition.separator,
  }, getKeyboardShortcutFor);

  return group;
}

function resolveShortcutRow(
  definition: CanvasRightDockToolbarShortcutRowDefinition,
  getKeyboardShortcutFor: (shortcutKeyId: ShortcutKeyId) => string,
): ResolvedCanvasRightDockToolbarShortcutRow | null {
  const separator = definition.separator ?? "plus";
  const groups: ResolvedCanvasRightDockToolbarShortcutGroup[] = [];

  for (const groupDefinition of definition.groups) {
    const group = resolveShortcutGroup(groupDefinition, getKeyboardShortcutFor);
    if (group === null) {
      if (separator === "alternative") {
        continue;
      }

      return null;
    }

    groups.push(group);
  }

  return groups.length === 0 ? null : { groups, separator };
}

function resolveShortcutGroup(
  definition: CanvasRightDockToolbarShortcutGroupDefinition,
  getKeyboardShortcutFor: (shortcutKeyId: ShortcutKeyId) => string,
): ResolvedCanvasRightDockToolbarShortcutGroup | null {
  if (definition.parts.length === 0) {
    return null;
  }

  const parts: ResolvedCanvasRightDockToolbarShortcutPart[] = [];

  for (const part of definition.parts) {
    if (part.kind === "mouse" || part.kind === "fixed-label") {
      parts.push(part.kind === "mouse"
        ? part
        : { kind: "label", labelKey: part.labelKey });
      continue;
    }

    const unresolvedValue = part.kind === "fixed-key"
      ? part.value
      : getKeyboardShortcutFor(part.shortcutKeyId);
    // AI-REMOVED 2026-08-22:
    // Reason: 截断到主绑定会使右侧工具栏漏掉用户配置的第二快捷键。
    // Trigger: 用户明确要求所有第二快捷键都以“/”展示。
    // Evidence: KeyboardShortcutPrompt 接收完整的分号分隔字符串后会自动渲染候选分隔符。
    // Replacement: 下方直接 trim 完整绑定字符串。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const value = part.kind === "shortcut-key" && part.bindingDisplay === "primary"
    //   ? unresolvedValue.split(";", 1)[0]?.trim() ?? ""
    //   : unresolvedValue.trim();
    const value = part.kind === "shortcut-key-slot"
      ? resolveShortcutSlot(unresolvedValue, part.slotIndex)
      : unresolvedValue.trim();

    if (value === "") {
      if (part.kind === "shortcut-key-slot") {
        continue;
      }

      return null;
    }

    parts.push({ kind: "keyboard", value });
  }

  return parts.length === 0 ? null : {
    parts,
    separator: definition.separator ?? "plus",
  };
}

function resolveShortcutSlot(shortcut: string, slotIndex: 0 | 1): string {
  return shortcut.split(";", 2)[slotIndex]?.trim() ?? "";
}
