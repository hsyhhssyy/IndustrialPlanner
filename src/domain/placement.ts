import { BASE_BY_ID, DEVICE_TYPE_BY_ID } from './registry'
import { buildOccupancyMap, EDGE_DELTA, getRotatedPorts, OPPOSITE_EDGE } from './geometry'
import type { DeviceInstance, DeviceTypeDef, Edge, LayoutState, PlacementConstraint } from './types'

export interface PlacementValidationResult {
  isValid: boolean
  messageKey?: string
}

function rotatedFootprintSize(size: { width: number; height: number }, rotation: DeviceInstance['rotation']) {
  if (rotation === 90 || rotation === 270) {
    return { width: size.height, height: size.width }
  }
  return size
}

function getBoundaryCellsForEdge(instance: DeviceInstance, edge: Edge) {
  const type = DEVICE_TYPE_BY_ID[instance.typeId]
  if (!type) return [] as Array<{ x: number; y: number }>

  const footprint = rotatedFootprintSize(type.size, instance.rotation)
  const { x: originX, y: originY } = instance.origin
  if (edge === 'N') {
    return Array.from({ length: footprint.width }, (_, i) => ({ x: originX + i, y: originY }))
  }
  if (edge === 'S') {
    return Array.from({ length: footprint.width }, (_, i) => ({ x: originX + i, y: originY + footprint.height - 1 }))
  }
  if (edge === 'W') {
    return Array.from({ length: footprint.height }, (_, i) => ({ x: originX, y: originY + i }))
  }
  return Array.from({ length: footprint.height }, (_, i) => ({ x: originX + footprint.width - 1, y: originY + i }))
}

function resolveRuleEdge(instance: DeviceInstance, rule: Extract<PlacementConstraint, { kind: 'edge_contact' }>) {
  if (rule.edgeMode === 'explicit') return rule.edge ?? null
  const rotatedPorts = getRotatedPorts(instance)
  const basePort = rule.portId ? rotatedPorts.find((port) => port.portId === rule.portId) : rotatedPorts[0]
  if (!basePort) return null
  return OPPOSITE_EDGE[basePort.edge]
}

function createTargetMatcher(rule: Extract<PlacementConstraint, { kind: 'edge_contact' }>) {
  const typeIdSet = rule.targetTypeIds ? new Set(rule.targetTypeIds) : null
  const tagSet = rule.targetTagsAny ? new Set(rule.targetTagsAny) : null
  return (type: DeviceTypeDef) => {
    const hitTypeId = typeIdSet ? typeIdSet.has(type.id) : false
    const hitTag = tagSet ? (type.tags ?? []).some((tag) => tagSet.has(tag)) : false
    if (!typeIdSet && !tagSet) return true
    return hitTypeId || hitTag
  }
}

function checkEdgeContactRule(layout: LayoutState, instance: DeviceInstance, rule: Extract<PlacementConstraint, { kind: 'edge_contact' }>) {
  const resolvedEdge = resolveRuleEdge(instance, rule)
  if (!resolvedEdge) return false

  const occupancyMap = buildOccupancyMap(layout)
  const deviceById = new Map(layout.devices.map((device) => [device.instanceId, device]))
  const { dx, dy } = EDGE_DELTA[resolvedEdge]
  const boundaryCells = getBoundaryCellsForEdge(instance, resolvedEdge)
  const isTarget = createTargetMatcher(rule)

  let touched = 0
  for (const boundaryCell of boundaryCells) {
    const neighborKey = `${boundaryCell.x + dx},${boundaryCell.y + dy}`
    const neighbors = occupancyMap.get(neighborKey)
    if (!neighbors || neighbors.length === 0) continue
    const matched = neighbors.some((entry) => {
      const neighborDevice = deviceById.get(entry.instanceId)
      if (!neighborDevice) return false
      const neighborType = DEVICE_TYPE_BY_ID[neighborDevice.typeId]
      if (!neighborType) return false
      return isTarget(neighborType)
    })
    if (matched) {
      touched += 1
      if (touched >= rule.minAdjacentCells) return true
    }
  }

  return false
}

export function passesPlacementConstraints(layout: LayoutState, instance: DeviceInstance) {
  return validatePlacementConstraints(layout, instance).isValid
}

export function validatePlacementConstraints(layout: LayoutState, instance: DeviceInstance): PlacementValidationResult {
  const type = DEVICE_TYPE_BY_ID[instance.typeId]
  const base = BASE_BY_ID[layout.baseId]
  const isBaseFoundationDevice = base?.foundationBuildings.some((building) => building.instanceId === instance.instanceId) ?? false

  if (type?.tags?.includes('武陵') && !isBaseFoundationDevice && !base?.tags.includes('武陵')) {
    return {
      isValid: false,
      messageKey: 'toast.rule.wulingOnly',
    }
  }

  if (!type?.placementConstraints || type.placementConstraints.length === 0) {
    return { isValid: true }
  }

  for (const rule of type.placementConstraints) {
    if (rule.kind === 'edge_contact' && !checkEdgeContactRule(layout, instance, rule)) {
      return {
        isValid: false,
        messageKey: rule.violationMessageKey,
      }
    }
  }

  return { isValid: true }
}
