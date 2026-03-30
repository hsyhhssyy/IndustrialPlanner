import type { GridPoint, WorldDocument } from "@/editor-core/document/world-document";
import type {
  Stage1EntityDefinition,
  Stage1Registry,
} from "@/industrial-domain/registry/stage1-registry";

export interface TopologyDiagnostic {
  id: string;
  severity: "info" | "warning" | "error";
  entityIds: string[];
  message: string;
}

export interface CompiledEntityView {
  entityId: string;
  definition: Stage1EntityDefinition;
  position: GridPoint;
}

export interface CompiledTopology {
  compileVersion: string;
  entityViews: Record<string, CompiledEntityView>;
  occupancyIndex: Record<string, string[]>;
  graphSummary: {
    solidTransportNodes: number;
    liquidTransportNodes: number;
    warehouseBusNodes: number;
    explicitLinks: number;
  };
  diagnostics: TopologyDiagnostic[];
}

export interface CompilerInput {
  document: WorldDocument;
  registry: Stage1Registry;
}
