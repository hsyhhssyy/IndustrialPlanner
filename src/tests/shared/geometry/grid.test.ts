import { describe, expect, it } from "vitest"

import {
  rotateSpriteOffset,
  resolveSpriteGridRect,
} from "@/shared/geometry/grid"

// =========================================================================
// rotateSpriteOffset
// =========================================================================

describe("rotateSpriteOffset", () => {
  const offset = { x: -2, y: 0, width: 5, height: 3 }
  const footprint = { width: 3, height: 3 }

  it("returns identity at rotation=0", () => {
    expect(rotateSpriteOffset(offset, footprint, 0)).toEqual(offset)
  })

  it("rotates 90° CW: (x,y)→(-y,x), width↔height", () => {
    const result = rotateSpriteOffset(offset, footprint, 90)
    // Note: -0 normalizes to 0
    expect(result).toEqual({
      x: 0,      // -y = -0 → 0
      y: -2,     // x = -2
      width: 3,  // height
      height: 5, // width
    })
  })

  it("rotates 180° around the footprint center", () => {
    const result = rotateSpriteOffset(offset, footprint, 180)
    expect(result).toEqual({
      // AI-CORRECTION 2026-05-26: footprint 中心旋转后，水泵 footprint 位于旋转后精灵左侧 3×3，不再是单纯 -x。
      x: 0,   // -x = -(-2) = 2
      y: 0,   // -y = -0 → 0
      width: 5,
      height: 3,
    })
  })

  it("rotates 270°: (x,y)→(y,-x), width↔height", () => {
    expect(rotateSpriteOffset(offset, footprint, 270)).toEqual({
      x: 0,      // y = 0
      // AI-CORRECTION 2026-05-26: footprint 中心旋转后，水泵 footprint 位于旋转后精灵上侧 3×3，不再是单纯 -x。
      y: 0,      // -x = -(-2) = 2
      width: 3,  // height
      height: 5, // width
    })
  })

  it("handles positive-only offset", () => {
    expect(rotateSpriteOffset({ x: 1, y: 2, width: 4, height: 3 }, footprint, 90)).toEqual({
      x: -2,
      y: 1,
      width: 3,
      height: 4,
    })
  })
})

// =========================================================================
// resolveSpriteGridRect — null offset (backward compat)
// =========================================================================

describe("resolveSpriteGridRect (null offset)", () => {
  it("uses rotated footprint as sprite rect at rotation=0", () => {
    const rect = resolveSpriteGridRect(
      { x: 10, y: 20 },
      { width: 3, height: 2 },
      null,
      0,
    )
    expect(rect).toEqual({ x: 10, y: 20, width: 3, height: 2 })
  })

  it("uses rotated footprint as sprite rect at rotation=90", () => {
    const rect = resolveSpriteGridRect(
      { x: 10, y: 20 },
      { width: 3, height: 2 },
      null,
      90,
    )
    expect(rect).toEqual({ x: 10, y: 20, width: 2, height: 3 })
  })
})

// =========================================================================
// resolveSpriteGridRect — with offset (water pump scenario)
// =========================================================================

describe("resolveSpriteGridRect (with offset)", () => {
  // Water pump: footprint 3×3, topView sprite 5×3, footprint is right 3×3
  const waterPumpOffset = { x: -2, y: 0, width: 5, height: 3 }

  it("applies offset at rotation=0", () => {
    const rect = resolveSpriteGridRect(
      { x: 10, y: 5 },
      { width: 3, height: 3 },
      waterPumpOffset,
      0,
    )
    expect(rect).toEqual({
      x: 8,   // 10 + (-2)
      y: 5,   // 5 + 0
      width: 5,
      height: 3,
    })
  })

  it("applies offset at rotation=90", () => {
    const rect = resolveSpriteGridRect(
      { x: 10, y: 5 },
      { width: 3, height: 3 },
      waterPumpOffset,
      90,
    )
    // offset rotates: (-2,0,5,3) → (0,-2,3,5)
    expect(rect).toEqual({
      x: 10,  // 10 + 0
      y: 3,   // 5 + (-2)
      width: 3,
      height: 5,
    })
  })

  it("applies offset at rotation=180", () => {
    const rect = resolveSpriteGridRect(
      { x: 10, y: 5 },
      { width: 3, height: 3 },
      waterPumpOffset,
      180,
    )
    // offset rotates: (-2,0,5,3) → (2,0,5,3)
    // AI-CORRECTION 2026-05-26: offset 现在绕 footprint 中心旋转，180° 后为 (0,0,5,3)。
    expect(rect).toEqual({
      x: 10,  // 10 + 2
      y: 5,   // 5 + 0
      width: 5,
      height: 3,
    })
  })

  it("applies offset at rotation=270", () => {
    const rect = resolveSpriteGridRect(
      { x: 10, y: 5 },
      { width: 3, height: 3 },
      waterPumpOffset,
      270,
    )

    expect(rect).toEqual({
      x: 10,
      y: 5,
      width: 3,
      height: 5,
    })
  })
})
