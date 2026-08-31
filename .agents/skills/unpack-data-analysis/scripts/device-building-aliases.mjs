export const RAW_BUILDING_ID_BY_PROJECT_ID = Object.freeze({
  cmpt_mc_1: "component_mc_1",
  filling_pd_mc_1: "filling_powder_mc_1",
  liquid_filling_pd_mc_1: "filling_powder_mc_1",
  power_sta_1: "power_station_1",
  seedcol_1: "seedcollector_1",
  tools_asm_mc_1: "tools_assebling_mc_1",
  water_pump_1: "pump_1",
});

export function resolveRawBuildingAlias(projectId) {
  return RAW_BUILDING_ID_BY_PROJECT_ID[projectId] ?? projectId;
}
