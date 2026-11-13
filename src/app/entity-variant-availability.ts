import type { CanvasInteractionController } from "./canvas";
// AI-REMOVED 2026-11-12:
// Reason: 统一场景迁移后旧对象没有有效调用。
// Trigger: REQ-048 P6 与 ESLint unused 审计。
// Evidence: 当前调用由 Canvas 或 SceneViewInput 提供，原引用仅存于审计注释。
// Replacement: CanvasActionImpl / SceneViewInput / 通用只读场景
// Risk: Low
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";
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
  readonly canvas: CanvasInteractionController;
  readonly definitionId: string;
}): readonly EntityDefinition[] {
  return resolveEntityVariantDefinitions({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.canvas),
  });
}

export function resolveNextSwitchableEntityVariantDefinitionId(options: {
  readonly canvas: CanvasInteractionController;
  readonly definitionId: string;
}): string | null {
  return resolveNextEntityVariantDefinitionId({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.canvas),
  });
}

export function canSwitchEntityVariantDefinition(options: {
  readonly canvas: CanvasInteractionController;
  readonly definitionId: string;
}): boolean {
  return isEntityDefinitionVariantSwitchable({
    definitionId: options.definitionId,
    definitions: resolveCurrentBaseSwitchableDefinitions(options.canvas),
  });
}

function resolveCurrentBaseSwitchableDefinitions(
  canvas: CanvasInteractionController,
): readonly EntityDefinition[] {
  return canvas.registry.entityDefinitions.filter((definition) =>
    !definition.tags.includes(UNPLACEABLE_TAG)
    && canPlaceEntityDefinitionInCurrentBase(canvas, definition),
  );
}
