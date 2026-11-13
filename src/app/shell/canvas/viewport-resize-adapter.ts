// AI-REMOVED 2026-11-12:
// Reason: 相机从 Editor 分离，并补齐只有位置变化时的测量。
// Trigger: REQ-048 D4 与滚动／布局变化后的真实命中要求。
// Evidence: 旧 ResizeObserver 仅监听表面尺寸，祖先滚动不更新 clientRect。
// Replacement: 下方 View 测量绑定。
// Risk: 三种 Screen Profile 与原生滚动需浏览器验证。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";
// import { useEffect, type RefObject } from "react";
//
// function resolveViewportClientRect(element: HTMLDivElement) {
//   const clientRect = element.getBoundingClientRect();
//
//   return {
//     left: clientRect.left,
//     top: clientRect.top,
//     width: Math.max(0, Math.floor(element.clientWidth)),
//     height: Math.max(0, Math.floor(element.clientHeight)),
//   };
// }
//
// export function useViewportResizeAdapter(options: {
//   editor: EditorContract | null;
//   viewportSurfaceRef: RefObject<HTMLDivElement | null>;
// }) {
//   const { editor, viewportSurfaceRef } = options;
//
//   useEffect(() => {
//     const viewportSurface = viewportSurfaceRef.current;
//
//     if (!editor || !viewportSurface || typeof ResizeObserver === "undefined") {
//       return;
//     }
//
//     const resizeObserver = new ResizeObserver(() => {
//       const clientRect = resolveViewportClientRect(viewportSurface);
//
//       if (
//         clientRect.left === editor.state.viewport.clientRect.left &&
//         clientRect.top === editor.state.viewport.clientRect.top &&
//         clientRect.width === editor.state.viewport.clientRect.width &&
//         clientRect.height === editor.state.viewport.clientRect.height
//       ) {
//         return;
//       }
//
//       editor.actions.setViewportClientRect(clientRect);
//     });
//
//     resizeObserver.observe(viewportSurface);
//
//     return () => {
//       resizeObserver.disconnect();
//     };
//   }, [editor, viewportSurfaceRef]);
// }

import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import { useEffect, type RefObject } from "react";

export function useViewportResizeAdapter(options: {
  view: EditorViewContract;
  viewportSurfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { view, viewportSurfaceRef } = options;
  useEffect(() => {
    const surface = viewportSurfaceRef.current;
    if (surface === null) return;
    let frame: number | null = null;
    const measure = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const rect = surface.getBoundingClientRect();
      view.actions.setViewportClientRect({ left: rect.left, top: rect.top,
        width: Math.max(0, Math.floor(surface.clientWidth)), height: Math.max(0, Math.floor(surface.clientHeight)) });
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    for (let element: HTMLElement | null = surface; element !== null; element = element.parentElement) observer?.observe(element);
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    mutations?.observe(document.body, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    // 原生指针开始前同步最新位置，避免等下一帧测量才更新命中坐标。
    surface.addEventListener("pointerdown", measure, true);
    measure();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect(); mutations?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      surface.removeEventListener("pointerdown", measure, true);
    };
  }, [view, viewportSurfaceRef]);
}
