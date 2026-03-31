import type {
  ExplicitLink,
  GridPoint,
  GridRotation,
} from "@/domain/document/world-document";

export type ConfigMutability =
  | "document-only"
  | "runtime-mutable"
  | "recompile-required";

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

export type DocumentCommand =
  | PlaceEntityCommand
  | RemoveEntityCommand
  | MoveEntityCommand
  | RotateEntityCommand
  | PatchEntityConfigCommand
  | CreateLinkCommand
  | RemoveLinkCommand;

export interface SessionAction {
  type:
    | "session.select"
    | "session.hover"
    | "session.viewport.pan"
    | "session.viewport.zoom"
    | "session.tool.set";
  payload: Record<string, unknown>;
}

export interface RuntimeControl {
  type:
    | "runtime.start"
    | "runtime.pause"
    | "runtime.step"
    | "runtime.speed.set"
    | "runtime.patch"
    | "runtime.query.inspect";
  payload: Record<string, unknown>;
}
