import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { GestureEvent, KeyboardSnapshot } from "@/app/input/gesture/adapter";
import type { ShortcutKeyId } from "@/app/actions";
import type { ActiveTool } from "@/domain/app";

export interface GestureActionContext<THost = unknown> {
  readonly workspace: WorkspaceContract;
  readonly appHost: THost;
  readonly keyboard: KeyboardSnapshot;
}

export type GestureHandleResult =
  | {
      readonly status: "ignored";
    }
  | {
      readonly status: "handled";
      readonly consume?: boolean;
    }
  | {
      readonly status: "claimed";
      readonly consume?: boolean;
    };

export type ShortcutInputLayer =
  | "canvas"
  | "quick-place"
  | "overlap-entity-menu"
  | "dialog"
  | "inspector-dialog"
  | "editable";

export interface ShortcutScope {
  readonly inputLayers: readonly ShortcutInputLayer[];
  readonly activeTools: readonly ActiveTool[];
}

export type ShortcutModifier = "alt" | "ctrl" | "meta" | "shift";

export type ShortcutTriggerPolicy =
  | { readonly kind: "exact" }
  | { readonly kind: "allow-any-additional-modifiers" }
  | {
      readonly kind: "allow-additional-modifiers";
      readonly modifiers: readonly ShortcutModifier[];
    };

export type ShortcutRouteBinding =
  | {
      readonly kind: "configurable";
      readonly shortcutId: ShortcutKeyId;
    }
  | {
      readonly kind: "fixed";
      readonly value: string;
    };

export type KeyboardGestureEvent = Extract<GestureEvent, { readonly type: "key down" | "key up" }>;

export interface ShortcutActionRoute<THost = unknown> {
  readonly id: string;
  readonly actionId: string;
  readonly binding: ShortcutRouteBinding;
  readonly scope: ShortcutScope;
  readonly triggerPolicy: ShortcutTriggerPolicy;
  readonly events?: readonly KeyboardGestureEvent["type"][];
  readonly claimsBrowserDefault?: boolean;
  readonly composableWithActionIds?: readonly string[];
  readonly handle: (
    event: KeyboardGestureEvent,
    context: GestureActionContext<THost>,
  ) => GestureHandleResult;
}

export interface ShortcutRouteConflict {
  readonly kind: "configurable" | "fixed";
  readonly actionId: string;
  readonly binding: string;
  readonly shortcutId?: ShortcutKeyId;
  readonly slotIndex?: 0 | 1;
  readonly targetRouteId: string;
  readonly conflictingRouteId: string;
  readonly overlappingInputLayers: readonly ShortcutInputLayer[];
  readonly overlappingActiveTools: readonly ActiveTool[];
}

export interface GestureMappingModule<THost = unknown> {
  readonly id: string;
  readonly priority?: number;
  readonly when?: (context: GestureActionContext<THost>) => boolean;
  readonly shortcutRoutes?: readonly ShortcutActionRoute<THost>[];
  readonly handle: (
    event: GestureEvent,
    context: GestureActionContext<THost>,
  ) => GestureHandleResult;
  readonly acceptsLongPress?: (
    context: GestureActionContext<THost>,
    gridHasEntity: boolean,
  ) => boolean;
}

export interface GestureActionRouterDispatchResult {
  readonly handledBy: readonly string[];
  readonly consumedBy: string | null;
  readonly claimedBy: string | null;
}
