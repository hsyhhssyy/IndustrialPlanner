import { getRotatedPorts, OPPOSITE_EDGE } from '../domain/geometry'
import {
  getDirectionalPortIds,
  getPortPriorityGroup,
  normalizePriorityCursorArray,
  PORT_PRIORITY_GROUP_MIN,
} from '../domain/shared/portPriority'
import type { DeviceInstance, DeviceRuntime, JunctionRuntime, LayoutState } from '../domain/types'

const SPLITTER_TYPE_IDS = new Set(['item_log_splitter', 'item_pipe_splitter'])
const CONVERGER_TYPE_IDS = new Set(['item_log_converger', 'item_pipe_converger'])
const DEFAULT_JUNCTION_LANE = 'slot'
const DEFAULT_OUTPUT_PRIORITY_GROUP_KEY = '__default__'

function isJunctionRuntime(runtime: DeviceRuntime | undefined): runtime is JunctionRuntime {
  return Boolean(runtime && 'slot' in runtime && 'nsSlot' in runtime && 'weSlot' in runtime && 'producedItemsTotal' in runtime)
}

function findStraightSplitterOutputPortId(device: DeviceInstance) {
  const rotatedPorts = getRotatedPorts(device)
  const inputPort = rotatedPorts.find((port) => port.direction === 'Input')
  if (!inputPort) return undefined
  return rotatedPorts.find((port) => port.direction === 'Output' && port.edge === OPPOSITE_EDGE[inputPort.edge])?.portId
}

function findStraightConvergerInputPortId(device: DeviceInstance) {
  const rotatedPorts = getRotatedPorts(device)
  const outputPort = rotatedPorts.find((port) => port.direction === 'Output')
  if (!outputPort) return undefined
  return rotatedPorts.find((port) => port.direction === 'Input' && port.edge === OPPOSITE_EDGE[outputPort.edge])?.portId
}

function setOutputPriorityCursorToPort(device: DeviceInstance, runtime: JunctionRuntime, targetPortId: string) {
  const priorityGroup = getPortPriorityGroup(device.config, targetPortId)
  const groupPortIds = getDirectionalPortIds(device.typeId, 'Output').filter(
    (portId) => getPortPriorityGroup(device.config, portId) === priorityGroup,
  )
  const targetPortIndex = groupPortIds.findIndex((portId) => portId === targetPortId)
  if (targetPortIndex < 0) return

  const nextCursor = normalizePriorityCursorArray(runtime.outputPriorityGroupCursorByGroup?.[DEFAULT_OUTPUT_PRIORITY_GROUP_KEY])
  nextCursor[priorityGroup - PORT_PRIORITY_GROUP_MIN] = targetPortIndex
  runtime.outputPriorityGroupCursorByGroup = {
    ...(runtime.outputPriorityGroupCursorByGroup ?? {}),
    [DEFAULT_OUTPUT_PRIORITY_GROUP_KEY]: nextCursor,
  }
}

function setInputPriorityCursorToPort(device: DeviceInstance, runtime: JunctionRuntime, targetPortId: string) {
  const priorityGroup = getPortPriorityGroup(device.config, targetPortId)
  const groupPortIds = getDirectionalPortIds(device.typeId, 'Input').filter(
    (portId) => getPortPriorityGroup(device.config, portId) === priorityGroup,
  )
  const targetPortIndex = groupPortIds.findIndex((portId) => portId === targetPortId)
  if (targetPortIndex < 0) return

  const laneKey = `${device.instanceId}:${DEFAULT_JUNCTION_LANE}`
  const nextCursor = normalizePriorityCursorArray(runtime.inputPriorityGroupCursorByLane?.[laneKey])
  nextCursor[priorityGroup - PORT_PRIORITY_GROUP_MIN] = targetPortIndex
  runtime.inputPriorityGroupCursorByLane = {
    ...(runtime.inputPriorityGroupCursorByLane ?? {}),
    [laneKey]: nextCursor,
  }
}

function initializeSplitterStraightPriorityPointers(layout: LayoutState, runtimeById: Record<string, DeviceRuntime>) {
  for (const device of layout.devices) {
    if (!SPLITTER_TYPE_IDS.has(device.typeId)) continue
    const runtime = runtimeById[device.instanceId]
    if (!isJunctionRuntime(runtime)) continue
    const straightOutputPortId = findStraightSplitterOutputPortId(device)
    if (!straightOutputPortId) continue
    setOutputPriorityCursorToPort(device, runtime, straightOutputPortId)
  }
}

function initializeConvergerStraightPriorityPointers(layout: LayoutState, runtimeById: Record<string, DeviceRuntime>) {
  for (const device of layout.devices) {
    if (!CONVERGER_TYPE_IDS.has(device.typeId)) continue
    const runtime = runtimeById[device.instanceId]
    if (!isJunctionRuntime(runtime)) continue
    const straightInputPortId = findStraightConvergerInputPortId(device)
    if (!straightInputPortId) continue
    setInputPriorityCursorToPort(device, runtime, straightInputPortId)
  }
}

export function applySimulationInitializationSpecialRules(layout: LayoutState, runtimeById: Record<string, DeviceRuntime>) {
  initializeSplitterStraightPriorityPointers(layout, runtimeById)
  initializeConvergerStraightPriorityPointers(layout, runtimeById)
}