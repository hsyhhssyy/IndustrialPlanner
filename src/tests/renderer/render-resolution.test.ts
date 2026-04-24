import { describe, expect, it } from "vitest"

import {
  DEFAULT_RENDER_RESOLUTION,
  resolveRenderResolutionFromApp,
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

describe("resolveRenderResolutionFromApp", () => {
  it("reads devicePixelRatio from the public screen profile state", () => {
    expect(
      resolveRenderResolutionFromApp({
        state: {
          screenProfile: {
            devicePixelRatio: 3,
          },
        },
      } as never),
    ).toBe(3)
  })

  it("falls back to the provided renderer resolution when app state is missing", () => {
    expect(resolveRenderResolutionFromApp(null, 2)).toBe(2)
  })

  it("falls back to the default resolution when both inputs are invalid", () => {
    expect(
      resolveRenderResolutionFromApp({
        state: {
          screenProfile: {
            devicePixelRatio: Number.NaN,
          },
        },
      } as never, Number.NaN),
    ).toBe(DEFAULT_RENDER_RESOLUTION)
  })
})
