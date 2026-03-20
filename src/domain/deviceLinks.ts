import type {
  BlueprintDeviceLink,
  DarkPipeInletMode,
  DarkPipeOutletMode,
  DeviceConfig,
  DeviceInstance,
  DeviceLink,
  DeviceTypeId,
  LayoutState,
} from './types'

let deviceLinkCounter = 1

export function createDeviceLinkId() {
  deviceLinkCounter += 1
  return `device-link_${Date.now().toString(36)}_${deviceLinkCounter.toString(36)}`
}

export function isDarkPipeInletType(typeId: DeviceTypeId | undefined) {
  return typeId === 'item_port_udpipe_loader_1'
}

export function isDarkPipeOutletType(typeId: DeviceTypeId | undefined) {
  return typeId === 'item_port_udpipe_unloader_1'
}

export function isLinkableDeviceType(typeId: DeviceTypeId | undefined) {
  return isDarkPipeInletType(typeId) || isDarkPipeOutletType(typeId)
}

export function getDarkPipeInletMode(config: DeviceConfig | undefined): DarkPipeInletMode {
  return config?.darkPipeInletMode === 'link' ? 'link' : 'destroy'
}

export function getDarkPipeOutletMode(config: DeviceConfig | undefined): DarkPipeOutletMode {
  return config?.darkPipeOutletMode === 'link' ? 'link' : 'generate'
}

export function isDarkPipeLinkPair(sourceTypeId: DeviceTypeId | undefined, targetTypeId: DeviceTypeId | undefined) {
  return isDarkPipeInletType(sourceTypeId) && isDarkPipeOutletType(targetTypeId)
}

export function getDeviceLinkByEndpoint(layout: Pick<LayoutState, 'links'>, instanceId: string) {
  return layout.links.find((link) => link.sourceInstanceId === instanceId || link.targetInstanceId === instanceId) ?? null
}

export function getLinkedTargetId(layout: Pick<LayoutState, 'links'>, sourceInstanceId: string) {
  return layout.links.find((link) => link.sourceInstanceId === sourceInstanceId)?.targetInstanceId ?? null
}

export function getLinkedSourceId(layout: Pick<LayoutState, 'links'>, targetInstanceId: string) {
  return layout.links.find((link) => link.targetInstanceId === targetInstanceId)?.sourceInstanceId ?? null
}

export function getDeviceLinksForInstance(layout: Pick<LayoutState, 'links'>, instanceId: string) {
  return layout.links.filter((link) => link.sourceInstanceId === instanceId || link.targetInstanceId === instanceId)
}

function sanitizeLinkId(linkId: unknown) {
  return typeof linkId === 'string' && linkId.trim().length > 0 ? linkId : createDeviceLinkId()
}

export function sanitizeLayoutLinks(
  links: unknown,
  devices: Array<Pick<DeviceInstance, 'instanceId' | 'typeId'>>,
): DeviceLink[] {
  if (!Array.isArray(links) || devices.length === 0) return []
  const deviceById = new Map(devices.map((device) => [device.instanceId, device]))
  const usedSourceIds = new Set<string>()
  const usedTargetIds = new Set<string>()
  const normalized: DeviceLink[] = []

  for (const entry of links) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<DeviceLink>
    const kind = candidate.kind === 'dark_pipe' ? 'dark_pipe' : null
    if (!kind) continue
    const sourceInstanceId = typeof candidate.sourceInstanceId === 'string' ? candidate.sourceInstanceId : null
    const targetInstanceId = typeof candidate.targetInstanceId === 'string' ? candidate.targetInstanceId : null
    if (!sourceInstanceId || !targetInstanceId || sourceInstanceId === targetInstanceId) continue
    if (usedSourceIds.has(sourceInstanceId) || usedTargetIds.has(targetInstanceId)) continue

    const source = deviceById.get(sourceInstanceId)
    const target = deviceById.get(targetInstanceId)
    if (!source || !target) continue
    if (!isDarkPipeLinkPair(source.typeId, target.typeId)) continue

    usedSourceIds.add(sourceInstanceId)
    usedTargetIds.add(targetInstanceId)
    normalized.push({
      linkId: sanitizeLinkId(candidate.linkId),
      kind,
      sourceInstanceId,
      targetInstanceId,
    })
  }

  return normalized
}

export function pruneLayoutLinks(layout: LayoutState): LayoutState {
  const links = sanitizeLayoutLinks(layout.links, layout.devices)
  if (links === layout.links) return layout
  return { ...layout, links }
}

export function removeLinksForDeviceIds(layout: LayoutState, instanceIds: Iterable<string>): LayoutState {
  const blockedIds = new Set(instanceIds)
  if (blockedIds.size === 0) return layout
  return {
    ...layout,
    links: layout.links.filter(
      (link) => !blockedIds.has(link.sourceInstanceId) && !blockedIds.has(link.targetInstanceId),
    ),
  }
}

export function upsertDarkPipeLink(layout: LayoutState, sourceInstanceId: string, targetInstanceId: string): LayoutState {
  if (sourceInstanceId === targetInstanceId) return layout
  const deviceById = new Map(layout.devices.map((device) => [device.instanceId, device]))
  const source = deviceById.get(sourceInstanceId)
  const target = deviceById.get(targetInstanceId)
  if (!source || !target || !isDarkPipeLinkPair(source.typeId, target.typeId)) return layout

  return {
    ...layout,
    links: [
      ...layout.links.filter(
        (link) =>
          link.sourceInstanceId !== sourceInstanceId &&
          link.targetInstanceId !== targetInstanceId &&
          link.sourceInstanceId !== targetInstanceId &&
          link.targetInstanceId !== sourceInstanceId,
      ),
      {
        linkId: createDeviceLinkId(),
        kind: 'dark_pipe',
        sourceInstanceId,
        targetInstanceId,
      },
    ],
  }
}

export function removeDeviceLink(layout: LayoutState, linkId: string): LayoutState {
  return {
    ...layout,
    links: layout.links.filter((link) => link.linkId !== linkId),
  }
}

export function sanitizeBlueprintLinks(
  links: unknown,
  devices: Array<{ blueprintInstanceId: string; typeId: DeviceTypeId }>,
): BlueprintDeviceLink[] {
  if (!Array.isArray(links) || devices.length === 0) return []
  const deviceById = new Map(devices.map((device) => [device.blueprintInstanceId, device]))
  const usedSourceIds = new Set<string>()
  const usedTargetIds = new Set<string>()
  const normalized: BlueprintDeviceLink[] = []

  for (const entry of links) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<BlueprintDeviceLink>
    const kind = candidate.kind === 'dark_pipe' ? 'dark_pipe' : null
    if (!kind) continue
    const sourceBlueprintInstanceId =
      typeof candidate.sourceBlueprintInstanceId === 'string' ? candidate.sourceBlueprintInstanceId : null
    const targetBlueprintInstanceId =
      typeof candidate.targetBlueprintInstanceId === 'string' ? candidate.targetBlueprintInstanceId : null
    if (!sourceBlueprintInstanceId || !targetBlueprintInstanceId || sourceBlueprintInstanceId === targetBlueprintInstanceId) continue
    if (usedSourceIds.has(sourceBlueprintInstanceId) || usedTargetIds.has(targetBlueprintInstanceId)) continue

    const source = deviceById.get(sourceBlueprintInstanceId)
    const target = deviceById.get(targetBlueprintInstanceId)
    if (!source || !target || !isDarkPipeLinkPair(source.typeId, target.typeId)) continue

    usedSourceIds.add(sourceBlueprintInstanceId)
    usedTargetIds.add(targetBlueprintInstanceId)
    normalized.push({ kind, sourceBlueprintInstanceId, targetBlueprintInstanceId })
  }

  return normalized
}