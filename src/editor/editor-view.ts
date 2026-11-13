import { action, observable } from "mobx";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { EditorViewBoundsPolicy, EditorViewOptions } from "@/domain/editor/types/editor-view-types";
import type { CanvasOperationId } from "@/domain/shared/canvas-operation";
import type { GridRect } from "@/domain/shared/grid";
import { expandSceneBounds, validateSceneSpace } from "@/shared/geometry/scene-space";
import { resolveCompensatedViewportCenter, resolveWorldVectorFromViewportVector } from "@/shared/geometry/viewport-transform";
import { resolveClientRectForGridCell, resolveGridCellAtClientPixelPoint } from "./queries/viewport-geometry";
import {
  // AI-REMOVED 2026-11-12: owner 自动取景允许小于手动缩放下限；REQ-048 静态全图；Replacement: 有限正数 gridSize；Risk: 用户缩放仍沿用原档位；Human Review: Required
  // clampViewportGridSize,
  resolveContentBoundedViewport,
  resolveViewportGridCellPixelSize, resolveViewportGridSizeAfterZoom,
} from "./viewport-settings";

interface ViewMotion {
  readonly start: { x: number; y: number; gridSize: number };
  readonly target: { x: number; y: number; gridSize: number };
  readonly durationMs: number;
  readonly elapsedMs: number;
}

/** 每次创建独立相机；仅使用显式动作和 advance，不创建 DOM、存储绑定或帧循环。 */
export function createEditorView(options: EditorViewOptions): EditorViewContract {
  let bounds = copyValidatedBoundsPolicy(options.bounds);
  let disposed = false;
  let measured = false;
  const initial = options.initialViewport;
  if (![initial.center.x, initial.center.y, initial.gridSize, initial.gridSize * resolveViewportGridCellPixelSize(1)].every(Number.isFinite) || initial.gridSize <= 0
    || ![0, 90, 180, 270].includes(initial.displayRotation)) {
    throw new Error("Invalid initial viewport");
  }
  const state = observable({
    center: { ...initial.center },
    clientRect: { left: 0, top: 0, width: 0, height: 0 },
    gridSize: initial.gridSize,
    gridCellPixelSize: initial.gridSize * resolveViewportGridCellPixelSize(1),
    displayRotation: initial.displayRotation,
  });
  const motion = observable.box<ViewMotion | null>(null, { deep: false });
  const allowed = (operation: CanvasOperationId): boolean => {
    if (disposed) return false;
    const availability = options.getOperationAvailability(operation);
    return availability.supported && availability.enabled;
  };
  const constrain = (): void => {
    if (bounds.kind === "content") {
      const next = resolveContentBoundedViewport({ ...state, bounds });
      state.center.x = next.center.x;
      state.center.y = next.center.y;
      state.gridSize = next.gridSize;
      state.gridCellPixelSize = resolveViewportGridCellPixelSize(next.gridSize);
      return;
    }
    const limit = expandSceneBounds(bounds.bounds, { top: bounds.padding, right: bounds.padding, bottom: bounds.padding, left: bounds.padding });
    state.center.x = clampAxis(state.center.x, limit.minX, limit.maxX);
    state.center.y = clampAxis(state.center.y, limit.minY, limit.maxY);
  };
  const writePosition = (position: ViewMotion["target"]): void => {
    state.center.x = position.x;
    state.center.y = position.y;
    state.gridSize = position.gridSize;
    state.gridCellPixelSize = state.gridSize * resolveViewportGridCellPixelSize(1);
    constrain();
  };
  action(constrain)();

  return {
    id: options.id,
    state,
    actions: {
      setViewportClientRect: action((rect) => {
        if (disposed || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
          || rect.width < 0 || rect.height < 0) return;
        const nextRect = { ...rect, width: Math.floor(rect.width), height: Math.floor(rect.height) };
        if (measured && nextRect.left === state.clientRect.left && nextRect.top === state.clientRect.top
          && nextRect.width === state.clientRect.width && nextRect.height === state.clientRect.height) return;
        // 隐藏容器的零尺寸没有可补偿的屏幕几何；隐藏与恢复均保留原相机。
        if (measured && state.clientRect.width > 0 && state.clientRect.height > 0 && nextRect.width > 0 && nextRect.height > 0) {
          const next = resolveCompensatedViewportCenter({
            previousClientRect: state.clientRect, nextClientRect: nextRect,
            previousViewportCenter: state.center, gridCellPixelSize: state.gridCellPixelSize,
            displayRotation: state.displayRotation,
          });
          state.center.x = next.x;
          state.center.y = next.y;
        }
        measured = true;
        Object.assign(state.clientRect, nextRect);
        motion.set(null);
        constrain();
      }),
      moveViewportByClientPixelVector: action(({ startClientPixel, endClientPixel }) => {
        if (!allowed("pan-viewport")) return;
        const vector = { x: endClientPixel.x - startClientPixel.x, y: endClientPixel.y - startClientPixel.y };
        if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) return;
        motion.set(null);
        const worldVector = resolveWorldVectorFromViewportVector({ viewportVector: vector, displayRotation: state.displayRotation });
        state.center.x -= worldVector.x / state.gridCellPixelSize;
        state.center.y -= worldVector.y / state.gridCellPixelSize;
        constrain();
      }),
      zoom: action((step) => {
        if (!allowed("zoom-viewport")) return;
        const next = resolveViewportGridSizeAfterZoom({ currentGridSize: state.gridSize, step });
        if (next === null) return;
        motion.set(null);
        state.gridSize = next;
        state.gridCellPixelSize = resolveViewportGridCellPixelSize(next);
        constrain();
      }),
      setViewportDisplayRotation: action((rotation) => {
        if (!allowed("rotate-viewport") || ![0, 90, 180, 270].includes(rotation)) return;
        motion.set(null);
        state.displayRotation = rotation;
        constrain();
      }),
      focusOnBounds: action((rect, focusOptions = {}) => {
        if (disposed || !isFiniteContentRect(rect)) return;
        const durationMs = focusOptions.durationMs ?? 750;
        // 订正（2026-09-23）：聚焦目标缩放由固定 100% 提升到 252% 档，原「缩放到 gridSize=1」的行为不再成立。
        // 252% 是级缩放的档位值（每档 ×2^(1/6)），对应 gridSize = 2^(4/3) ≈ 2.5198；不可写成 2.52，否则会脱离档位体系。
        const gridSize = focusOptions.gridSize ?? 2 ** (4 / 3);
        if (!Number.isFinite(durationMs) || durationMs < 0 || !Number.isFinite(gridSize * resolveViewportGridCellPixelSize(1)) || gridSize <= 0) return;
        const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, gridSize };
        if (durationMs === 0) {
          motion.set(null);
          writePosition(target);
        } else {
          motion.set({ start: { ...state.center, gridSize: state.gridSize }, target, durationMs, elapsedMs: 0 });
        }
      }),
      setBoundsPolicy: action((policy) => {
        if (disposed) return;
        bounds = copyValidatedBoundsPolicy(policy);
        motion.set(null);
        constrain();
      }),
      advance: action((deltaMs) => {
        const current = motion.get();
        if (disposed || current === null || !Number.isFinite(deltaMs) || deltaMs <= 0) return;
        const elapsedMs = Math.min(current.durationMs, current.elapsedMs + deltaMs);
        const progress = elapsedMs / current.durationMs;
        const t = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        writePosition({
          x: current.start.x + (current.target.x - current.start.x) * t,
          y: current.start.y + (current.target.y - current.start.y) * t,
          gridSize: current.start.gridSize + (current.target.gridSize - current.start.gridSize) * t,
        });
        motion.set(progress === 1 ? null : { ...current, elapsedMs });
      }),
      cancelMotion: action(() => { motion.set(null); }),
    },
    queries: {
      findGridCellForClientPixelPoint: (clientPixelPoint) => disposed ? null : resolveGridCellAtClientPixelPoint({ clientPixelPoint, viewportState: state }),
      findClientRectForGridCell: (gridCell) => disposed ? null : resolveClientRectForGridCell({ gridCell, viewportState: state }),
      hasPendingMotion: () => !disposed && motion.get() !== null,
    },
    dispose: action(() => { disposed = true; motion.set(null); }),
  };
}

function clampAxis(value: number, min: number | null, max: number | null): number {
  const lowerClamped = min === null ? value : Math.max(min, value);
  return max === null ? lowerClamped : Math.min(max, lowerClamped);
}

function isFiniteContentRect(rect: GridRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite)
    && rect.width >= 0 && rect.height >= 0;
}

function copyValidatedBoundsPolicy(policy: EditorViewBoundsPolicy): EditorViewBoundsPolicy {
  if (!Number.isFinite(policy.padding) || policy.padding < 0) throw new Error("Invalid view padding");
  if (policy.kind === "space") {
    validateSceneSpace({ areas: [{ id: "viewport", bounds: policy.bounds, outerRing: { top: 0, right: 0, bottom: 0, left: 0 } }] });
    return { ...policy, bounds: { ...policy.bounds } };
  }
  if (!isFiniteContentRect(policy.content) || !Number.isFinite(policy.maxAutoZoom) || policy.maxAutoZoom <= 0) {
    throw new Error("Invalid view content bounds");
  }
  return { ...policy, content: { ...policy.content } };
}
