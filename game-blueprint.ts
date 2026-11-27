import type { BlueprintDocument } from "./src/domain/document/blueprint-document";
import { createRegistryContract } from "./src/registry";
import { convertGameBlueprint as convertWithRegistry } from "./src/shared/game-blueprint";

const registry = createRegistryContract();

export function convertGameBlueprint(input: unknown, options?: { baseId?: string }): BlueprintDocument {
  return convertWithRegistry(input, registry, options);
}
