import type {
  GridPoint,
  GridRotation,
} from "@/domain/types/grid";

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

  documentSettings: {
    // 需要添加zoom
    // 需要添加viewportRect
  };
}

export const DEFAULT_WORLD_BASE_ID = "wuling_protocol_core";

export const createWorldDocument = (): WorldDocument => {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    documentKey: createUuid(),
    baseId: DEFAULT_WORLD_BASE_ID,
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
    },
  };
};

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
