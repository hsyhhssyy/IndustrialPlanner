import type { ItemDefinition } from "@/domain/registry/types/item-definition";

export const FALLBACK_FLUID_COLOR = "#808080";

export type FluidColorRole = keyof NonNullable<ItemDefinition["fluidColors"]>;

/** 所有单色流体表现统一使用 body；缺少档案或对应分层时回退中性灰。 */
export function resolveFluidColor(
  colors: ItemDefinition["fluidColors"] | null | undefined,
  role: FluidColorRole = "body",
): string {
  return colors?.[role] ?? FALLBACK_FLUID_COLOR;
}

export function fluidColorToNumber(color: string): number {
  return Number.parseInt(color.slice(1), 16);
}
