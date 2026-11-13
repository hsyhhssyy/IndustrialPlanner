export const CANVAS_OPERATION_IDS = [
  "exit", "move", "save-blueprint", "copy", "delete", "pan-viewport", "zoom-viewport",
  "switch-device-variant", "rotate-placement", "confirm-placement", "continuous-placement",
  "delete-device", "cancel-placement", "confirm-logistics-start", "confirm-logistics-end",
  "change-belt-route-priority", "change-pipe-route-priority", "toggle-marquee-selection",
  "marquee-select", "marquee-deselect", "exit-marquee",
  "select", "paste", "cut", "undo", "redo", "quick-place", "blueprint-placement",
  "logistics-placement", "region-edit", "configure-device", "open-inspector", "rotate-viewport", "session-intent",
] as const;

export type CanvasOperationId = typeof CANVAS_OPERATION_IDS[number];

export interface CanvasOperationAvailability {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly reason: string | null;
}
