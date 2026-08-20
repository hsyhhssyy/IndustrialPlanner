import type { WorldEntity } from "@/domain/document/world-document";

export interface ConfiguredItemIconEntityCache {
  resolve(options: {
    documentSnapshot: unknown;
    entities: readonly WorldEntity[];
    previewEntities: readonly WorldEntity[];
    /** 由调用方统一判断哪些设备需要显示已配置物品，缓存不持有业务 ID。 */
    isConfiguredItemIconDefinition: (definitionId: string) => boolean;
  }): readonly WorldEntity[];
}

/**
 * 准入口图标实体缓存。
 *
 * 准入口图标与正式 document 和 preview 草稿都有关：移动时草稿位置变化，
 * 取消时草稿会消失，两者都不会修改正式 document。
 * AI-CORRECTION 2026-08-20: 缓存现同时服务准入口与仓库取货口，统一按“已配置物品图标”语义筛选实体。
 */
export function createConfiguredItemIconEntityCache(): ConfiguredItemIconEntityCache {
  let cachedDocumentSnapshot: unknown = null;
  let cachedPreviewEntities: readonly WorldEntity[] = [];
  let cachedConfiguredItemIconEntities: readonly WorldEntity[] = [];

  return {
    resolve(options): readonly WorldEntity[] {
      if (
        cachedDocumentSnapshot === options.documentSnapshot
        && haveSameEntityReferences(cachedPreviewEntities, options.previewEntities)
      ) {
        return cachedConfiguredItemIconEntities;
      }

      cachedDocumentSnapshot = options.documentSnapshot;
      cachedPreviewEntities = [...options.previewEntities];
      cachedConfiguredItemIconEntities = options.entities.filter((entity) =>
        options.isConfiguredItemIconDefinition(entity.definitionId),
      );

      return cachedConfiguredItemIconEntities;
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
