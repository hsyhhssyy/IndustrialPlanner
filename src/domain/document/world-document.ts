import type {
  GridFloatPoint,
  GridPoint,
  GridRotation,
} from "../shared/grid";
import { createUuid } from "../shared/uuid";

export interface WorldEntity {
  id: string;
  definitionId: string;
  position: GridPoint;
  rotation: GridRotation;
  config: Record<string, unknown>;
  tags: string[];
}


// ---------------------------------------------------------------------------
// 缓存链接（对应《仿真运行原理》§3.3）。
// Link 是有向代理，source 端点自身不保存真实库存。
// 订正（2026-05-05）：`share-cap` 仅共享容量，不代理 source 的真实库存。
// ---------------------------------------------------------------------------
export type LinkType = "share-all" | "share-cap";

export interface SlotLinkDefinition {
  readonly id: string;
  readonly linkType: LinkType;
  readonly source: CacheLinkEndpointDefinition;
  readonly target: CacheLinkEndpointDefinition;
}

export interface CacheLinkEndpointDefinition {
  /** 该槽位对应的设备的ID **/
  readonly entityId: string;
  /** 端点绑定的存储槽组 ID */
  readonly storageSlotGroupId: string;
  /** 精确到具体槽位 ID */
  readonly slotId: string;
}

export interface WorldDocumentViewportSettings {
  readonly center: GridFloatPoint;
  readonly gridSize: number;
}

export interface WorldDocumentSettings {
  // 需要添加zoom
  // 订正（2026-05-10）：缩放已以 `viewport.gridSize` 的形式进入文档设置。
  // 需要添加viewportRect
  // 订正（2026-05-10）：本轮只持久化 viewport center 与 gridSize；clientRect 仍归属 DOM runtime。
  readonly viewport: WorldDocumentViewportSettings;
  readonly [key: string]: unknown;
}

export interface WorldDocument {
  schemaVersion: number;
  documentKey: string;
  baseId: string;
  meta: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  entities: Record<string, WorldEntity>;
  entityOrder: string[];
  slotLinks: SlotLinkDefinition[];
  documentSettings: WorldDocumentSettings;
}

export const DEFAULT_WORLD_BASE_ID = "wuling_protocol_core";

export const createWorldDocument = (options: {
  baseId?: string;
} = {}): WorldDocument => {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    documentKey: createUuid(),
    baseId: options.baseId ?? DEFAULT_WORLD_BASE_ID,
    meta: {
      id: `world-${timestamp}`,
      name: "Untitled World",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    entities: {},
    entityOrder: [],
    slotLinks: [],
    documentSettings: {
      viewport: {
        center: {
          x: 0,
          y: 0,
        },
        gridSize: 1,
      },
    },
  };
};
