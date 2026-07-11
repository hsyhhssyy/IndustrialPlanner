export const WATER_PURIFIER_NODE_ENTITY_ID = "item_water_purifier_node_1";

export const WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS = [
  "input_buffer_1",
  "input_buffer_2",
  "input_buffer_3",
] as const;

export const WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID = "sewage_buffer";
export const WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID = "xiranite_waste_buffer";
export const WATER_PURIFIER_OUTPUT_SLOT_ID = "slot_1";
export const WATER_PURIFIER_OUTPUT_ITEM_ID = "item_liquid_xiranite_poly";

export const WATER_PURIFIER_INTAKE_CHANNEL_IDS = [
  "intake_1",
  "intake_2",
  "intake_3",
] as const;
export const WATER_PURIFIER_BYPRODUCT_CHANNEL_ID = "byproduct";

export const WATER_PURIFIER_COLLECT_RECIPE_ID = "r_water_purifier_node_collect_sewage_basic";
export const WATER_PURIFIER_BYPRODUCT_RECIPE_ID =
  "r_water_purifier_node_xiranite_waste_from_sewage_basic";

export const WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY = "waterPurifierOutputMode";
export const WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY = "waterPurifierManualOutputPerMinute";

export type WaterPurifierOutputMode = "input-derived" | "manual-rate";

export const WATER_PURIFIER_DEFAULT_OUTPUT_MODE: WaterPurifierOutputMode = "input-derived";
export const WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE = 0;

export const BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY = "blockageAutoClearanceEnabled";
