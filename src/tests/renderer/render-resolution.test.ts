import { createAppTestWorkspace } from "@/tests/helpers/app-test-workspace";
import { createScenePresentation } from "@/app/canvas";
import { describe, expect, it } from "vitest"

import {
  DEFAULT_RENDER_RESOLUTION,
  resolveRenderResolutionFromPresentation,
  resolveRenderResolutionValue,
} from "@/renderer/render-resolution"

describe("resolveRenderResolutionValue", () => {
  it("keeps finite positive render resolutions", () => {
    expect(resolveRenderResolutionValue(2)).toBe(2)
    expect(resolveRenderResolutionValue(1.5)).toBe(1.5)
  })

  it("falls back when the candidate resolution is invalid", () => {
    expect(resolveRenderResolutionValue(0, 2)).toBe(2)
    expect(resolveRenderResolutionValue(Number.NaN, 2)).toBe(2)
    expect(resolveRenderResolutionValue(Number.POSITIVE_INFINITY, 2)).toBe(2)
  })
})

// AI-REMOVED 2026-11-12:
// Reason: 接口已迁移到独立 Canvas，测试组合真实工作台与相机。
// Trigger: REQ-048 输入上下文迁移与测试架构规则。
// Evidence: 旧 fixture 只有伪造 workspace/internalState，不能验证当前归属。
// Replacement: 真实 createScenePresentation + 明确 DPR 输入
// Risk: 路由优先级与匹配断言保持；真实浏览器另行验证。
// Human Review: Required
// Original code:
// describe("resolveRenderResolutionFromPresentation", () => {
//   it("reads devicePixelRatio from the public screen profile state", () => {
//     expect(
//       resolveRenderResolutionFromPresentation({
//         state: {
//           screenProfile: {
//             devicePixelRatio: 3,
//           },
//         },
//       } as never),
//     ).toBe(3)
//   })
//
//   it("falls back to the provided renderer resolution when app state is missing", () => {
//     expect(resolveRenderResolutionFromPresentation(null, 2)).toBe(2)
//   })
//
//   it("falls back to the default resolution when both inputs are invalid", () => {
//     expect(
//       resolveRenderResolutionFromPresentation({
//         state: {
//           screenProfile: {
//             devicePixelRatio: Number.NaN,
//           },
//         },
//       } as never, Number.NaN),
//     ).toBe(DEFAULT_RENDER_RESOLUTION)
//   })
// })
describe("resolveRenderResolutionFromPresentation", () => {
  it("reads DPR from explicit scene presentation and normalizes invalid fallbacks", () => {
    const { app } = createAppTestWorkspace();
    const presentation = createScenePresentation({ app, readTools: () => app.mainCanvas.state, showBaseBoundary: true });
    try {
      const snapshot = presentation.snapshot.getSnapshot();
      expect(resolveRenderResolutionFromPresentation({ ...snapshot, screenProfile: { ...snapshot.screenProfile, devicePixelRatio: 3 } })).toBe(3);
      expect(resolveRenderResolutionFromPresentation(null, 2)).toBe(2);
      expect(resolveRenderResolutionFromPresentation({ ...snapshot, screenProfile: { ...snapshot.screenProfile, devicePixelRatio: Number.NaN } }, Number.NaN)).toBe(DEFAULT_RENDER_RESOLUTION);
    } finally { presentation.dispose(); app.dispose(); }
  });
});
