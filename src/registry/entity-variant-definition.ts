import type { EntityVariantDefinition } from "@/domain/registry/types/entity-variant-definition";

const NORMAL_SHORT_NAME_KEY = "registry.entityVariant.normal.shortName";
const NORMAL_LONG_NAME_KEY = "registry.entityVariant.normal.longName";
const SOLID_SHORT_NAME_KEY = "registry.entityVariant.solid.shortName";
const SOLID_LONG_NAME_KEY = "registry.entityVariant.solid.longName";
const LIQUID_SHORT_NAME_KEY = "registry.entityVariant.liquid.shortName";
const LIQUID_LONG_NAME_KEY = "registry.entityVariant.liquid.longName";
const GAS_SHORT_NAME_KEY = "registry.entityVariant.gas.shortName";
const GAS_LONG_NAME_KEY = "registry.entityVariant.gas.longName";

export const ENTITY_VARIANT_DEFINITIONS: Readonly<Record<string, EntityVariantDefinition>> = {
  normal: {
    variantName: "normal",
    shortNameKey: NORMAL_SHORT_NAME_KEY,
    longNameKey: NORMAL_LONG_NAME_KEY,
    iconPath: "assets/machine-mode-icons/icon_port_normal.png",
  },
  gas: {
    variantName: "gas",
    shortNameKey: GAS_SHORT_NAME_KEY,
    longNameKey: GAS_LONG_NAME_KEY,
    iconPath: "assets/machine-mode-icons/icon_port_gas.png",
  },
  gastrans: {
    variantName: "gastrans",
    shortNameKey: GAS_SHORT_NAME_KEY,
    longNameKey: GAS_LONG_NAME_KEY,
    iconPath: "assets/machine-mode-icons/icon_port_gastrans.png",
  },
  liquid: {
    variantName: "liquid",
    shortNameKey: LIQUID_SHORT_NAME_KEY,
    longNameKey: LIQUID_LONG_NAME_KEY,
    iconPath: "assets/machine-mode-icons/icon_port_liquid.png",
  },
  liquidtrans: {
    variantName: "liquidtrans",
    shortNameKey: LIQUID_SHORT_NAME_KEY,
    longNameKey: LIQUID_LONG_NAME_KEY,
    iconPath: "assets/machine-mode-icons/icon_port_liquidtrans.png",
  },
  solidtrans: {
    variantName: "solidtrans",
    shortNameKey: SOLID_SHORT_NAME_KEY,
    longNameKey: SOLID_LONG_NAME_KEY,
    iconPath: "assets/machine-mode-icons/icon_port_solidtrans.png",
  },
};
