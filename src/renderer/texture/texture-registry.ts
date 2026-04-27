import type { EntityDefinition } from "@/domain/types/registry/entity-definition"

import type { CustomTextureKey } from "./create-custom-texture"

export type RenderTextureKey = string

export type RenderTextureProvider =
  | {
    kind: "bitmap";
    assetPath: string;
    fallbackKey?: RenderTextureKey;
  }
  | {
    kind: "custom";
    customTextureKey: CustomTextureKey;
  }

const GENERIC_DEVICE_SPRITE_ASSET_IDS = [
  "item_log_connector",
  "item_log_converger",
  "item_log_splitter",
  "item_pipe_connector",
  "item_pipe_converger",
  "item_pipe_splitter",
  "item_port_filling_pd_mc_1",
  "item_port_grinder_1",
  "item_port_log_hongs_bus",
  "item_port_log_hongs_bus_source",
  "item_port_mix_pool_1",
  "item_port_storager_1",
  "item_port_udpipe_loader_1",
  "item_port_udpipe_unloader_1",
  "item_port_unloader_1",
] as const

const GENERIC_DEVICE_SPRITE_ALIASES: Record<string, string> = {
  item_port_liquid_filling_pd_mc_1: "item_port_filling_pd_mc_1",
}

const RENDER_TEXTURE_PROVIDERS = createRenderTextureProviderRegistry()

export function resolveRenderTextureProvider(
  key: RenderTextureKey,
): RenderTextureProvider | null {
  return RENDER_TEXTURE_PROVIDERS.get(key) ?? null
}

export function resolveGenericDeviceSpriteTextureKeys(
  spriteId: EntityDefinition["spriteId"],
): {
  body: RenderTextureKey;
  previewMask: RenderTextureKey;
} | null {
  const assetId = GENERIC_DEVICE_SPRITE_ALIASES[spriteId] ?? spriteId

  if (!GENERIC_DEVICE_SPRITE_ASSET_IDS.includes(assetId as typeof GENERIC_DEVICE_SPRITE_ASSET_IDS[number])) {
    return null
  }

  return {
    body: createGenericDeviceBodyTextureKey(assetId),
    previewMask: createGenericDevicePreviewMaskTextureKey(assetId),
  }
}

function createRenderTextureProviderRegistry(): ReadonlyMap<RenderTextureKey, RenderTextureProvider> {
  const registry = new Map<RenderTextureKey, RenderTextureProvider>()

  for (const assetId of GENERIC_DEVICE_SPRITE_ASSET_IDS) {
    const bodyKey = createGenericDeviceBodyTextureKey(assetId)

    registry.set(bodyKey, {
      kind: "bitmap",
      assetPath: `/sprites/${assetId}.webp`,
    })
    registry.set(createGenericDevicePreviewMaskTextureKey(assetId), {
      kind: "bitmap",
      assetPath: `/sprite-masks/${assetId}.webp`,
      fallbackKey: bodyKey,
    })
  }

  return registry
}

function createGenericDeviceBodyTextureKey(assetId: string): RenderTextureKey {
  return `generic-device/body/${assetId}`
}

function createGenericDevicePreviewMaskTextureKey(assetId: string): RenderTextureKey {
  return `generic-device/preview-mask/${assetId}`
}