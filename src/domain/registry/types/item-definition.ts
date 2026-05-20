export interface ItemDefinition {
  id: string;
  nameKey: string;
  iconId: string;
  /** 展示排序权重，数字越小越靠前 */
  displayOrder: number;
  tags: string[];
}
