import type { RegionAnnotation } from "@/domain/document/region-annotation";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { RegionMoveFeedback } from "@/domain/editor/types/region-annotation-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import {
  resolveGridRectRegionRelation,
  type RegionGridRectRelation,
} from "@/shared/geometry/region-rects";

export function resolveEntityRegionRelation(options: {
  readonly entity: WorldEntity;
  readonly region: RegionAnnotation;
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): RegionGridRectRelation {
  const definition = options.entityDefinitionMap.get(options.entity.definitionId);
  if (definition === undefined) {
    return "outside";
  }

  const footprint = getRotatedGridFootprint(definition.footprint, options.entity.rotation);
  return resolveGridRectRegionRelation({
    x: options.entity.position.x,
    y: options.entity.position.y,
    width: footprint.width,
    height: footprint.height,
  }, options.region.rects);
}

export function createRegionMoveFeedback(options: {
  readonly phase: RegionMoveFeedback["phase"];
  readonly document: WorldDocument;
  readonly movedEntities: readonly WorldEntity[];
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): RegionMoveFeedback | null {
  const changes = options.document.regions.flatMap((region) => {
    let enteredCount = 0;
    let exitedCount = 0;
    let boundaryCount = 0;

    for (const movedEntity of options.movedEntities) {
      const originalEntity = options.document.entities[movedEntity.id];
      if (originalEntity === undefined) {
        continue;
      }

      const before = resolveEntityRegionRelation({
        entity: originalEntity,
        region,
        entityDefinitionMap: options.entityDefinitionMap,
      });
      const after = resolveEntityRegionRelation({
        entity: movedEntity,
        region,
        entityDefinitionMap: options.entityDefinitionMap,
      });

      if (before !== "contained" && after === "contained") {
        enteredCount += 1;
      }
      if (before === "contained" && after !== "contained") {
        exitedCount += 1;
      }
      if (after === "boundary") {
        boundaryCount += 1;
      }
    }

    return enteredCount === 0 && exitedCount === 0 && boundaryCount === 0
      ? []
      : [{ regionId: region.id, enteredCount, exitedCount, boundaryCount }];
  });

  return changes.length === 0 ? null : { phase: options.phase, changes };
}
