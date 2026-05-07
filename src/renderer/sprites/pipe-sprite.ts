import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RenderHost } from "@/renderer/renderer-host"

import { GenericDeviceSprite } from "./generic-device-sprite"

export class PipeSprite extends GenericDeviceSprite {
  public constructor(
    entityId: string,
    definition: EntityDefinition,
    renderHost: RenderHost,
  ) {
    super(entityId, definition, renderHost)
  }
}