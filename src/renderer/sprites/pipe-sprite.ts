import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RenderHost } from "@/renderer/renderer-host"

import { DedicatedLogisticSprite } from "./dedicated-logistic-sprite"

export class PipeSprite extends DedicatedLogisticSprite {
  public constructor(
    entityId: string,
    definition: EntityDefinition,
    renderHost: RenderHost,
  ) {
    super(entityId, definition, renderHost)
  }
}