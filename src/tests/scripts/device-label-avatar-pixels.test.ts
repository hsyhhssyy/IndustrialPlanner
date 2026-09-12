import { describe, expect, it } from "vitest"

// @ts-expect-error 此脚本由 Node 直接执行，没有单独维护声明文件。
import * as avatarPixelPublisher from "../../scripts/publish-device-label-avatars.mjs"

const {
  OUTLINE_CHANNEL,
  OUTLINE_OPACITY,
  SHADOW_CHANNEL,
  SHADOW_OPACITY,
  createWhiteShadowPixels,
} = avatarPixelPublisher

describe("device label avatar pixel layers", () => {
  it("renders a white body, full dark outline, and separate southeast shadow", () => {
    const width = 5
    const height = 5
    const source = Buffer.alloc(width * height * 4)
    source[(2 * width + 2) * 4 + 3] = 255

    const output = createWhiteShadowPixels(source, width, height)
    const pixelAt = (x: number, y: number) => (
      Array.from(output.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))
    )

    expect(pixelAt(2, 2)).toEqual([255, 255, 255, 255])
    expect(pixelAt(1, 2)).toEqual([
      OUTLINE_CHANNEL,
      OUTLINE_CHANNEL,
      OUTLINE_CHANNEL,
      Math.round(255 * OUTLINE_OPACITY),
    ])
    expect(pixelAt(2, 1)).toEqual([
      OUTLINE_CHANNEL,
      OUTLINE_CHANNEL,
      OUTLINE_CHANNEL,
      Math.round(255 * OUTLINE_OPACITY),
    ])
    expect(pixelAt(3, 3)).toEqual([
      SHADOW_CHANNEL,
      SHADOW_CHANNEL,
      SHADOW_CHANNEL,
      Math.round(255 * SHADOW_OPACITY),
    ])
    expect(pixelAt(0, 0)).toEqual([0, 0, 0, 0])
  })
})
