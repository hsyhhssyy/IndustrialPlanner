/**
 * Minimal placeholder contract for future session-action objects.
 *
 * The current runtime path still uses typed methods on EditorHost and
 * EditorCore instead of a unified session-action object system.
 */
export interface SessionAction {
  type: "session.select" | "session.hover" | "session.tool.set";
  payload: Record<string, unknown>;
}
