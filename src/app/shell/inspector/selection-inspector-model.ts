import type {
  EntityDefinition,
} from "@/domain/types/registry/entity-definition";
import type { AppLocale } from "@/shared/i18n/messages";
import type {
  SlotLinkDefinition,
  WorldEntity,
} from "@/domain/entity/world-document";

export interface SelectionInspectorContext {
  selectedEntityId: string;
  selectedEntity: WorldEntity;
  selectedDefinition: EntityDefinition;
  selectedLinks: SlotLinkDefinition[];
}

export interface SelectionInspectorState {
  locale: AppLocale;
}

export interface SelectionInspectorPanelProps {
  state: SelectionInspectorState;
  context: SelectionInspectorContext | null;
}

export function formatConfigValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }

  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function serializeConfigValueForInput(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function parseConfigInputValue(
  rawValue: string,
  currentValue: unknown,
): unknown {
  if (Array.isArray(currentValue)) {
    return rawValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof currentValue === "number") {
    const nextValue = Number(rawValue);
    return Number.isFinite(nextValue) ? nextValue : currentValue;
  }

  if (typeof currentValue === "object" && currentValue !== null) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return currentValue;
    }
  }

  return rawValue;
}
