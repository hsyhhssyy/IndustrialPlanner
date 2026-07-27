import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import type { GestureEvent, KeyboardSnapshot } from "@/app/input/gesture/adapter";
import {
  createHypergryphLogisticsPlacementGestureModule,
  type GestureActionContext,
} from "@/app/input/gesture/actions";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type {
  LogisticsDraftReadonlyState,
  LogisticsKind,
} from "@/domain/shared/logistics";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import {
  getLogLevel,
  setLogLevel,
  type LogLevel,
} from "@/shared/logging/logger";

describe("logistics placement debug logging", () => {
  let previousLogLevel: LogLevel;

  beforeEach(() => {
    previousLogLevel = getLogLevel();
    setLogLevel("debug");
  });

  afterEach(() => {
    setLogLevel(previousLogLevel);
    vi.restoreAllMocks();
  });

  it("logs that an empty pipe source is disabled when a left click cannot start placement", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { context, editor } = createContext({
      allowEmptySource: false,
      kind: LOGISTICS_KIND.pipe,
      draftState: null,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(mouseLeftTapEvent(), context)).toEqual({ status: "ignored" });
    expect(editor.actions.createLogisticsDraftStart).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      "[industrial-planner:logistics-placement] "
        + "mouse-left-tap placement rejected: empty-source-disallowed",
      expect.objectContaining({
        stage: "start",
        kind: "pipe",
        gridPoint: { x: 6, y: 4 },
        pointerEntityId: null,
      }),
    );
  });

  it("logs the editor invalid reason when a left click cannot apply a belt draft", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const draftState = createInvalidDraftState();
    const { context, appHost, editor } = createContext({
      allowEmptySource: true,
      kind: LOGISTICS_KIND.belt,
      draftState,
    });
    const module = createHypergryphLogisticsPlacementGestureModule();

    expect(module.handle(mouseLeftTapEvent(), context)).toEqual({ status: "handled" });
    expect(editor.actions.applyLogisticDraft).toHaveBeenCalledTimes(1);
    expect(appHost.internalState.runtime.logisticsPlacement.statusMessageKey).toBe(
      "overlap-existing-logistics",
    );
    expect(debugSpy).toHaveBeenCalledWith(
      "[industrial-planner:logistics-placement] "
        + "mouse-left-tap placement rejected: overlap-existing-logistics",
      expect.objectContaining({
        stage: "apply",
        kind: "belt",
        invalidReason: "overlap-existing-logistics",
        canApply: false,
        cellCount: 1,
      }),
    );
  });
});

function createContext(options: {
  allowEmptySource: boolean;
  kind: LogisticsKind;
  draftState: LogisticsDraftReadonlyState | null;
}): {
  context: GestureActionContext<AppHost>;
  appHost: AppHost;
  editor: EditorContract;
} {
  const editor = {
    state: {
      collections: {},
    },
    actions: {
      applyLogisticDraft: vi.fn(() => false),
      createLogisticsDraftStart: vi.fn(),
    },
    queries: {
      findGridCellForClientPixelPoint: vi.fn(() => ({ x: 6, y: 4 })),
      findLogisticsDraftEndpointAtGridPoint: vi.fn(() => null),
      getEntityById: vi.fn(() => null),
      resolveLogisticsDraftState: vi.fn(() => options.draftState),
    },
  } as unknown as EditorContract;
  const workspace = {
    editor,
    registry: {
      queries: {
        resolveLogisticsRole: vi.fn(() => null),
      },
    },
  } as unknown as WorkspaceContract;
  const appHost = {
    state: {
      settings: {
        hypergryphAllowEmptyLogisticsEndpoints: options.allowEmptySource,
        hypergryphAutoCreateSplittersAndConvergers: false,
      },
    },
    internalState: {
      activeTool: "logistics-placement",
      runtime: {
        logisticsPlacement: {
          kind: options.kind,
          pointerMode: "mouse",
          phase: options.draftState === null ? "idle" : "drawing",
          isHoverPreview: false,
          routeOrder: "vertical-first",
          sourceEntityId: null,
          targetEntityId: null,
          anchorGridPoint: null,
          headGridPoint: options.draftState?.cells.at(-1)?.gridPoint ?? null,
          lastPreviewGridPoint: null,
          statusMessageKey: null,
        },
      },
    },
    workspace,
  } as unknown as AppHost;

  return {
    context: {
      workspace,
      appHost,
      keyboard: emptyKeyboardSnapshot(),
    },
    appHost,
    editor,
  };
}

function createInvalidDraftState(): LogisticsDraftReadonlyState {
  return {
    kind: LOGISTICS_KIND.belt,
    source: {
      type: "empty-cell",
      gridPoint: { x: 6, y: 4 },
    },
    target: null,
    routeOrder: "vertical-first",
    cells: [{
      gridPoint: { x: 6, y: 4 },
      fromEdge: null,
      toEdge: null,
      shape: "straight",
      rotation: 0,
    }],
    headDraftEntityId: null,
    replacingEntityId: null,
    canApply: false,
    invalidReason: "overlap-existing-logistics",
  };
}

function mouseLeftTapEvent(): Extract<GestureEvent, { type: "mouse tap" }> {
  return {
    type: "mouse tap",
    gestureId: "mouse-left-tap-1",
    button: 0,
    buttons: 0,
    position: { x: 6, y: 4 },
    longPress: false,
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

function emptyKeyboardSnapshot(): KeyboardSnapshot {
  return {
    pressedKeys: new Set(),
    lastCode: null,
    lastKey: null,
    lastKeyCode: null,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    },
  };
}
