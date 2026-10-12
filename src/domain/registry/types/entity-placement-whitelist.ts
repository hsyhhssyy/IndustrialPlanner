/** 设备允许出现的地图及其区域；未指定区域时包含主区域与所有子区域。 */
export interface EntityPlacementWhitelistEntry {
  readonly baseId: string;
  readonly areaIds?: readonly string[];
}
