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

  it("returns identity at rotation=0", () => {
    expect(rotateSpriteOffset(offset, 0)).toEqual(offset)
  })

  it("rotates 90° CW: (x,y)→(-y,x), width↔height", () => {
    const result = rotateSpriteOffset(offset, 90)
    // Note: -0 normalizes to 0
    expect(result).toEqual({
      x: 0,      // -y = -0 → 0
      y: -2,     // x = -2
      width: 3,  // height
      height: 5, // width
    })
  })

  it("rotates 180°: (x,y)→(-x,-y)", () => {
    const result = rotateSpriteOffset(offset, 180)
    expect(result).toEqual({
      x: 2,   // -x = -(-2) = 2
      y: 0,   // -y = -0 → 0
      width: 5,
      height: 3,
    })
  })

  it("rotates 270°: (x,y)→(y,-x), width↔height", () => {
    expect(rotateSpriteOffset(offset, 270)).toEqual({
      x: 0,      // y = 0
      y: 2,      // -x = -(-2) = 2
      width: 3,  // height
      height: 5, // width
    })
  })

  it("handles positive-only offset", () => {
    expect(rotateSpriteOffset({ x: 1, y: 2, width: 4, height: 3 }, 90)).toEqual({
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
    expect(rect).toEqual({
      x: 12,  // 10 + 2
      y: 5,   // 5 + 0
      width: 5,
      height: 3,
    })
  })
})
