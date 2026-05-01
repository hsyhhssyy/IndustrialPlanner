export const ENTITY_INSPECTOR_KEY = {
  genericDevice: "generic-device",
  runtimeStatistics: "runtime-statistics",
  storageManagement: "storage-management",
  storageTypeFilter: "storage-type-filter",
} as const;

export type EntityInspectorKey =
  typeof ENTITY_INSPECTOR_KEY[keyof typeof ENTITY_INSPECTOR_KEY];

export const DEFAULT_ENTITY_INSPECTORS: EntityInspectorKey[] = [
  ENTITY_INSPECTOR_KEY.genericDevice,
  ENTITY_INSPECTOR_KEY.runtimeStatistics,
  ENTITY_INSPECTOR_KEY.storageManagement,
  ENTITY_INSPECTOR_KEY.storageTypeFilter,
];
