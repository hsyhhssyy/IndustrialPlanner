export interface WikiDefaultCraftDefinition {
  readonly itemId: string;
  readonly sourceCraftId: string;
  readonly recipeId: string;
}

/** AKEData 1.5.3@9885010-4 TableCfg/WikiDefaultCraftTable.json 的无损规范化映射。 */
export const WIKI_DEFAULT_CRAFT_DEFINITIONS: readonly WikiDefaultCraftDefinition[] = [
  {
    itemId: "item_gas_copper",
    sourceCraftId: "liquid_transmuter_2_gas_gas_copper_1",
    recipeId: "liquid_transmuter_2_gas_gas_copper_1",
  },
  {
    itemId: "item_gas_copper_enr",
    sourceCraftId: "liquid_purifier_gas_copper_enr_2",
    recipeId: "liquid_purifier_gas_copper_enr_2",
  },
  {
    itemId: "item_liquid_acid",
    sourceCraftId: "item_liquid_acid_pump_2",
    recipeId: "r_pump_acid_basic",
  },
  {
    itemId: "item_xiranite_powder",
    sourceCraftId: "xiranite_oven_xiranite_powder_2",
    recipeId: "xiranite_oven_xiranite_powder_2",
  },
  {
    itemId: "item_gas_inert",
    sourceCraftId: "item_gas_inert_gas_pump_1",
    recipeId: "r_gas_collector_inert_basic",
  },
  {
    itemId: "item_gas_xiranite_enr",
    sourceCraftId: "liquid_purifier_gas_xiranite_enr_2",
    recipeId: "liquid_purifier_gas_xiranite_enr_2",
  },
  {
    itemId: "item_gas_xiranite",
    sourceCraftId: "item_gas_xiranite_gas_pump_1",
    recipeId: "r_gas_collector_xiranite_basic",
  },
  {
    itemId: "item_liquid_water",
    sourceCraftId: "item_liquid_water_pump_1",
    recipeId: "r_pump_water_basic",
  },
  {
    itemId: "item_xiranite_enr_powder",
    sourceCraftId: "liquid_transmuter_2_solid_xiranite_enr_powder_1",
    recipeId: "liquid_transmuter_2_solid_xiranite_enr_powder_1",
  },
];
