export interface EntityDefinition {
  id: string;
  // i18n 设备名称
  nameKey: string;
  spriteId: string;
  footprint: {
    width: number;
    height: number;
  };
  tags: string[];
  // 是否耗电, 存储箱有powerDemand但是requiresPower为false
  // powerDemand表示只要他在电网里，就需要扣除的值。但是如果requiresPower为false，那么他可以在电网外运行，只不过放到电网里的时候耗电罢了。
  requiresPower: boolean;
  powerDemand: number;
  //端口与组
  portGroups: PortGroupDefinition[];
  storageSlotGroups: StorageSlotGroupDefinition[];
  portStorageBindings: PortStorageBindingDefinition[];
}

export interface ItemFilterDefinition {
  itemFilter: "type" | "tag-whitelist" | "whitelist" | "blacklist";
  itemFilterIds?: string[];
  itemFilterType?: "solid" | "liquid" | "any";
  itemFilterTag?: string[];
}

interface PortGroupDefinition {
  id: string;
  kind: "item" | "fluid";
  direction: "input" | "output" | "bidirectional";
  ports: PortDefinition[];
}

interface StorageSlotGroupDefinition {
  id: string;
  kind: "item" | "fluid";
  role: "input" | "output" | "bidirectional";
  slots: StorageSlotDefinition[];
}

interface StorageSlotDefinition extends ItemFilterDefinition {
  id: string;
  capacity: number;
}

interface PortStorageBindingDefinition {
  id: string;
  portGroupId: string;
  storageSlotGroupId: string;
}

interface PortDefinition {
  id: string;
  localCellX: number;
  localCellY: number;
  // 是相对于Entity处于 Rotation = 0 时的方向
  edge: "SOUTH" | "WEST" | "NORTH" | "EAST";

}