/** 跨基地关系的端点身份；实体 ID 仅在对应基地内唯一。 */
export interface RegionalDarkPipeEndpoint {
  readonly baseId: string;
  readonly entityId: string;
}

/** 从出口世界文档的 slotLinks 派生，不独立持久化。 */
export interface RegionalDarkPipeLink {
  readonly id: string;
  readonly inlet: RegionalDarkPipeEndpoint;
  readonly outlet: RegionalDarkPipeEndpoint;
}
