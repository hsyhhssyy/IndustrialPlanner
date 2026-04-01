export interface SessionAction {
  type: "session.select" | "session.hover" | "session.tool.set";
  payload: Record<string, unknown>;
}
