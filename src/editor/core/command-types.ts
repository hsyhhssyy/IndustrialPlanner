export type ConfigMutability =
  | "document-only"
  | "runtime-mutable"
  | "recompile-required";

export interface DocumentCommand {
  type:
    | "entity.place"
    | "entity.remove"
    | "entity.move"
    | "entity.rotate"
    | "entity.config.patch"
    | "link.create"
    | "link.remove";
  payload: Record<string, unknown>;
}

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
