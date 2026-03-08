import { DEVICE_TYPE_BY_ID } from '../registry'
import type { DeviceConfig, DeviceInstance, DeviceTypeId, Direction } from '../types'

export const PORT_PRIORITY_GROUP_MIN = 1
export const PORT_PRIORITY_GROUP_MAX = 10
export const PORT_PRIORITY_GROUP_COUNT = PORT_PRIORITY_GROUP_MAX - PORT_PRIORITY_GROUP_MIN + 1
export const DEFAULT_PORT_PRIORITY_GROUP = 5

export function clampPortPriorityGroup(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_PORT_PRIORITY_GROUP
  const normalized = Math.floor(numeric)
  return Math.min(PORT_PRIORITY_GROUP_MAX, Math.max(PORT_PRIORITY_GROUP_MIN, normalized))
}

export function createEmptyPortPriorityCursors() {
  return Array.from({ length: PORT_PRIORITY_GROUP_COUNT }, () => 0)
}

export function normalizePriorityCursorArray(cursors: readonly number[] | undefined) {
  const next = createEmptyPortPriorityCursors()
  if (!Array.isArray(cursors)) return next
  for (let index = 0; index < PORT_PRIORITY_GROUP_COUNT; index += 1) {
    const value = cursors[index]
    next[index] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }
  return next
}

export function normalizePortPriorityGroups(value: unknown): Partial<Record<string, number>> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const normalizedEntries = Object.entries(value as Record<string, unknown>)
    .filter(([portId]) => typeof portId === 'string' && portId.length > 0)
    .map(([portId, group]) => [portId, clampPortPriorityGroup(group)] as const)
    .filter(([, group]) => group !== DEFAULT_PORT_PRIORITY_GROUP)

  if (normalizedEntries.length === 0) return undefined
  return Object.fromEntries(normalizedEntries)
}

export function buildPortPriorityGroupConfig(entries: Iterable<readonly [string, number]>) {
  const normalizedEntries = [...entries]
    .filter(([portId]) => typeof portId === 'string' && portId.length > 0)
    .map(([portId, group]) => [portId, clampPortPriorityGroup(group)] as const)
    .filter(([, group]) => group !== DEFAULT_PORT_PRIORITY_GROUP)

  if (normalizedEntries.length === 0) return undefined
  return Object.fromEntries(normalizedEntries) as Partial<Record<string, number>>
}

export function getPortPriorityGroup(config: Pick<DeviceConfig, 'portPriorityGroups'> | undefined, portId: string) {
  return clampPortPriorityGroup(config?.portPriorityGroups?.[portId])
}

export function hasCustomPortPriorityGroups(config: Pick<DeviceConfig, 'portPriorityGroups'> | undefined) {
  return Boolean(normalizePortPriorityGroups(config?.portPriorityGroups))
}

export function getDirectionalPortIds(typeId: DeviceTypeId, direction?: Direction) {
  const ports = DEVICE_TYPE_BY_ID[typeId]?.ports0 ?? []
  return ports.filter((port) => (direction ? port.direction === direction : true)).map((port) => port.id)
}

export function shouldShowPortPriorityConfigButton(deviceOrType: Pick<DeviceInstance, 'typeId'> | DeviceTypeId) {
  const typeId = typeof deviceOrType === 'string' ? deviceOrType : deviceOrType.typeId
  if (typeId === 'item_log_connector' || typeId === 'item_pipe_connector') return false
  return getDirectionalPortIds(typeId, 'Input').length > 1 || getDirectionalPortIds(typeId, 'Output').length > 1
}

function rotatePortOrder(portIds: string[], cursor: number) {
  if (portIds.length <= 1) return portIds
  const offset = ((cursor % portIds.length) + portIds.length) % portIds.length
  return [...portIds.slice(offset), ...portIds.slice(0, offset)]
}

export function orderPortsByPriorityGroup(
  portIds: string[],
  getPriorityGroup: (portId: string) => number,
  cursors?: readonly number[],
) {
  const uniquePortIds = [...new Set(portIds)]
  const ordered: string[] = []
  for (let group = PORT_PRIORITY_GROUP_MIN; group <= PORT_PRIORITY_GROUP_MAX; group += 1) {
    const groupedPorts = uniquePortIds.filter((portId) => getPriorityGroup(portId) === group)
    if (groupedPorts.length === 0) continue
    const cursor = cursors?.[group - PORT_PRIORITY_GROUP_MIN] ?? 0
    ordered.push(...rotatePortOrder(groupedPorts, cursor))
  }
  return ordered
}
