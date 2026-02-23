import { OPPOSITE_EDGE } from '../geometry'
import type { Edge } from '../types'
import { clamp } from './math'

const EDGE_ANCHOR: Record<Edge, { x: number; y: number }> = {
  N: { x: 32, y: 0 },
  S: { x: 32, y: 64 },
  W: { x: 0, y: 32 },
  E: { x: 64, y: 32 },
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function buildBeltTrackPath(inEdge: Edge, outEdge: Edge) {
  const start = EDGE_ANCHOR[inEdge]
  const end = EDGE_ANCHOR[outEdge]
  if (OPPOSITE_EDGE[inEdge] === outEdge) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
  }
  return `M ${start.x} ${start.y} L 32 32 L ${end.x} ${end.y}`
}

export function getBeltItemPosition(inEdge: Edge, outEdge: Edge, progress01: number) {
  const t = clamp(progress01, 0, 1)
  const start = EDGE_ANCHOR[inEdge]
  const end = EDGE_ANCHOR[outEdge]
  if (OPPOSITE_EDGE[inEdge] === outEdge) {
    return {
      x: lerp(start.x, end.x, t),
      y: lerp(start.y, end.y, t),
    }
  }

  if (t < 0.5) {
    const local = t / 0.5
    return {
      x: lerp(start.x, 32, local),
      y: lerp(start.y, 32, local),
    }
  }

  const local = (t - 0.5) / 0.5
  return {
    x: lerp(32, end.x, local),
    y: lerp(32, end.y, local),
  }
}

export function junctionArrowPoints(edge: Edge) {
  if (edge === 'E') return '68,44 80,50 68,56'
  if (edge === 'W') return '32,44 20,50 32,56'
  if (edge === 'N') return '44,32 50,20 56,32'
  return '44,68 50,80 56,68'
}