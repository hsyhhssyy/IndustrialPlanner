import type {
  GridEdge,
  GridPoint,
  GridRotation,
} from "./grid";

export type LogisticsKind = "belt" | "pipe";

export type LogisticsRouteOrder = "vertical-first" | "horizontal-first";

export type LogisticsPortKind = "item" | "fluid";

export type LogisticsPortDirection = "input" | "output";

export type LogisticsPathShape = "straight" | "turn-cw" | "turn-ccw";

export interface LogisticsPathCell {
  readonly gridPoint: GridPoint;
  readonly fromEdge: GridEdge | null;
  readonly toEdge: GridEdge | null;
  readonly shape: LogisticsPathShape;
  readonly rotation: GridRotation;
}

export type LogisticsDraftInvalidReason =
  | "overlap-existing-logistics"
  | "overlap-own-preview"
  | "target-route-crosses-target-device"
  | "empty-endpoint-disallowed"
  | "empty-path"
  | "missing-port"
  | "outside-base"
  | "unknown";

export type LogisticsDraftEndpoint =
  | {
      readonly type: "device-port";
      readonly entityId: string;
      readonly portGroupId: string;
      readonly portId: string;
      readonly portKind: LogisticsPortKind;
      readonly portDirection: LogisticsPortDirection;
      readonly insideGridPoint: GridPoint;
      readonly outsideGridPoint: GridPoint;
      readonly edge: GridEdge;
      /** 从端口外侧格起笔时固定该端口；普通设备格起笔仍可动态选择最近端口。 */
      readonly fixedSource?: true;
    }
  | {
      readonly type: "logistics-entity";
      readonly entityId: string;
      readonly gridPoint: GridPoint;
    }
  | {
      readonly type: "empty-cell";
      readonly gridPoint: GridPoint;
    };

export interface LogisticsDraftReadonlyState {
  readonly kind: LogisticsKind;
  readonly source: LogisticsDraftEndpoint | null;
  readonly target: LogisticsDraftEndpoint | null;
  readonly routeOrder: LogisticsRouteOrder;
  readonly cells: readonly LogisticsPathCell[];
  readonly headDraftEntityId: string | null;
  readonly replacingEntityId: string | null;
  readonly canApply: boolean;
  readonly invalidReason: LogisticsDraftInvalidReason | null;
}

export interface CreateLogisticsDraftStartOptions {
  readonly kind: LogisticsKind;
  readonly allowEmptySource?: boolean;
  readonly source:
    | {
        readonly type: "device";
        readonly entityId: string;
        readonly pointerGridPoint: GridPoint;
      }
    | {
        /** 从端口外侧的空地或普通物流格起笔，并固定到指定输出端口。 */
        readonly type: "fixed-device-port";
        readonly entityId: string;
        readonly portGroupId: string;
        readonly portId: string;
        readonly outsideGridPoint: GridPoint;
      }
    | {
        readonly type: "logistics-entity";
        readonly entityId: string;
        readonly gridPoint: GridPoint;
      }
    | {
        readonly type: "empty-cell";
        readonly gridPoint: GridPoint;
      };
  readonly routeOrder?: LogisticsRouteOrder;
}

export interface MoveLogisticsDraftEndOptions {
  readonly pointerGridPoint: GridPoint;
  readonly allowEmptyTarget?: boolean;
  readonly autoCreateSplittersAndConvergers?: boolean;
  readonly routeMode:
    | {
        readonly type: "freehand";
      }
    | {
        readonly type: "single-bend";
        readonly routeOrder: LogisticsRouteOrder;
        readonly allowTemporaryOrderFlip: boolean;
      };
}

export interface LogisticsDraftActionResult {
  readonly status: "created" | "updated" | "ignored";
  readonly canApply: boolean;
  readonly invalidReason: LogisticsDraftInvalidReason | null;
  readonly headGridPoint: GridPoint | null;
  readonly headDraftEntityId: string | null;
  readonly sourceEntityId: string | null;
  readonly targetEntityId: string | null;
}
