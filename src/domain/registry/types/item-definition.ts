export interface ItemDefinition {
  id: string;
  nameKey: string;
  iconId: string;
  /** 流体视觉分层颜色；液体使用四层，气体只使用 body/skin。 */
  fluidColors?: {
    body: string;
    skin: string;
    skin2?: string;
    splash?: string;
  };
  /** 展示排序权重，数字越小越靠前 */
  displayOrder: number;
  tags: string[];
}
