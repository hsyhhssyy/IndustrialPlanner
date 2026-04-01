import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import type {
  Stage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import type { RuntimeEntityView } from "@/simulation/protocol/runtime-protocol";
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

export interface SelectionInspectorPanelProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
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
