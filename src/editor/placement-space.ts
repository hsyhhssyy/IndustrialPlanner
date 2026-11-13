import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { SceneSpace } from "@/domain/shared/scene-space";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import { resolveEntityPlacementAreas } from "@/shared/entity-placement-whitelist";
import type { EditorServices } from "./editor-services";

const EMPTY_SPACE: SceneSpace = Object.freeze({ areas: Object.freeze([]) });

export function resolveEditorSceneSpace(services: EditorServices, document: WorldDocument): SceneSpace {
  return services.placement?.space
    ?? services.registry.baseDefinitions.find((base) => base.id === document.baseId)
    ?? EMPTY_SPACE;
}

/** 资格由会话决定，所有消费者再共用同一空间几何算法。 */
export function resolveEditorPlacementGeometry(services: EditorServices, document: WorldDocument, entity: WorldEntity) {
  const space = resolveEditorSceneSpace(services, document);
  if (services.placement !== undefined) {
    return { space, allowedAreaIds: services.placement.resolvePlacementAreaIds(entity, space) };
  }
  const definition = services.registry.entityDefinitions.find((definition) => definition.id === entity.definitionId);
  return {
    space,
    allowedAreaIds: definition === undefined ? [] : resolveEntityPlacementAreas(
      definition, { id: document.baseId }, resolveBaseAreas(space),
    ).map((area) => area.id),
  };
}
