export const PRIMARY_PROTOCOL_CORE_DEFINITION_ID = "sp_hub_1";
export const SECONDARY_PROTOCOL_CORE_DEFINITION_ID = "sp_sub_hub_1";

const PROTOCOL_CORE_DEFINITION_IDS: ReadonlySet<string> = new Set([
  PRIMARY_PROTOCOL_CORE_DEFINITION_ID,
  SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
]);

const PROTOCOL_CORE_DEFINITION_ID_BY_BASE_ID: Readonly<Record<string, string>> = {
  wuling_protocol_core: PRIMARY_PROTOCOL_CORE_DEFINITION_ID,
  wuling_tianwangping_aid: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  wuling_heart_repair_station: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  stm_hongs_3: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  valley4_protocol_core: PRIMARY_PROTOCOL_CORE_DEFINITION_ID,
  valley4_refugee_shelter: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  valley4_infra_outpost: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  valley4_rebuilt_command: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
};

export function isProtocolCoreDefinitionId(definitionId: string): boolean {
  return PROTOCOL_CORE_DEFINITION_IDS.has(definitionId);
}

export function resolveProtocolCoreDefinitionIdForBase(baseId: string): string {
  return PROTOCOL_CORE_DEFINITION_ID_BY_BASE_ID[baseId]
    ?? PRIMARY_PROTOCOL_CORE_DEFINITION_ID;
}
