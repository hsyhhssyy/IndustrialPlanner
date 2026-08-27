import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { KeyboardShortcutPrompt, MouseShortcutPrompt } from "@/app/shell/shared";
import type {
  CanvasRightDockToolbarButtonId,
  CanvasRightDockToolbarItemRequest,
  CanvasRightDockToolbarOperationId,
} from "@/app/state/state-impl";
import type { UiKey } from "@/shared/i18n";
import {
  // AI-REMOVED 2026-08-03:
  // Reason: 快捷键组合不再通过 Fragment 拼接文字 kbd。
  // Trigger: ST2-RQ-002 快捷键图片化展示。
  // Evidence: KeyboardShortcutPrompt 统一渲染组合键图片。
  // Replacement: KeyboardShortcutPrompt from @/app/shell/shared。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // Fragment,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  resolveCanvasRightDockToolbarShortcut,
  type CanvasRightDockToolbarShortcutDefinition,
} from "./canvas-right-dock-toolbar-shortcut";

type CanvasRightDockToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasRightDockToolbarTone = "exit";

// AI-REMOVED 2026-08-22:
// Reason: 工具列不再使用全局模式互斥按钮和快捷键。
// Trigger: 用户要求每个功能独立选择 button、shortcut 或 both。
// Evidence: CanvasRightDockToolbarItemRequest.presentation 已下沉到逐项请求。
// Replacement: CanvasRightDockToolbarItemRequest["presentation"]。
// Risk: Low
// Human Review: Required
//
// Original code:
// type CanvasRightDockToolbarMode = "icon" | "shortcut";

interface CanvasRightDockToolbarButtonDefinition {
  readonly buttonId: CanvasRightDockToolbarButtonId;
  readonly icon: CanvasRightDockToolbarIconKind;
  readonly tone?: CanvasRightDockToolbarTone;
}

// AI-REMOVED 2026-08-22:
// Reason: 单一字符串或 ShortcutKeyId 无法表达“快捷键 + 固定鼠标输入”和方向键组。
// Trigger: 用户要求连续放置显示为“连续放置快捷键 + 鼠标左键”，且仍由操作定义拥有完整快捷键内容。
// Evidence: canvas-right-dock-toolbar-shortcut.ts 使用有序 parts 统一表达固定键、可配置键与鼠标输入。
// Replacement: CanvasRightDockToolbarShortcutDefinition from ./canvas-right-dock-toolbar-shortcut。
// Risk: Low
// Human Review: Required
//
// Original code:
// type CanvasRightDockToolbarShortcutDefinition =
//   | { readonly value: string }
//   | { readonly shortcutKeyId: ShortcutKeyId };

interface CanvasRightDockToolbarDefinition {
  readonly labelKey: UiKey;
  readonly button?: CanvasRightDockToolbarButtonDefinition;
  readonly shortcut?: CanvasRightDockToolbarShortcutDefinition;
}

interface CanvasRightDockToolbarProps {
  appHost: AppHost;
  items: readonly CanvasRightDockToolbarItemRequest[];
  // AI-REMOVED 2026-08-22:
  // Reason: 组件改为接收逐项展示请求，不能继续接收按钮数组和全局 mode。
  // Trigger: 同一工具列需要混排纯快捷键、按钮加快捷键和纯按钮。
  // Evidence: items 中每个 operationId 都携带独立 presentation。
  // Replacement: items: readonly CanvasRightDockToolbarItemRequest[]。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // buttonIds: readonly CanvasRightDockToolbarButtonId[];
  // mode?: CanvasRightDockToolbarMode;
}

const CANVAS_RIGHT_DOCK_TOOLBAR_DEFINITIONS: Record<
  CanvasRightDockToolbarOperationId,
  CanvasRightDockToolbarDefinition
> = {
  exit: {
    labelKey: "action.exit",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-exit",
      icon: "cancel",
      tone: "exit",
    },
    // AI-REMOVED 2026-08-03:
    // Reason: Escape 不再属于可配置快捷键，退出按钮提示改用硬编码键名。
    // Trigger: ST2-RQ-002 禁止任何快捷键绑定 Escape。
    // Evidence: 返回选择手势已直接匹配 Escape。
    // Replacement: 本对象的 shortcut: "Esc"。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // shortcutKeyId: SHORTCUT_KEY.RETURN_SELECT,
    shortcut: {
      parts: [{ kind: "fixed-key", value: "Esc" }],
    },
  },
  move: {
    labelKey: "tool.move",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-move",
      icon: "move",
    },
    shortcut: {
      parts: [
        { kind: "fixed-label", labelKey: "input.mouseLongPress" },
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.MOVE_SELECTION,
        },
      ],
      separator: "alternative",
    },
  },
  "save-blueprint": {
    labelKey: "action.saveBlueprint",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-save-blueprint",
      icon: "save-blueprint",
    },
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.SAVE_BLUEPRINT }],
    },
  },
  copy: {
    labelKey: "action.copySelection",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-copy",
      icon: "copy",
    },
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.COPY_SELECTION }],
    },
  },
  delete: {
    labelKey: "action.deleteSelection",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-delete",
      icon: "delete",
    },
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.DELETE_DEVICE }],
    },
  },
  "pan-viewport": {
    labelKey: "action.panViewport",
    shortcut: {
      rows: [
        {
          groups: [
            {
              parts: [
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_UP, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_LEFT, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_DOWN, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, slotIndex: 0 },
              ],
              separator: "gap",
            },
            {
              parts: [
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_UP, slotIndex: 1 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_LEFT, slotIndex: 1 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_DOWN, slotIndex: 1 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, slotIndex: 1 },
              ],
              separator: "gap",
            },
          ],
          separator: "alternative",
        },
        {
          groups: [
            {
              parts: [{ kind: "fixed-key", value: "Shift" }],
            },
            {
              parts: [
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_UP, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_LEFT, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_DOWN, slotIndex: 0 },
                { kind: "shortcut-key-slot", shortcutKeyId: SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, slotIndex: 0 },
              ],
              separator: "gap",
            },
          ],
          separator: "plus",
        },
      ],
    },
  },
  "zoom-viewport": {
    labelKey: "action.zoomViewport",
    shortcut: {
      parts: [{ kind: "mouse", input: "wheel" }],
    },
  },
  "switch-device-variant": {
    labelKey: "action.switchDeviceVariant",
    shortcut: {
      parts: [{
        kind: "shortcut-key",
        shortcutKeyId: SHORTCUT_KEY.SWITCH_DEVICE_MODE,
      }],
    },
  },
  "rotate-placement": {
    labelKey: "action.rotateDevice",
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.ROTATE }],
    },
  },
  "confirm-placement": {
    labelKey: "action.confirmPlacement",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "continuous-placement": {
    labelKey: "action.continuousPlacement",
    shortcut: {
      parts: [
        { kind: "fixed-key", value: "Ctrl" },
        { kind: "mouse", input: "left-button" },
      ],
      separator: "plus",
    },
  },
  "delete-device": {
    labelKey: "action.deleteDevice",
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.DELETE_DEVICE }],
    },
  },
  "cancel-placement": {
    labelKey: "action.cancelPlacement",
    shortcut: {
      parts: [{ kind: "fixed-key", value: "Esc" }],
    },
  },
  "confirm-logistics-start": {
    labelKey: "action.confirmLogisticsStart",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "confirm-logistics-end": {
    labelKey: "action.confirmLogisticsEnd",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "change-belt-route-priority": {
    labelKey: "action.changeBeltRoutePriority",
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.ROTATE }],
    },
  },
  "change-pipe-route-priority": {
    labelKey: "action.changePipeRoutePriority",
    shortcut: {
      parts: [{ kind: "shortcut-key", shortcutKeyId: SHORTCUT_KEY.ROTATE }],
    },
  },
  "toggle-marquee-selection": {
    labelKey: "action.selectOrDeselect",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "marquee-select": {
    labelKey: "action.marqueeSelect",
    shortcut: {
      parts: [{ kind: "mouse", input: "left-button" }],
    },
  },
  "marquee-deselect": {
    labelKey: "action.marqueeDeselect",
    shortcut: {
      parts: [{ kind: "mouse", input: "right-button" }],
    },
  },
  "exit-marquee": {
    labelKey: "action.exitMarquee",
    button: {
      buttonId: "canvas-right-dock-toolbar-button-exit",
      icon: "cancel",
      tone: "exit",
    },
    shortcut: {
      parts: [
        {
          kind: "shortcut-key",
          shortcutKeyId: SHORTCUT_KEY.MARQUEE,
        },
        { kind: "fixed-key", value: "Esc" },
      ],
      separator: "alternative",
    },
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export const CanvasRightDockToolbar = observer(function CanvasRightDockToolbar({
  appHost,
  items,
}: CanvasRightDockToolbarProps) {
  const t = appHost.actions.translate;
  // AI-REMOVED 2026-06-19:
  // Reason: 右侧工具栏只负责渲染手势模组声明的按钮，不应持有“保存蓝图何时显示”的业务规则。
  // Trigger: marquee 模式下选区操作按钮的显示规则统一回收到手势模组。
  // Evidence: showCanvasRightDockToolbar 已由各手势模组负责传入完整 buttonIds。
  // Replacement: hypergryph-marquee-gesture-module.ts 的 showMarqueeRightDockToolbar。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const canSaveBlueprint = (appHost.workspace.editor?.state.collections.selection.length ?? 0) > 1;
  // const visibleButtonIds = buttonIds.filter(
  //   (buttonId) => canSaveBlueprint || buttonId !== "canvas-right-dock-toolbar-button-save-blueprint",
  // );
  // AI-CORRECTION 2026-08-22: 呼起方现在传入完整 items，业务显示规则仍由手势模组负责。

  const visibleItems = items.flatMap((item) => {
    const definition = CANVAS_RIGHT_DOCK_TOOLBAR_DEFINITIONS[item.operationId];
    const wantsButton = item.presentation === "button" || item.presentation === "both";
    const wantsShortcut = item.presentation === "shortcut" || item.presentation === "both";
    const button = wantsButton ? definition.button ?? null : null;
    const shortcut = wantsShortcut && definition.shortcut
      ? resolveCanvasRightDockToolbarShortcut(
        definition.shortcut,
        appHost.internalActions.getKeyboardShortcutFor,
      )
      : null;

    // AI-REMOVED 2026-08-22:
    // Reason: 单字符串解析无法保留键盘部分与固定鼠标部分的有序组合。
    // Trigger: 右侧工具栏快捷键扩展为结构化 parts。
    // Evidence: resolveCanvasRightDockToolbarShortcut 解析完整定义，并在任一动态键位为空时整体降级。
    // Replacement: 上方 resolveCanvasRightDockToolbarShortcut 调用。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const shortcutString = wantsShortcut && definition.shortcut
    //   ? "value" in definition.shortcut
    //     ? definition.shortcut.value
    //     : appHost.internalActions.getKeyboardShortcutFor(definition.shortcut.shortcutKeyId)
    //   : null;
    // const shortcut = shortcutString === null || shortcutString === "" ? null : shortcutString;

    if (button === null && shortcut === null) {
      return [];
    }

    return [{
      button,
      definition,
      operationId: item.operationId,
      presentation: item.presentation,
      shortcut,
    }];
  });

  if (visibleItems.length === 0) {
    return null;
  }

  // AI-REMOVED 2026-08-22:
  // Reason: 快捷键状态已经下沉到每个 item，不存在工具列级快捷键模式。
  // Trigger: 按钮和快捷键需要在同一工具列中混排。
  // Evidence: visibleItems 分别解析 button 与 shortcut 能力。
  // Replacement: item.presentation 与 visibleItems。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const visibleButtonIds = buttonIds;
  // const isShortcutMode = mode === "shortcut";

  const stopUiPropagation = (
    event:
      | ReactMouseEvent<HTMLElement>
      | ReactPointerEvent<HTMLElement>
      | ReactWheelEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
  };

  const stopUiPropagationAndDefault = (
    event: ReactMouseEvent<HTMLElement> | ReactWheelEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const stopTouchPointerDownPropagation = (event: ReactPointerEvent<HTMLElement>) => {
    preventTouchPointerCompatibilityMouseEvents(event);
    event.stopPropagation();
  };

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: CanvasRightDockToolbarButtonId,
  ) => {
    event.stopPropagation();

    // AI-REMOVED 2026-08-22:
    // Reason: 是否可点击现在由当前 item 是否解析出 button 决定，不再由全局快捷键模式拦截。
    // Trigger: 按钮加快捷键形态必须保持按钮可点击。
    // Evidence: 只有 button 非空的 item 才会绑定 handleButtonPointerUp。
    // Replacement: 下方仅在按钮分支绑定的 onPointerUp。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // // 快捷键模式下不触发，让事件穿透
    // if (isShortcutMode) return;

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: buttonId,
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: buttonId,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  // AI-REMOVED 2026-08-03:
  // Reason: 快捷键字符串拆分与文字 kbd 渲染已由共享图片组件替代。
  // Trigger: ST2-RQ-002 快捷键图片化展示。
  // Evidence: KeyboardShortcutPrompt 同时支持组合键与双槽位。
  // Replacement: KeyboardShortcutPrompt from @/app/shell/shared。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // function renderShortcutKeys(shortcutString: string): string[] {
  //   return shortcutString
  //     .split("+")
  //     .map((part) => part.trim())
  //     .filter((part) => part !== "");
  // }

  // AI-REMOVED 2026-08-22:
  // Reason: 工具列级快捷键 class 无法表达逐项混排。
  // Trigger: presentation 已下沉到每个功能请求。
  // Evidence: 纯快捷键项使用 canvas-right-dock-toolbar-shortcut，按钮项仍可交互。
  // Replacement: 固定 canvas-right-dock-toolbar class 与逐项 class。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // className={cm(styles, joinClassNames([
  //   "canvas-right-dock-toolbar",
  //   isShortcutMode ? "canvas-right-dock-toolbar--shortcut" : undefined,
  // ]))}
  return (
    <div
      aria-label={t("toolbar.canvasRightDock")}
      className={cm(styles, "canvas-right-dock-toolbar")}
      onAuxClick={stopUiPropagationAndDefault}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerCancel={stopUiPropagation}
      onPointerDown={stopUiPropagation}
      onPointerMove={stopUiPropagation}
      onPointerUp={stopUiPropagation}
      onWheel={stopUiPropagationAndDefault}
    >
      {visibleItems.map(({ button, definition, operationId, presentation, shortcut }) => {
        const label = t(definition.labelKey);

        const contents = (
          <>
            {button === null ? null : (
              <WorkbenchIcon
                className={cm(styles, "canvas-right-dock-toolbar-icon")}
                kind={button.icon}
              />
            )}
            {shortcut === null ? null : (
              <>
                {/* AI-REMOVED 2026-08-03:
                    Reason: 画布工具栏快捷键不再以文字 kbd 与加号拼接。
                    Trigger: ST2-RQ-002 快捷键图片化展示。
                    Evidence: KeyboardShortcutPrompt 使用 public/input-prompts SVG。
                    Replacement: 下方 KeyboardShortcutPrompt。
                    Risk: Low
                    Human Review: Required

                    Original code:
                    shortcutKeys.map((key, i) => (
                      <Fragment key={i}>...</Fragment>
                    ))
                */}
                <span className={cm(styles, "canvas-right-dock-toolbar-shortcut-prompt")}>
                  {shortcut.rows === undefined ? (
                    shortcut.parts.map((part, partIndex) => (
                      <span
                        className={cm(styles, "canvas-right-dock-toolbar-shortcut-part")}
                        key={`${operationId}-${part.kind}-${partIndex}`}
                      >
                        {partIndex > 0 && shortcut.separator !== "gap" ? (
                          <span
                            aria-hidden="true"
                            className={cm(styles, "canvas-right-dock-toolbar-shortcut-separator")}
                          >
                            {shortcut.separator === "plus" ? "+" : "/"}
                          </span>
                        ) : null}
                        {part.kind === "keyboard" ? (
                          <KeyboardShortcutPrompt shortcut={part.value} size="small" />
                        ) : part.kind === "mouse" ? (
                          <MouseShortcutPrompt input={part.input} size="small" />
                        ) : (
                          <span
                            className={cm(styles, "canvas-right-dock-toolbar-shortcut-label")}
                          >
                            {t(part.labelKey)}
                          </span>
                        )}
                      </span>
                    ))
                  ) : (
                    <span className={cm(styles, "canvas-right-dock-toolbar-shortcut-rows")}>
                      {shortcut.rows.map((row, rowIndex) => (
                        <span
                          className={cm(styles, "canvas-right-dock-toolbar-shortcut-row")}
                          data-shortcut-row-index={rowIndex}
                          key={`${operationId}-row-${rowIndex}`}
                        >
                          {row.groups.map((group, groupIndex) => (
                            <span
                              className={cm(styles, "canvas-right-dock-toolbar-shortcut-group")}
                              key={`${operationId}-row-${rowIndex}-group-${groupIndex}`}
                            >
                              {groupIndex > 0 && row.separator !== "gap" ? (
                                <span
                                  aria-hidden="true"
                                  className={cm(styles, "canvas-right-dock-toolbar-shortcut-separator")}
                                >
                                  {row.separator === "plus" ? "+" : "/"}
                                </span>
                              ) : null}
                              {group.parts.map((part, partIndex) => (
                                <span
                                  className={cm(styles, "canvas-right-dock-toolbar-shortcut-part")}
                                  key={`${operationId}-row-${rowIndex}-group-${groupIndex}-${part.kind}-${partIndex}`}
                                >
                                  {partIndex > 0 && group.separator !== "gap" ? (
                                    <span
                                      aria-hidden="true"
                                      className={cm(styles, "canvas-right-dock-toolbar-shortcut-separator")}
                                    >
                                      {group.separator === "plus" ? "+" : "/"}
                                    </span>
                                  ) : null}
                                  {part.kind === "keyboard" ? (
                                    <KeyboardShortcutPrompt shortcut={part.value} size="small" />
                                  ) : part.kind === "mouse" ? (
                                    <MouseShortcutPrompt input={part.input} size="small" />
                                  ) : (
                                    <span
                                      className={cm(styles, "canvas-right-dock-toolbar-shortcut-label")}
                                    >
                                      {t(part.labelKey)}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </span>
                          ))}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                {/* AI-REMOVED 2026-08-22:
                    Reason: 单个 KeyboardShortcutPrompt 无法渲染固定鼠标输入。
                    Trigger: 右侧工具栏快捷键改为有序 parts 组合。
                    Evidence: 上方按 part.kind 组合 KeyboardShortcutPrompt 与 MouseShortcutPrompt。
                    Replacement: canvas-right-dock-toolbar-shortcut-prompt。
                    Risk: Low
                    Human Review: Required

                    Original code:
                    <KeyboardShortcutPrompt shortcut={shortcut} size="small" />
                */}
              </>
            )}
            <span
              className={cm(
                styles,
                shortcut === null
                  ? "canvas-right-dock-toolbar-label"
                  : "canvas-right-dock-toolbar-label--glow",
              )}
            >
              {label}
            </span>
          </>
        );

        if (button === null) {
          return (
            <div
              aria-label={label}
              className={cm(styles, "canvas-right-dock-toolbar-shortcut")}
              data-toolbar-operation-id={operationId}
              data-toolbar-presentation={presentation}
              key={operationId}
            >
              {contents}
            </div>
          );
        }

        return (
          <button
            aria-label={label}
            className={cm(styles, joinClassNames([
              "canvas-right-dock-toolbar-button",
              button.tone ? `is-${button.tone}` : undefined,
            ]))}
            data-toolbar-operation-id={operationId}
            data-toolbar-presentation={presentation}
            data-ui-button-id={button.buttonId}
            key={operationId}
            onClick={stopUiPropagation}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopTouchPointerDownPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, button.buttonId);
            }}
            type="button"
          >
            {contents}
          </button>
        );
      })}
    </div>
  );
});
