import type { RegistryContract } from "@/domain/registry/registry-contract";
import { BlueprintExecutionClient } from "./blueprint";
import { createDenseBlueprintEngine } from "./dense";

/** 升级前工作台尚未装配，验收使用独立客户端，不启动用户仿真。 */
export function createMigrationVerification(registry: RegistryContract): BlueprintExecutionClient {
  return new BlueprintExecutionClient(registry, "dense-v2", "auto", options => createDenseBlueprintEngine(registry, options), 2);
}
