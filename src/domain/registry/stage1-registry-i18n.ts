import type { AppLocale } from "@/i18n/messages";
import type { ConfigMutability } from "@/domain/document/config-mutability";
import type {
  Stage1ConfigField,
  Stage1EntityDefinition,
} from "@/domain/registry/stage1-registry";

const ENTITY_NAME_MAP: Record<AppLocale, Record<string, string>> = {
  "zh-CN": {
    item_port_storager_1: "协议存储箱",
    item_port_log_hongs_bus: "仓库存取线基段",
    item_port_log_hongs_bus_source: "仓库存取线源桩",
    item_port_unloader_1: "取货口",
    item_port_mix_pool_1: "反应池",
    item_port_grinder_1: "粉碎机",
    item_port_liquid_filling_pd_mc_1: "流体灌装机",
    belt_straight_1x1: "传送带",
    item_log_splitter: "传送带分流器",
    item_log_converger: "传送带汇流器",
    item_log_connector: "传送带桥接器",
    pipe_straight_1x1: "管道",
    item_pipe_splitter: "管道分流器",
    item_pipe_converger: "管道汇流器",
    item_pipe_connector: "管道桥接器",
    item_port_udpipe_loader_1: "暗管入口",
    item_port_udpipe_unloader_1: "暗管出口",
  },
  "en-US": {},
};

const CONFIG_FIELD_LABEL_MAP: Record<AppLocale, Record<string, string>> = {
  "zh-CN": {
    submitToWarehouse: "提交至仓库",
    pickupIgnoreInventory: "忽略来源库存",
    selectedRecipeIds: "已选配方",
    outputRoutes: "输出路由",
    targetEntityId: "链接出口",
    selectedLiquidItemId: "选定液体",
  },
  "en-US": {},
};

const MUTABILITY_LABEL_MAP: Record<AppLocale, Record<ConfigMutability, string>> = {
  "zh-CN": {
    "document-only": "仅文档态",
    "runtime-mutable": "运行态可改",
    "recompile-required": "需要重编译",
  },
  "en-US": {
    "document-only": "Document Only",
    "runtime-mutable": "Runtime Mutable",
    "recompile-required": "Recompile Required",
  },
};

export function getLocalizedStage1EntityName(
  locale: AppLocale,
  definition: Stage1EntityDefinition,
): string {
  return ENTITY_NAME_MAP[locale][definition.id] ?? definition.name;
}

export function getLocalizedStage1ConfigFieldLabel(
  locale: AppLocale,
  field: Stage1ConfigField,
): string {
  return CONFIG_FIELD_LABEL_MAP[locale][field.key] ?? field.label;
}

export function getLocalizedMutabilityLabel(
  locale: AppLocale,
  mutability: ConfigMutability,
): string {
  return MUTABILITY_LABEL_MAP[locale][mutability];
}
