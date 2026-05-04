import type { EntityDefinition } from "@/domain/types/registry/entity-definition"
import type { RenderHost } from "@/renderer/renderer-host"

import { GenericDeviceSprite } from "./generic-device-sprite"

export class BeltSprite extends GenericDeviceSprite {
  public constructor(
    entityId: string,
    definition: EntityDefinition,
    renderHost: RenderHost,
  ) {
    super(entityId, definition, renderHost)
  }
}