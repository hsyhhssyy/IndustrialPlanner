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
