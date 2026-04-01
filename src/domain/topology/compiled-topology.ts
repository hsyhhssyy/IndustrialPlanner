import type { ExplicitLink } from "@/domain/document/world-document";
import type {
  Stage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import type { GridPoint } from "@/shared/geometry/grid";

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

export interface CompiledExplicitLinkView {
  id: string;
  kind: ExplicitLink["kind"];
  sourceEntityId: string;
  targetEntityId: string;
}

export interface CompiledTopology {
  compileVersion: string;
  entityViews: Record<string, CompiledEntityView>;
  explicitLinkViews: CompiledExplicitLinkView[];
  occupancyIndex: Record<string, string[]>;
  graphSummary: {
    solidTransportNodes: number;
    liquidTransportNodes: number;
    warehouseBusNodes: number;
    explicitLinks: number;
  };
  diagnostics: TopologyDiagnostic[];
}
