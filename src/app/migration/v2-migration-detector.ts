import {
  normalizeLegacyV2BlueprintSnapshotsStorage,
  normalizeLegacyV2LayoutsByBaseStorage,
  readFromLocalStorage,
} from "@/shared/storage";

import {
  V2_LAYOUTS_BY_BASE_LOCAL_STORAGE_KEY,
  V2_LEGACY_USER_BLUEPRINTS_LOCAL_STORAGE_KEY,
  V2_USER_BLUEPRINTS_LOCAL_STORAGE_KEY,
} from "./v2-migration-keys";
import { hasV2ModuleBalancingData } from "./v2-module-balancing-migration";

export interface V2MigrationDetection {
  readonly hasData: boolean;
  readonly mapCount: number;
  readonly blueprintCount: number;
  readonly hasModuleBalancingData: boolean;
}

export function detectV2MigrationData(): V2MigrationDetection {
  const layouts = normalizeLegacyV2LayoutsByBaseStorage(
    readFromLocalStorage<unknown>(V2_LAYOUTS_BY_BASE_LOCAL_STORAGE_KEY),
  );
  const userBlueprints = normalizeLegacyV2BlueprintSnapshotsStorage(
    readFromLocalStorage<unknown>(V2_USER_BLUEPRINTS_LOCAL_STORAGE_KEY),
  );
  const legacyUserBlueprints = userBlueprints.length > 0
    ? []
    : normalizeLegacyV2BlueprintSnapshotsStorage(
      readFromLocalStorage<unknown>(V2_LEGACY_USER_BLUEPRINTS_LOCAL_STORAGE_KEY),
    );
  const hasModuleBalancing = hasV2ModuleBalancingData();
  const mapCount = Object.keys(layouts).length;
  const blueprintCount = userBlueprints.length + legacyUserBlueprints.length;

  return {
    hasData: mapCount > 0 || blueprintCount > 0 || hasModuleBalancing,
    mapCount,
    blueprintCount,
    hasModuleBalancingData: hasModuleBalancing,
  };
}
