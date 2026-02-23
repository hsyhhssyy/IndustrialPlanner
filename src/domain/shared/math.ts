import type { Rotation } from '../types'

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function rotatedFootprintSize(size: { width: number; height: number }, rotation: Rotation) {
  if (rotation === 90 || rotation === 270) {
    return { width: size.height, height: size.width }
  }
  return size
}