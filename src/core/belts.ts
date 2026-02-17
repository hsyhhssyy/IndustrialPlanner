import type { BeltCell, GridPoint } from "../types/domain"

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`
}

function isNeighbor(a: GridPoint, b: GridPoint): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1
}

export function buildBeltPath(start: GridPoint, end: GridPoint): GridPoint[] {
  const points: GridPoint[] = [{ ...start }]
  let cursor = { ...start }

  while (cursor.x !== end.x) {
    cursor = {
      x: cursor.x + (end.x > cursor.x ? 1 : -1),
      y: cursor.y,
    }
    points.push({ ...cursor })
  }

  while (cursor.y !== end.y) {
    cursor = {
      x: cursor.x,
      y: cursor.y + (end.y > cursor.y ? 1 : -1),
    }
    points.push({ ...cursor })
  }

  return points
}

export function validateNoBacktrack(path: GridPoint[]): boolean {
  if (path.length <= 2) {
    return true
  }

  for (let index = 2; index < path.length; index += 1) {
    const current = path[index]
    const twoStepsAgo = path[index - 2]
    if (current.x === twoStepsAgo.x && current.y === twoStepsAgo.y) {
      return false
    }
  }

  return true
}

export function validatePathContiguous(path: GridPoint[]): boolean {
  for (let index = 1; index < path.length; index += 1) {
    if (!isNeighbor(path[index - 1], path[index])) {
      return false
    }
  }
  return true
}

export function hasCellOverlap(existing: BeltCell[], path: GridPoint[]): boolean {
  const existingKeys = new Set(existing.map((cell) => pointKey(cell)))
  return path.some((point) => existingKeys.has(pointKey(point)))
}

export function createBeltCells(path: GridPoint[]): BeltCell[] {
  return path.map((point) => ({
    id: `b_${point.x}_${point.y}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    x: point.x,
    y: point.y,
  }))
}

export function deleteBeltCell(existing: BeltCell[], point: GridPoint): BeltCell[] {
  return existing.filter((cell) => !(cell.x === point.x && cell.y === point.y))
}

export function deleteConnectedComponent(existing: BeltCell[], start: GridPoint): BeltCell[] {
  const map = new Map<string, BeltCell>()
  existing.forEach((cell) => {
    map.set(`${cell.x},${cell.y}`, cell)
  })

  const startKey = `${start.x},${start.y}`
  if (!map.has(startKey)) {
    return existing
  }

  const queue: GridPoint[] = [{ ...start }]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()!
    const key = `${current.x},${current.y}`
    if (visited.has(key)) {
      continue
    }

    visited.add(key)

    const neighbors: GridPoint[] = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]

    neighbors.forEach((neighbor) => {
      const neighborKey = `${neighbor.x},${neighbor.y}`
      if (map.has(neighborKey) && !visited.has(neighborKey)) {
        queue.push(neighbor)
      }
    })
  }

  return existing.filter((cell) => !visited.has(`${cell.x},${cell.y}`))
}
