export const INSPECTOR_TYPE = {
  genericDevice: "generic-device",
  runtimeStatistics: "runtime-statistics",
  storageManagement: "storage-management",
  storageTypeFilter: "storage-type-filter",
  portFilter: "port-filter",
  recipeConfig: "recipe-config",
  slotConfig: "slot-config",
  linkConfig: "link-config",
  routing: "routing",
  structure: "structure",
  behaviorToggle: "behavior-toggle",
  warehouseItemLink: "warehouse-item-link",
} as const;

export type EntityInspectorType =
  typeof INSPECTOR_TYPE[keyof typeof INSPECTOR_TYPE];

export interface EntityInspectorDeclaration {
  readonly type: EntityInspectorType;
  readonly targetPath?: string;
  readonly slotIndex?: number;
  readonly portRef?: string;
  readonly cacheLinkIndex?: number;
}
