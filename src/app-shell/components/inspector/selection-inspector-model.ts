import type {
  WorkbenchController,
} from "@/workbench/contracts/workbench-facade";
import type { WorkbenchPhase } from "@/workbench/workbench-ui-state";
import type {
  Stage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import type { AppLocale } from "@/i18n/messages";
import type {
  RuntimeEntityView,
  RuntimeInspectorDetails,
} from "@/simulation/protocol/runtime-protocol";
import type { SimulationPatchSet } from "@/simulation/protocol/simulation-patch";
import type {
  ExplicitLink,
  WorldEntity,
} from "@/domain/document/world-document";

export interface SelectionInspectorContext {
  selectedEntityId: string;
  selectedEntity: WorldEntity;
  selectedDefinition: Stage1EntityDefinition;
  selectedEntityRuntime: RuntimeEntityView | undefined;
  selectedLinks: ExplicitLink[];
}

export interface SelectionInspectorState {
  locale: AppLocale;
  phase: WorkbenchPhase;
  inspectorDetails: RuntimeInspectorDetails | null;
  simulationPatchSet: SimulationPatchSet;
}

export interface SelectionInspectorPanelProps {
  controller: WorkbenchController;
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
