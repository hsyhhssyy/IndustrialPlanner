import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

/**
 * 键盘视口平移速度：每秒 10 格。
 * 斜向移动时每个轴各自保持 10 格/秒（不做向量归一化）。
 * 订正（2026-08-25）：改为每个轴固定 1280 客户区像素/秒，不再随缩放级别改变屏幕速度。
 * 订正（2026-08-27）：按住 Shift 时每个轴提升为 2 倍速度，WASD 与方向键行为一致。
 */
const PAN_SPEED_PIXELS_PER_SECOND = 1280;
const PAN_ACCELERATION_MULTIPLIER = 2;

type PanDirection = "up" | "down" | "left" | "right";

const PAN_DIRECTION_SHORTCUTS: ReadonlyArray<readonly [string, PanDirection]> = [
  [SHORTCUT_KEY.PAN_VIEWPORT_UP, "up"],
  [SHORTCUT_KEY.PAN_VIEWPORT_DOWN, "down"],
  [SHORTCUT_KEY.PAN_VIEWPORT_LEFT, "left"],
  [SHORTCUT_KEY.PAN_VIEWPORT_RIGHT, "right"],
];

/**
 * 通过 WASD（可自定义）持续平移视口。
 *
 * 实现方式：key down 时记录按下的方向并启动自管理 RAF 循环，
 * 每帧按真实时间差累加位移，调用 moveViewportByClientPixelVector 平移。
 * key up 全部松开后停止循环；窗口失焦（key up 丢失）时由 RAF 兜底停止。
 * Shift 可在移动前或移动中按下，松开后立即恢复基础速度。
 *
 * 方向语义（与鼠标拖拽一致，内容跟随移动）：
 * - 上（W）：内容向屏幕下方移动，像素向量 dy 为正
 * - 下（S）：内容向屏幕上方移动，像素向量 dy 为负
 * - 左（A）：内容向屏幕右方移动，像素向量 dx 为正
 * - 右（D）：内容向屏幕左方移动，像素向量 dx 为负
 * 画布旋转后由 moveViewportByClientPixelVector 内部的
 * resolveWorldVectorFromViewportVector 自动换算，WASD 始终按屏幕方向移动。
 */
export function createHypergryphKeyboardViewportPanModule(): GestureMappingModule<AppHost> {
  const pressedDirections = new Set<PanDirection>();
  let rafId: number | null = null;
  let lastTickMs: number | null = null;
  let isAccelerated = false;
  // 缓存会话级 workspace，每帧读取当前 editor，避免文档切换后引用失效
  let panWorkspace: WorkspaceContract | null = null;

  const stopPanLoop = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastTickMs = null;
    isAccelerated = false;
    panWorkspace = null;
  };

  const panTick = (nowMs: number): void => {
    // 每帧开头先注册下一帧，便于本帧决定停止时取消
    rafId = requestAnimationFrame(panTick);

    // 兜底：窗口失焦或 key up 丢失时停止，避免持续平移
    if (pressedDirections.size === 0 || panWorkspace === null || !document.hasFocus()) {
      stopPanLoop();
      return;
    }

    const editor = panWorkspace.editor;
    if (editor === null) {
      stopPanLoop();
      return;
    }

    if (lastTickMs !== null) {
      const deltaSeconds = (nowMs - lastTickMs) / 1000;
      const pixelsPerSecond = PAN_SPEED_PIXELS_PER_SECOND
        * (isAccelerated ? PAN_ACCELERATION_MULTIPLIER : 1);

      let dx = 0;
      let dy = 0;
      if (pressedDirections.has("left")) dx += pixelsPerSecond;
      if (pressedDirections.has("right")) dx -= pixelsPerSecond;
      if (pressedDirections.has("up")) dy += pixelsPerSecond;
      if (pressedDirections.has("down")) dy -= pixelsPerSecond;

      if (dx !== 0 || dy !== 0) {
        editor.actions.moveViewportByClientPixelVector({
          startClientPixel: { x: 0, y: 0 },
          endClientPixel: {
            x: dx * deltaSeconds,
            y: dy * deltaSeconds,
          },
        });
      }
    }

    lastTickMs = nowMs;
  };

  const resolvePressedDirection = (
    context: Parameters<GestureMappingModule<AppHost>["handle"]>[1],
    event: { code: string | null; key: string | null; modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean } },
  ): PanDirection | null => {
    for (const [shortcutKey, direction] of PAN_DIRECTION_SHORTCUTS) {
      if (context.appHost.internalActions.isShortcutFor(
        shortcutKey,
        event.code,
        event.key,
        event.modifiers,
      )) {
        return direction;
      }

      if (
        event.modifiers.shift
        && context.appHost.internalActions.isShortcutFor(
          shortcutKey,
          event.code,
          event.key,
          { ...event.modifiers, shift: false },
        )
      ) {
        return direction;
      }
    }

    return null;
  };

  return {
    id: "hypergryph-keyboard-viewport-pan",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      if (event.type === "key down" || event.type === "key up") {
        isAccelerated = context.keyboard.modifiers.shift
          || context.keyboard.pressedKeys.has("ShiftLeft")
          || context.keyboard.pressedKeys.has("ShiftRight");
      }

      switch (event.type) {
        case "key down": {
          const direction = resolvePressedDirection(context, event);
          if (direction === null) {
            return { status: "ignored" };
          }

          pressedDirections.add(direction);
          panWorkspace = context.workspace;

          if (rafId === null) {
            lastTickMs = null;
            rafId = requestAnimationFrame(panTick);
          }

          return { status: "handled" };
        }

        case "key up": {
          const direction = resolvePressedDirection(context, event);
          if (direction === null) {
            return { status: "ignored" };
          }

          pressedDirections.delete(direction);
          if (pressedDirections.size === 0) {
            stopPanLoop();
          }

          return { status: "handled" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}
