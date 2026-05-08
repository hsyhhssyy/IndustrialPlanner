import { createContext, useContext } from "react";

import type {
  EntityDefinition,
} from "@/domain/registry/types/entity-definition";
import type { AppLocale } from "@/shared/i18n/messages";
import type {
  SlotLinkDefinition,
  WorldEntity,
} from "@/domain/document/world-document";

/** inspector 渲染时所在的宿主容器 */
export type InspectorRenderMode = "dock" | "dialog";

/** 当前 inspector 子树的渲染宿主 */
export const InspectorRenderModeContext = createContext<InspectorRenderMode>("dock");

/** 在任何深度的子 inspector 中读取当前渲染宿主 */
export function useInspectorRenderMode(): InspectorRenderMode {
  return useContext(InspectorRenderModeContext);
}

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
  mode: InspectorRenderMode;
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
