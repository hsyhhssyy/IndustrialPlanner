import { createTranslator, type AppLocale } from "@/i18n/messages";
import type { ConfigMutability } from "@/domain/contracts/config-mutability";
import type {
  ConfigField,
  EntityDefinition,
  ItemDefinition,
  RecipeDefinition,
} from "@/domain/registry/registry";

const STAGE1_REGISTRY_TRANSLATIONS: Record<AppLocale, Record<string, string>> = {
  "zh-CN": {
    "registry.entity.item_port_storager_1.name": "协议存储箱",
    "registry.entity.item_port_log_hongs_bus.name": "仓库存取线基段",
    "registry.entity.item_port_log_hongs_bus_source.name": "仓库存取线源桩",
    "registry.entity.item_port_unloader_1.name": "取货口",
    "registry.entity.item_port_mix_pool_1.name": "反应池",
    "registry.entity.item_port_grinder_1.name": "粉碎机",
    "registry.entity.item_port_liquid_filling_pd_mc_1.name": "流体灌装机",
    "registry.entity.belt_straight_1x1.name": "传送带",
    "registry.entity.item_log_splitter.name": "传送带分流器",
    "registry.entity.item_log_converger.name": "传送带汇流器",
    "registry.entity.item_log_connector.name": "传送带桥接器",
    "registry.entity.pipe_straight_1x1.name": "管道",
    "registry.entity.item_pipe_splitter.name": "管道分流器",
    "registry.entity.item_pipe_converger.name": "管道汇流器",
    "registry.entity.item_pipe_connector.name": "管道桥接器",
    "registry.entity.item_port_udpipe_loader_1.name": "暗管入口",
    "registry.entity.item_port_udpipe_unloader_1.name": "暗管出口",
    "registry.config.submitToWarehouse.label": "提交至仓库",
    "registry.config.pickupIgnoreInventory.label": "忽略来源库存",
    "registry.config.selectedRecipeIds.label": "已选配方",
    "registry.config.outputRoutes.label": "输出路由",
    "registry.config.targetEntityId.label": "链接出口",
    "registry.config.selectedLiquidItemId.label": "选定液体",
  },
  "en-US": {},
};

function getStage1RegistryTranslation(
  locale: AppLocale,
  messageKey: string,
  fallback: string,
): string {
  return STAGE1_REGISTRY_TRANSLATIONS[locale][messageKey] ?? fallback;
}

export function getLocalizedStage1EntityName(
  locale: AppLocale,
  definition: EntityDefinition,
): string {
  return getStage1RegistryTranslation(locale, definition.nameKey, definition.name);
}

export function getLocalizedStage1ConfigFieldLabel(
  locale: AppLocale,
  field: ConfigField,
): string {
  return getStage1RegistryTranslation(locale, field.labelKey, field.label);
}

export function getLocalizedStage1ItemName(
  locale: AppLocale,
  definition: ItemDefinition,
): string {
  return getStage1RegistryTranslation(locale, definition.nameKey, definition.name);
}

export function getLocalizedStage1RecipeName(
  locale: AppLocale,
  definition: RecipeDefinition,
): string {
  return getStage1RegistryTranslation(locale, definition.nameKey, definition.name);
}

export function getLocalizedMutabilityLabel(
  locale: AppLocale,
  mutability: ConfigMutability,
): string {
  const t = createTranslator(locale);

  return t(`mutability.${mutability}`);
}
