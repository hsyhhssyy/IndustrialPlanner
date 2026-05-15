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
