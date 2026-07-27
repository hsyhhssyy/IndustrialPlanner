import type { WorldEntity } from "@/domain/document/world-document";

export interface AdmissionItemIconEntityCache {
  resolve(options: {
    documentSnapshot: unknown;
    entities: readonly WorldEntity[];
    previewEntities: readonly WorldEntity[];
    /** 由 RegistryQuery.resolveLogisticsRole 提供，避免缓存持有 definition ID。 */
    isAdmissionDefinition: (definitionId: string) => boolean;
  }): readonly WorldEntity[];
}

/**
 * 准入口图标实体缓存。
 *
 * 准入口图标与正式 document 和 preview 草稿都有关：移动时草稿位置变化，
 * 取消时草稿会消失，两者都不会修改正式 document。
 */
export function createAdmissionItemIconEntityCache(): AdmissionItemIconEntityCache {
  let cachedDocumentSnapshot: unknown = null;
  let cachedPreviewEntities: readonly WorldEntity[] = [];
  let cachedAdmissionEntities: readonly WorldEntity[] = [];

  return {
    resolve(options): readonly WorldEntity[] {
      if (
        cachedDocumentSnapshot === options.documentSnapshot
        && haveSameEntityReferences(cachedPreviewEntities, options.previewEntities)
      ) {
        return cachedAdmissionEntities;
      }

      cachedDocumentSnapshot = options.documentSnapshot;
      cachedPreviewEntities = [...options.previewEntities];
      cachedAdmissionEntities = options.entities.filter((entity) =>
        options.isAdmissionDefinition(entity.definitionId),
      );

      return cachedAdmissionEntities;
    },
  };
}

function haveSameEntityReferences(
  left: readonly WorldEntity[],
  right: readonly WorldEntity[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entity, index) => entity === right[index]);
}
