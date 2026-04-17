import type {
  GridPoint,
  GridRotation,
} from "@/shared/geometry/grid";

export interface WorldEntity {
  id: string;
  definitionId: string;
  position: GridPoint;
  rotation: GridRotation;
  config: Record<string, unknown>;
  tags: string[];
}

export interface ExplicitLink {
  id: string;
  kind: "dark-pipe";
  sourceEntityId: string;
  targetEntityId: string;
}

export interface WorldDocument {
  schemaVersion: number;
  baseId: string;
  meta: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  entities: Record<string, WorldEntity>;
  entityOrder: string[];
  explicitLinks: ExplicitLink[];
  documentSettings: {
    gridSize: number;
    showDiagnostics: boolean;
  };
}


const INITIAL_WORLD_DOCUMENT: WorldDocument = {
  schemaVersion: 1,
  baseId: "default-world",
  meta: {
    id: "default-world",
    name: "Untitled World",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  entities: {},
  entityOrder: [],
  explicitLinks: [],
  documentSettings: {
    gridSize: 1,
    showDiagnostics: false,
  },
};

export const createWorldDocument = (): WorldDocument => {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    baseId: `world-${timestamp}`,
    meta: {
      id: `world-${timestamp}`,
      name: "Untitled World",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    entities: {},
    entityOrder: [],
    explicitLinks: [],
    documentSettings: {
      gridSize: 1,
      showDiagnostics: false,
    },
  };
};