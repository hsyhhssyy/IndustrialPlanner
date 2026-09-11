import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

import {
  getGridBoundingBox,
  getRotatedGridFootprint,
  type GridArea,
  type GridBounds,
} from "./grid";

export interface EntityGridGeometryEntry {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly gridArea: GridArea;
}

export interface ResolvedEntityGridGeometry {
  readonly entries: readonly EntityGridGeometryEntry[];
  readonly boundingBox: GridBounds;
}

export function resolveEntityGridGeometry(options: {
  entities: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): ResolvedEntityGridGeometry | null {
  const entries = options.entities.flatMap((entity): EntityGridGeometryEntry[] => {
    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return [];
    }

    return [{
      entity,
      definition,
      gridArea: {
        position: entity.position,
        footprint: getRotatedGridFootprint(definition.footprint, entity.rotation),
      },
    }];
  });
  const boundingBox = getGridBoundingBox(entries.map(({ gridArea }) => gridArea));

  return boundingBox === null
    ? null
    : {
      entries,
      boundingBox,
    };
}
