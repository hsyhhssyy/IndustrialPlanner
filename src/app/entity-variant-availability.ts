import type { AppHost } from "@/app/host/app-host";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  isEntityDefinitionVariantSwitchable,
  resolveEntityVariantDefinitions,
  resolveNextEntityVariantDefinitionId,
} from "@/shared/entity-variants";

const UNPLACEABLE_TAG = "不可摆放";

export const SWITCH_DEVICE_MODE_BUTTON_ID =
  "canvas-floating-toolbar-button-switch-mode";

export function resolveSwitchableEntityVariantDefinitions(options: {
  readonly appHost: AppHost;
  readonly definitionId: string;
}): readonly EntityDefinition[] {
  return resolveEntityVariantDefinitions({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.appHost),
  });
}

export function resolveNextSwitchableEntityVariantDefinitionId(options: {
  readonly appHost: AppHost;
  readonly definitionId: string;
}): string | null {
  return resolveNextEntityVariantDefinitionId({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.appHost),
  });
}

export function canSwitchEntityVariantDefinition(options: {
  readonly appHost: AppHost;
  readonly definitionId: string;
}): boolean {
  return isEntityDefinitionVariantSwitchable({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.appHost),
  });
}

function resolveCurrentBaseSwitchableDefinitions(
  appHost: AppHost,
): readonly EntityDefinition[] {
  return appHost.workspace.registry.entityDefinitions.filter((definition) =>
    !definition.tags.includes(UNPLACEABLE_TAG)
    && canPlaceEntityDefinitionInCurrentBase(appHost, definition),
  );
}
