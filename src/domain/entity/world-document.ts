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

function toIdPrefix(definitionId: string): string {
  return definitionId
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function createWorldEntityId(
  document: WorldDocument,
  definitionId: string,
): string {
  const prefix = toIdPrefix(definitionId);
  let index = 1;

  while (document.entities[`${prefix}-${index}`]) {
    index += 1;
  }

  return `${prefix}-${index}`;
}

export function createExplicitLinkId(
  document: WorldDocument,
  kind: ExplicitLink["kind"],
): string {
  const prefix = `${kind}-link`;
  let index = 1;

  while (document.explicitLinks.some((link) => link.id === `${prefix}-${index}`)) {
    index += 1;
  }

  return `${prefix}-${index}`;
}

export function getEntityLinks(
  document: WorldDocument,
  entityId: string,
): ExplicitLink[] {
  return document.explicitLinks.filter(
    (link) =>
      link.sourceEntityId === entityId || link.targetEntityId === entityId,
  );
}

export function getExplicitLinkBetween(
  document: WorldDocument,
  sourceEntityId: string,
  targetEntityId: string,
): ExplicitLink | null {
  return (
    document.explicitLinks.find(
      (link) =>
        link.sourceEntityId === sourceEntityId &&
        link.targetEntityId === targetEntityId,
      ) ?? null
  );
}
