import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type { GridRotation } from "@/shared/geometry/grid";
import type { WorkbenchPhase } from "@/workbench/workbench-ui-state";

export type DisplayTool =
  | "select"
  | "place"
  | "belt"
  | "pipe"
  | "link"
  | "inspect";

export type PlacementDisplayTool = Extract<
  DisplayTool,
  "place" | "belt" | "pipe"
>;

export type InteractionModeKey =
  | "select"
  | "placement"
  | "link"
  | "inspect"
  | "move"
  | "marquee";

interface BaseInteractionModeState<TKey extends InteractionModeKey> {
  key: TKey;
  previousModeKey: InteractionModeKey | null;
  entryDisplayTool: DisplayTool | null;
}

export type SelectInteractionModeState = BaseInteractionModeState<"select">;

export interface PlacementInteractionModeState
  extends BaseInteractionModeState<"placement"> {
  definitionId: string;
  inputMode: PlacementInteractionMode;
  rotation: GridRotation;
}

export interface LinkInteractionModeState
  extends BaseInteractionModeState<"link"> {
  sourceEntityId: string | null;
}

export type InspectInteractionModeState = BaseInteractionModeState<"inspect">;

export interface MoveInteractionModeState
  extends BaseInteractionModeState<"move"> {
  entityId: string;
  inputMode: PlacementInteractionMode;
  anchorWorldOffset: {
    x: number;
    y: number;
  };
}

export interface MarqueeInteractionModeState
  extends BaseInteractionModeState<"marquee"> {
  inputMode: PlacementInteractionMode;
  selectionMode: EditorSelectionUpdateMode;
}

export type CurrentInteractionMode =
  | SelectInteractionModeState
  | PlacementInteractionModeState
  | LinkInteractionModeState
  | InspectInteractionModeState
  | MoveInteractionModeState
  | MarqueeInteractionModeState;

export interface InteractionModeDefinition<TKey extends InteractionModeKey> {
  key: TKey;
  availableInEdit: boolean;
  availableInSim: boolean;
  hidden: boolean;
  resolveDisplayTool: (
    mode: Extract<CurrentInteractionMode, { key: TKey }>,
  ) => DisplayTool;
  resolveDefaultNextMode: (
    mode: Extract<CurrentInteractionMode, { key: TKey }>,
  ) => CurrentInteractionMode;
}

type InteractionModeDefinitionMap = {
  [TKey in InteractionModeKey]: InteractionModeDefinition<TKey>;
};

interface InteractionModeTransitionContext {
  previousModeKey?: InteractionModeKey | null;
  entryDisplayTool?: DisplayTool | null;
}

export function isPlacementDisplayTool(
  tool: DisplayTool | null | undefined,
): tool is PlacementDisplayTool {
  return tool === "place" || tool === "belt" || tool === "pipe";
}

export function createSelectInteractionMode(
  context: InteractionModeTransitionContext = {},
): SelectInteractionModeState {
  return {
    key: "select",
    previousModeKey: context.previousModeKey ?? null,
    entryDisplayTool: context.entryDisplayTool ?? null,
  };
}

export function createPlacementInteractionMode(options: {
  definitionId: string;
  displayTool?: PlacementDisplayTool;
  inputMode?: PlacementInteractionMode;
  rotation?: GridRotation;
  previousModeKey?: InteractionModeKey | null;
  entryDisplayTool?: DisplayTool | null;
}): PlacementInteractionModeState {
  const resolvedDisplayTool = options.displayTool ?? "place";

  return {
    key: "placement",
    definitionId: options.definitionId,
    inputMode: options.inputMode ?? "pointer",
    rotation: options.rotation ?? 0,
    previousModeKey: options.previousModeKey ?? null,
    entryDisplayTool: options.entryDisplayTool ?? resolvedDisplayTool,
  };
}

export function createLinkInteractionMode(
  options: InteractionModeTransitionContext & {
    sourceEntityId?: string | null;
  } = {},
): LinkInteractionModeState {
  return {
    key: "link",
    sourceEntityId: options.sourceEntityId ?? null,
    previousModeKey: options.previousModeKey ?? null,
    entryDisplayTool: options.entryDisplayTool ?? null,
  };
}

export function createInspectInteractionMode(
  context: InteractionModeTransitionContext = {},
): InspectInteractionModeState {
  return {
    key: "inspect",
    previousModeKey: context.previousModeKey ?? null,
    entryDisplayTool: context.entryDisplayTool ?? null,
  };
}

export function createMoveInteractionMode(options: {
  entityId: string;
  inputMode?: PlacementInteractionMode;
  anchorWorldOffset?: {
    x: number;
    y: number;
  };
  previousModeKey?: InteractionModeKey | null;
  entryDisplayTool?: DisplayTool | null;
}): MoveInteractionModeState {
  return {
    key: "move",
    entityId: options.entityId,
    inputMode: options.inputMode ?? "pointer",
    anchorWorldOffset: options.anchorWorldOffset
      ? {
          ...options.anchorWorldOffset,
        }
      : {
          x: 0,
          y: 0,
        },
    previousModeKey: options.previousModeKey ?? null,
    entryDisplayTool: options.entryDisplayTool ?? "select",
  };
}

export function createMarqueeInteractionMode(options: {
  inputMode?: PlacementInteractionMode;
  selectionMode?: EditorSelectionUpdateMode;
  previousModeKey?: InteractionModeKey | null;
  entryDisplayTool?: DisplayTool | null;
}): MarqueeInteractionModeState {
  return {
    key: "marquee",
    inputMode: options.inputMode ?? "pointer",
    selectionMode: options.selectionMode ?? "replace",
    previousModeKey: options.previousModeKey ?? null,
    entryDisplayTool: options.entryDisplayTool ?? "select",
  };
}

function createDefaultNextSelectMode(
  mode: CurrentInteractionMode,
): SelectInteractionModeState {
  return createSelectInteractionMode({
    previousModeKey: mode.key,
    entryDisplayTool: resolveDisplayToolForMode(mode),
  });
}

export const INTERACTION_MODE_DEFINITIONS: InteractionModeDefinitionMap = {
  select: {
    key: "select",
    availableInEdit: true,
    availableInSim: true,
    hidden: false,
    resolveDisplayTool: () => "select",
    resolveDefaultNextMode: (mode) => mode,
  },
  placement: {
    key: "placement",
    availableInEdit: true,
    availableInSim: false,
    hidden: false,
    resolveDisplayTool: (mode) =>
      isPlacementDisplayTool(mode.entryDisplayTool) ? mode.entryDisplayTool : "place",
    resolveDefaultNextMode: (mode) => createDefaultNextSelectMode(mode),
  },
  link: {
    key: "link",
    availableInEdit: true,
    availableInSim: false,
    hidden: false,
    resolveDisplayTool: () => "link",
    resolveDefaultNextMode: (mode) => createDefaultNextSelectMode(mode),
  },
  inspect: {
    key: "inspect",
    availableInEdit: true,
    availableInSim: false,
    hidden: false,
    resolveDisplayTool: () => "inspect",
    resolveDefaultNextMode: (mode) => createDefaultNextSelectMode(mode),
  },
  move: {
    key: "move",
    availableInEdit: true,
    availableInSim: false,
    hidden: true,
    resolveDisplayTool: () => "select",
    resolveDefaultNextMode: (mode) => createDefaultNextSelectMode(mode),
  },
  marquee: {
    key: "marquee",
    availableInEdit: true,
    availableInSim: false,
    hidden: true,
    resolveDisplayTool: () => "select",
    resolveDefaultNextMode: (mode) => createDefaultNextSelectMode(mode),
  },
};

export function getInteractionModeDefinition<TKey extends InteractionModeKey>(
  key: TKey,
): InteractionModeDefinition<TKey> {
  return INTERACTION_MODE_DEFINITIONS[key];
}

export function resolveDisplayToolForMode(
  mode: CurrentInteractionMode,
): DisplayTool {
  const definition = getInteractionModeDefinition(mode.key);

  return definition.resolveDisplayTool(mode as never);
}

export function resolveDefaultNextInteractionMode(
  mode: CurrentInteractionMode,
): CurrentInteractionMode {
  const definition = getInteractionModeDefinition(mode.key);

  return definition.resolveDefaultNextMode(mode as never);
}

export function isInteractionModeAvailableInPhase(
  mode: CurrentInteractionMode,
  phase: WorkbenchPhase,
): boolean {
  const definition = getInteractionModeDefinition(mode.key);

  return phase === "edit"
    ? definition.availableInEdit
    : definition.availableInSim;
}

export function isPlacementInteractionMode(
  mode: CurrentInteractionMode,
): mode is PlacementInteractionModeState {
  return mode.key === "placement";
}

export function isLinkInteractionMode(
  mode: CurrentInteractionMode,
): mode is LinkInteractionModeState {
  return mode.key === "link";
}

export function isMoveInteractionMode(
  mode: CurrentInteractionMode,
): mode is MoveInteractionModeState {
  return mode.key === "move";
}

export function isMarqueeInteractionMode(
  mode: CurrentInteractionMode,
): mode is MarqueeInteractionModeState {
  return mode.key === "marquee";
}

export function getPendingLinkSourceEntityId(
  mode: CurrentInteractionMode,
): string | null {
  return isLinkInteractionMode(mode) ? mode.sourceEntityId : null;
}

export function cloneCurrentInteractionMode(
  mode: CurrentInteractionMode,
): CurrentInteractionMode {
  if (mode.key === "move") {
    return {
      ...mode,
      anchorWorldOffset: {
        ...mode.anchorWorldOffset,
      },
    };
  }

  return {
    ...mode,
  };
}

export function isSameCurrentInteractionMode(
  left: CurrentInteractionMode,
  right: CurrentInteractionMode,
): boolean {
  if (left === right) {
    return true;
  }

  if (
    left.key !== right.key ||
    left.previousModeKey !== right.previousModeKey ||
    left.entryDisplayTool !== right.entryDisplayTool
  ) {
    return false;
  }

  switch (left.key) {
    case "placement":
      return (
        right.key === "placement" &&
        left.definitionId === right.definitionId &&
        left.inputMode === right.inputMode &&
        left.rotation === right.rotation
      );
    case "link":
      return right.key === "link" && left.sourceEntityId === right.sourceEntityId;
    case "move":
      return (
        right.key === "move" &&
        left.entityId === right.entityId &&
        left.inputMode === right.inputMode &&
        left.anchorWorldOffset.x === right.anchorWorldOffset.x &&
        left.anchorWorldOffset.y === right.anchorWorldOffset.y
      );
    case "marquee":
      return (
        right.key === "marquee" &&
        left.inputMode === right.inputMode &&
        left.selectionMode === right.selectionMode
      );
    case "inspect":
      return right.key === "inspect";
    case "select":
      return right.key === "select";
  }
}
