import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type { GestureEvent, KeyboardSnapshot } from "@/app/input/gesture-adapter";

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

export interface GestureMappingModule<THost = unknown> {
  readonly id: string;
  readonly priority?: number;
  readonly when?: (context: GestureActionContext<THost>) => boolean;
  readonly handle: (
    event: GestureEvent,
    context: GestureActionContext<THost>,
  ) => GestureHandleResult;
}

export interface GestureActionRouterDispatchResult {
  readonly handledBy: readonly string[];
  readonly consumedBy: string | null;
  readonly claimedBy: string | null;
}
