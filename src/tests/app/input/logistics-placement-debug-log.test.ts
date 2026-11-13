import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile, createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
const cleanups: Array<() => void> = [];
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHORTCUT_KEY } from "@/app/actions";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 Editor 查询及 App runtime 已退出，日志必须来自真实草稿。
// Trigger: REQ-048 Canvas 与 SceneSession 接口迁移。
// Evidence: logistics module 读取 context.canvas 与真实物流校验。
// Replacement: createCanvasTestSession + 版本化重叠场景。
// Risk: Low；日志原因、cellCount、工具栏顺序保留。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

import type { GestureEvent } from "@/app/input/gesture/adapter";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 Editor 查询及 App runtime 已退出，日志必须来自真实草稿。
// Trigger: REQ-048 Canvas 与 SceneSession 接口迁移。
// Evidence: logistics module 读取 context.canvas 与真实物流校验。
// Replacement: createCanvasTestSession + 版本化重叠场景。
// Risk: Low；日志原因、cellCount、工具栏顺序保留。
// Human Review: Required
// Original code:
// import type { CanvasRightDockToolbarItemRequest } from "@/app/state/state-impl";

import {
  createHypergryphLogisticsPlacementGestureModule,

} from "@/app/input/gesture/actions";
// AI-REMOVED 2026-11-12:
// Reason: 旧假 Editor 查询及 App runtime 已退出，日志必须来自真实草稿。
// Trigger: REQ-048 Canvas 与 SceneSession 接口迁移。
// Evidence: logistics module 读取 context.canvas 与真实物流校验。
// Replacement: createCanvasTestSession + 版本化重叠场景。
// Risk: Low；日志原因、cellCount、工具栏顺序保留。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 Editor 查询及 App runtime 已退出，日志必须来自真实草稿。
// Trigger: REQ-048 Canvas 与 SceneSession 接口迁移。
// Evidence: logistics module 读取 context.canvas 与真实物流校验。
// Replacement: createCanvasTestSession + 版本化重叠场景。
// Risk: Low；日志原因、cellCount、工具栏顺序保留。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";

// AI-REMOVED 2026-11-12:
// Reason: 旧假 Editor 查询及 App runtime 已退出，日志必须来自真实草稿。
// Trigger: REQ-048 Canvas 与 SceneSession 接口迁移。
// Evidence: logistics module 读取 context.canvas 与真实物流校验。
// Replacement: createCanvasTestSession + 版本化重叠场景。
// Risk: Low；日志原因、cellCount、工具栏顺序保留。
// Human Review: Required
// Original code:
// import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type {

  LogisticsKind,
} from "@/domain/shared/logistics";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import {
  getLogLevel,
  setLogLevel,
  type LogLevel,
} from "@/shared/logging/logger";
import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("logistics placement debug logging", () => {
  let previousLogLevel: LogLevel;

  beforeEach(() => {
    previousLogLevel = getLogLevel();
    setLogLevel("debug");
  });

  afterEach(() => {
    for (const dispose of cleanups.splice(0).reverse()) dispose();
    setLogLevel(previousLogLevel);
    vi.restoreAllMocks();
  });

  it("logs that an empty pipe source is disabled when a left click cannot start placement", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { context, editor } = createContext({
      allowEmptySource: false,
      kind: LOGISTICS_KIND.pipe,
      hasDraft: false,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(mouseLeftTapEvent(), context)).toEqual({ status: "ignored" });
    expect(editor.actions.createLogisticsDraftStart).not.toHaveBeenCalled();
    expect(context.canvas.actions.showCanvasToast).toHaveBeenCalledWith("canvas.toast.pipeStart");
    expect(debugSpy).toHaveBeenCalledWith(
      "[industrial-planner:logistics-placement] "
        + "mouse-left-tap 起笔失败: empty-source-disallowed",
      expect.objectContaining({
        failureStage: "start",
        failureType: "起笔失败",
        failureReason: "empty-source-disallowed",
        kind: "pipe",
        gridPoint: { x: 6, y: 4 },
        pointerEntityId: null,
      }),
    );
  });

  it("logs the editor invalid reason when a left click cannot apply a belt draft", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const hasDraft = true;
    const { context, editor } = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      hasDraft,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(mouseLeftTapEvent(), context)).toEqual({ status: "handled" });
    expect(editor.actions.applyLogisticDraft).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.runtime.logisticsPlacement.statusMessageKey).toBe(
      "overlap-existing-logistics",
    );
    expect(debugSpy).toHaveBeenCalledWith(
      "[industrial-planner:logistics-placement] "
        + "mouse-left-tap 落笔失败: overlap-existing-logistics",
      expect.objectContaining({
        failureStage: "apply",
        failureType: "落笔失败",
        failureReason: "overlap-existing-logistics",
        kind: "belt",
        invalidReason: "overlap-existing-logistics",
        canApply: false,
        cellCount: 1,
      }),
    );
  });

  it("logs that a long left press is not a logistics placement click", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { context, editor } = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      hasDraft: false,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(mouseLeftTapEvent(true), context)).toEqual({ status: "ignored" });
    expect(editor.actions.createLogisticsDraftStart).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      "[industrial-planner:logistics-placement] "
        + "mouse-left-tap 起笔失败: long-press-does-not-place-logistics",
      expect.objectContaining({
        failureStage: "start",
        failureType: "起笔失败",
        failureReason: "long-press-does-not-place-logistics",
        kind: "belt",
        position: { x: 6, y: 4 },
      }),
    );
  });

  it("switches route order through the configured rotate shortcut", () => {
    const { context, appHost } = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      hasDraft: false,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    const shortcutBindings = { [SHORTCUT_KEY.ROTATE]: "T" };
    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent("KeyR", "r"),
      shortcutBindings,
    })).toEqual({ status: "ignored" });
    expect(context.canvas.state.runtime.logisticsPlacement.routeOrder).toBe("vertical-first");
    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent("KeyT", "t"),
      shortcutBindings,
    })).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.logisticsPlacement.routeOrder).toBe("horizontal-first");
    // AI-CORRECTION 2026-08-30: 自定义绑定由 GestureActionRouter 解析，模块不再调用 isShortcutFor。
    expect(appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
  });

  it("shows logistics shortcuts from kind and placement phase", () => {
    const beltStart = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      hasDraft: false,
    });
    const pipeEnd = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.pipe,
      hasDraft: true,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(onEnterActiveToolEvent(), beltStart.context)).toEqual({
      status: "handled",
    });
    expect(beltStart.context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith([
      { operationId: "pan-viewport", presentation: "shortcut" },
      { operationId: "zoom-viewport", presentation: "shortcut" },
      { operationId: "confirm-logistics-start", presentation: "shortcut" },
      { operationId: "change-belt-route-priority", presentation: "shortcut" },
    ]);

    expect(module.handle(onEnterActiveToolEvent(), pipeEnd.context)).toEqual({
      status: "handled",
    });
    expect(pipeEnd.context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith([
      { operationId: "pan-viewport", presentation: "shortcut" },
      { operationId: "zoom-viewport", presentation: "shortcut" },
      { operationId: "confirm-logistics-end", presentation: "shortcut" },
      { operationId: "change-pipe-route-priority", presentation: "shortcut" },
    ]);
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 旧假 Editor 查询及 App runtime 已退出，日志必须来自真实草稿。
// Trigger: REQ-048 Canvas 与 SceneSession 接口迁移。
// Evidence: logistics module 读取 context.canvas 与真实物流校验。
// Replacement: createCanvasTestSession + 版本化重叠场景。
// Risk: Low；日志原因、cellCount、工具栏顺序保留。
// Human Review: Required
// Original code:
// function createContext(options: {
//   allowEmptySource: boolean;
//   kind: LogisticsKind;
//   draftState: LogisticsDraftReadonlyState | null;
// }): {
//   context: GestureActionContext<AppHost>;
//   appHost: AppHost;
//   editor: EditorContract;
// } {
//   const editor = {
//     state: {
//       collections: {
//         [EntityCollectionType.preview]: [],
//       },
//     },
//     actions: {
//       applyLogisticDraft: vi.fn(() => false),
//       createLogisticsDraftStart: vi.fn(),
//     },
//     queries: {
//       findGridCellForClientPixelPoint: vi.fn(() => ({ x: 6, y: 4 })),
//       findLogisticsDraftEndpointAtGridPoint: vi.fn(() => null),
//       getEntityById: vi.fn(() => null),
//       resolveLogisticsDraftState: vi.fn(() => options.draftState),
//     },
//   } as unknown as EditorContract;
//   const workspace = {
//     editor,
//     registry: {
//       queries: {
//         resolveLogisticsRole: vi.fn(() => null),
//       },
//     },
//   } as unknown as WorkspaceContract;
//   const appHost = {
//     state: {
//       screenProfile: {
//         deviceClass: "desktop",
//       },
//       settings: {
//         hypergryphAllowEmptyLogisticsEndpoints: options.allowEmptySource,
//         hypergryphAutoCreateSplittersAndConvergers: false,
//       },
//     },
//     internalState: {
//       activeTool: "logistics-placement",
//       runtime: {
//         canvasRightDockToolbar: {
//           visible: false,
//           items: [] as CanvasRightDockToolbarItemRequest[],
//         },
//         logisticsPlacement: {
//           kind: options.kind,
//           pointerMode: "mouse",
//           phase: options.draftState === null ? "idle" : "drawing",
//           isHoverPreview: false,
//           routeOrder: "vertical-first",
//           sourceEntityId: null,
//           targetEntityId: null,
//           anchorGridPoint: null,
//           headGridPoint: options.draftState?.cells.at(-1)?.gridPoint ?? null,
//           lastPreviewGridPoint: null,
//           statusMessageKey: null,
//         },
//       },
//     },
//     internalActions: {
//       showCanvasToast: vi.fn(),
//       hideCanvasFloatingToolbar: vi.fn(),
//       hideCanvasRightDockToolbar: vi.fn(),
//       showCanvasRightDockToolbar: vi.fn((items: readonly CanvasRightDockToolbarItemRequest[]) => {
//         appHost.internalState.runtime.canvasRightDockToolbar.visible = true;
//         appHost.internalState.runtime.canvasRightDockToolbar.items = [...items];
//       }),
//       isShortcutFor: vi.fn((shortcutKey: string, code: string | null) => (
//         shortcutKey === SHORTCUT_KEY.ROTATE && code === "KeyT"
//       )),
//     },
//     workspace,
//   } as unknown as AppHost;
//
//   return {
//     context: {
//       workspace,
//       appHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     appHost,
//     editor,
//   };
// }


function onEnterActiveToolEvent(): Extract<
  GestureEvent,
  { type: "on-enter-active-tool" }
> {
  return {
    type: "on-enter-active-tool",
    gestureId: "enter-logistics-placement",
    from: "select",
    to: "logistics-placement",
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 旧假 Editor 查询及 App runtime 已退出，日志必须来自真实草稿。
// Trigger: REQ-048 Canvas 与 SceneSession 接口迁移。
// Evidence: logistics module 读取 context.canvas 与真实物流校验。
// Replacement: createCanvasTestSession + 版本化重叠场景。
// Risk: Low；日志原因、cellCount、工具栏顺序保留。
// Human Review: Required
// Original code:
// function createInvalidDraftState(): LogisticsDraftReadonlyState {
//   return {
//     kind: LOGISTICS_KIND.belt,
//     source: {
//       type: "empty-cell",
//       gridPoint: { x: 6, y: 4 },
//     },
//     target: null,
//     routeOrder: "vertical-first",
//     cells: [{
//       gridPoint: { x: 6, y: 4 },
//       fromEdge: null,
//       toEdge: null,
//       shape: "straight",
//       rotation: 0,
//     }],
//     headDraftEntityId: null,
//     replacingEntityId: null,
//     canApply: false,
//     invalidReason: "overlap-existing-logistics",
//   };
// }


function mouseLeftTapEvent(
  longPress = false,
): Extract<GestureEvent, { type: "mouse tap" }> {
  return {
    type: "mouse tap",
    gestureId: "mouse-left-tap-1",
    button: 0,
    buttons: 0,
    position: { x: 6, y: 4 },
    longPress,
    pointerEntity: null,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}

function keyDownEvent(code: string, key: string): Extract<GestureEvent, { type: "key down" }> {
  return {
    type: "key down",
    gestureId: `key-down-${code}`,
    code,
    key,
    keyCode: 0,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
    sourceEvent: null,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 旧假 Editor 查询及 App runtime 已退出，日志必须来自真实草稿。
// Trigger: REQ-048 Canvas 与 SceneSession 接口迁移。
// Evidence: logistics module 读取 context.canvas 与真实物流校验。
// Replacement: createCanvasTestSession + 版本化重叠场景。
// Risk: Low；日志原因、cellCount、工具栏顺序保留。
// Human Review: Required
// Original code:
// function emptyKeyboardSnapshot(): KeyboardSnapshot {
//   return {
//     pressedKeys: new Set(),
//     lastCode: null,
//     lastKey: null,
//     lastKeyCode: null,
//     modifiers: {
//       alt: false,
//       ctrl: false,
//       meta: false,
//       shift: false,
//     },
//   };
// }


function createContext(options: { allowEmptySource: boolean; kind: LogisticsKind; hasDraft: boolean }) {
  const test = createCanvasTestSession({ activeTool: "logistics-placement",
    document: options.hasDraft ? createWorldDocumentFromBlueprint(loadBlueprintFromFile(
      "src/tests/fixtures/blueprints/collections/req048/logistics-debug-" + options.kind + ".schema7.json")) : undefined,
    viewport: { center: { x: 50, y: 50 }, gridSize: 1 / 16, displayRotation: 0 } });
  cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
  test.app.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = options.allowEmptySource;
  test.app.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = false;
  const runtime = test.canvas.state.runtime.logisticsPlacement;
  runtime.kind = options.kind; runtime.pointerMode = "mouse"; runtime.routeOrder = "vertical-first";
  runtime.phase = options.hasDraft ? "drawing" : "idle"; runtime.isHoverPreview = false;
  if (options.hasDraft) {
    test.editor.actions.createLogisticsDraftStart({ kind: options.kind,
      source: { type: "empty-cell", gridPoint: { x: 6, y: 4 } } });
    expect(test.editor.queries.resolveLogisticsDraftState()).toMatchObject({
      canApply: false, invalidReason: "overlap-existing-logistics", cells: [expect.anything()],
    });
    runtime.headGridPoint = { x: 6, y: 4 };
  }
  vi.spyOn(test.editor.actions, "applyLogisticDraft");
  vi.spyOn(test.editor.actions, "createLogisticsDraftStart");
  vi.spyOn(test.canvas.actions, "showCanvasToast");
  vi.spyOn(test.canvas.actions, "showCanvasRightDockToolbar");
  vi.spyOn(test.app.internalActions, "isShortcutFor");
  return { context: test.context, editor: test.editor, appHost: test.app };
}
