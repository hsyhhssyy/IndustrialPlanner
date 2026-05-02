import type {
  GridPoint,
  GridRotation,
} from "@/domain/types/grid";

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
  documentKey: string;
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

export const DEFAULT_WORLD_BASE_ID = "wuling_protocol_core";

export const createWorldDocument = (): WorldDocument => {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    documentKey: createUuid(),
    baseId: DEFAULT_WORLD_BASE_ID,
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

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
