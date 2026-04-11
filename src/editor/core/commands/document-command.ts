import type {
  ExplicitLink,
} from "@/domain/document/world-document";
import type {
  GridPoint,
  GridRotation,
} from "@/shared/geometry/grid";

export interface PlaceEntityCommand {
  type: "entity.place";
  payload: {
    entityId: string;
    definitionId: string;
    position: GridPoint;
    rotation: GridRotation;
    config: Record<string, unknown>;
    tags: string[];
  };
}

export interface RemoveEntityCommand {
  type: "entity.remove";
  payload: {
    entityId: string;
  };
}

export interface MoveEntityCommand {
  type: "entity.move";
  payload: {
    entityId: string;
    position: GridPoint;
  };
}

export interface RotateEntityCommand {
  type: "entity.rotate";
  payload: {
    entityId: string;
    rotation: GridRotation;
    position?: GridPoint;
  };
}

export interface PatchEntityConfigCommand {
  type: "entity.config.patch";
  payload: {
    entityId: string;
    patch: Record<string, unknown>;
  };
}

export interface CreateLinkCommand {
  type: "link.create";
  payload: {
    linkId: string;
    kind: ExplicitLink["kind"];
    sourceEntityId: string;
    targetEntityId: string;
  };
}

export interface RemoveLinkCommand {
  type: "link.remove";
  payload: {
    linkId: string;
  };
}

export type AtomicDocumentCommand =
  | PlaceEntityCommand
  | RemoveEntityCommand
  | MoveEntityCommand
  | RotateEntityCommand
  | PatchEntityConfigCommand
  | CreateLinkCommand
  | RemoveLinkCommand;

export interface BatchDocumentCommand {
  type: "batch";
  payload: {
    commands: AtomicDocumentCommand[];
  };
}

/**
 * Mutations that produce a new WorldDocument snapshot and participate in
 * undo/redo.
 */
export type DocumentCommand = AtomicDocumentCommand | BatchDocumentCommand;
