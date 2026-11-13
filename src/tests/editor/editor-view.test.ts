// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { EditorViewOptions } from "@/domain/editor/types/editor-view-types";
import type { CanvasOperationId } from "@/domain/shared/canvas-operation";
import { createEditorView } from "@/editor/editor-view";

const options: EditorViewOptions = {
  id: "view",
  initialViewport: { center: { x: 0, y: 0 }, gridSize: 1, displayRotation: 0 },
  bounds: { kind: "space", bounds: { minX: null, maxX: null, minY: null, maxY: null }, padding: 0 },
  getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
};

describe("independent editor views", () => {
  it("未测量或隐藏的视口不提供坐标转换，恢复尺寸后重新可用", () => {
    const view = createEditorView(options);
    try {
      expect(view.queries.findGridCellForClientPixelPoint({ x: 0, y: 0 })).toBeNull();
      expect(view.queries.findClientRectForGridCell({ x: 0, y: 0 })).toBeNull();
      view.actions.setViewportClientRect({ left: 10, top: 20, width: 160, height: 160 });
      expect(view.queries.findGridCellForClientPixelPoint({ x: 90, y: 100 })).toEqual({ x: 0, y: 0 });
      view.actions.setViewportClientRect({ left: 10, top: 20, width: 0, height: 160 });
      expect(view.queries.findClientRectForGridCell({ x: 0, y: 0 })).toBeNull();
      view.actions.setViewportClientRect({ left: 10, top: 20, width: 160, height: 160 });
      expect(view.queries.findClientRectForGridCell({ x: 0, y: 0 })).toEqual({ left: 90, top: 100, width: 16, height: 16 });
    } finally { view.dispose(); }
  });
  it("隐藏为零尺寸再恢复不会平移相机", () => {
    const view = createEditorView(options);
    try {
      view.actions.setViewportClientRect({ left: 100, top: 50, width: 800, height: 600 });
      view.actions.focusOnBounds({ x: 8, y: 18, width: 4, height: 4 }, { durationMs: 0 });
      view.actions.setViewportClientRect({ left: 0, top: 0, width: 0, height: 0 });
      expect(view.state.center).toEqual({ x: 10, y: 20 });
      view.actions.setViewportClientRect({ left: 120, top: 60, width: 800, height: 600 });
      expect(view.state.center).toEqual({ x: 10, y: 20 });
    } finally { view.dispose(); }
  });
  it("creates two headless cameras with independent pan, zoom, resize and rotation", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof requestAnimationFrame).toBe("undefined");
    const left = createEditorView(options);
    const right = createEditorView({ ...options, id: "right" });
    try {
      for (const view of [left, right]) view.actions.setViewportClientRect({ left: 100, top: 50, width: 800, height: 600 });
      left.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 500, y: 350 }, endClientPixel: { x: 532, y: 334 } });
      expect(left.state.center).toEqual({ x: -2, y: 1 });
      left.actions.zoom(6);
      left.actions.setViewportDisplayRotation(90);
      expect(left.state.gridSize).toBe(2);
      right.actions.setViewportClientRect({ left: 0, top: 0, width: 1200, height: 800 });
      expect(right.state.center).toEqual({ x: 6.25, y: 3.125 });
      expect(left.state.center).toEqual({ x: -2, y: 1 });
      expect(right.state.gridSize).toBe(1);
      expect(right.state.displayRotation).toBe(0);
      expect(options.initialViewport.center).toEqual({ x: 0, y: 0 });
    } finally { left.dispose(); right.dispose(); }
  });

  it.each([0, 90, 180, 270] as const)("round-trips negative cells using each view's client origin at %i degrees", (rotation) => {
    const view = createEditorView({ ...options, initialViewport: { ...options.initialViewport, displayRotation: rotation } });
    try {
      view.actions.setViewportClientRect({ left: 127, top: 81, width: 641, height: 353 });
      const rect = view.queries.findClientRectForGridCell({ x: -4, y: -7 })!;
      expect(view.queries.findGridCellForClientPixelPoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })).toEqual({ x: -4, y: -7 });
      expect(view.queries.findGridCellForClientPixelPoint({ x: Infinity, y: 0 })).toBeNull();
    } finally { view.dispose(); }
  });

  it("advances focus only from explicit deltas, preserves motion on repeated measurement, and cancels on input", () => {
    const view = createEditorView(options);
    try {
      const rect = { left: 0, top: 0, width: 800, height: 600 };
      view.actions.setViewportClientRect(rect);
      view.actions.focusOnBounds({ x: 8, y: 18, width: 4, height: 4 }, { durationMs: 100, gridSize: 2 });
      expect(view.queries.hasPendingMotion()).toBe(true);
      expect(view.state.center).toEqual({ x: 0, y: 0 });
      view.actions.setViewportClientRect(rect);
      view.actions.advance(50);
      expect(view.state.center).toEqual({ x: 5, y: 10 });
      expect(view.state.gridSize).toBe(1.5);
      view.actions.advance(50);
      expect(view.state.center).toEqual({ x: 10, y: 20 });
      expect(view.queries.hasPendingMotion()).toBe(false);
      view.actions.focusOnBounds({ x: 100, y: 100, width: 2, height: 2 });
      view.actions.zoom(1);
      expect(view.queries.hasPendingMotion()).toBe(false);
      const center = { ...view.state.center };
      view.actions.advance(10000);
      expect(view.state.center).toEqual(center);
    } finally { view.dispose(); }
  });

  it("filters user camera operations while allowing the owner to fit static content", () => {
    const denied = new Set<CanvasOperationId>(["pan-viewport", "zoom-viewport", "rotate-viewport"]);
    const view = createEditorView({ ...options, getOperationAvailability: (operation) => ({ supported: !denied.has(operation), enabled: true, reason: null }) });
    try {
      view.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
      view.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 160, y: 160 } });
      view.actions.zoom(6);
      view.actions.setViewportDisplayRotation(90);
      expect(view.state.center).toEqual({ x: 0, y: 0 });
      expect(view.state.gridSize).toBe(1);
      expect(view.state.displayRotation).toBe(0);
      view.actions.focusOnBounds({ x: -20, y: -10, width: 10, height: 6 }, { durationMs: 0, gridSize: 2 });
      expect(view.state.center).toEqual({ x: -15, y: -7 });
      expect(view.state.gridSize).toBe(2);
    } finally { view.dispose(); }
  });

  it("constrains only finite directions and rejects invalid policy without changing the camera", () => {
    const view = createEditorView({ ...options, bounds: { kind: "space", bounds: { minX: -10, maxX: null, minY: null, maxY: 20 }, padding: 2 } });
    try {
      view.actions.focusOnBounds({ x: -1000, y: 1000, width: 2, height: 2 }, { durationMs: 0 });
      expect(view.state.center).toEqual({ x: -12, y: 22 });
      view.actions.focusOnBounds({ x: 1000, y: -1000, width: 2, height: 2 }, { durationMs: 0 });
      expect(view.state.center).toEqual({ x: 1001, y: -999 });
      // 2026-11-12：空内容是合法蓝图，负尺寸才是无效边界。
      expect(() => view.actions.setBoundsPolicy({ kind: "content", content: { x: 0, y: 0, width: -1, height: 2 }, padding: 0, maxAutoZoom: 1 })).toThrow();
      expect(view.state.center).toEqual({ x: 1001, y: -999 });
      view.actions.focusOnBounds({ x: 0, y: 0, width: 2, height: 2 });
      view.dispose(); view.dispose();
      view.actions.advance(1000);
      view.actions.zoom(6);
      expect(view.queries.hasPendingMotion()).toBe(false);
      expect(view.queries.findClientRectForGridCell({ x: 0, y: 0 })).toBeNull();
      expect(view.state.center).toEqual({ x: 1001, y: -999 });
    } finally { view.dispose(); }
  });
});
