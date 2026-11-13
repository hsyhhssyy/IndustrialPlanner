/** 半开空间边界；null 表示对应方向无界。 */
export interface SceneBounds {
  readonly minX: number | null;
  readonly maxX: number | null;
  readonly minY: number | null;
  readonly maxY: number | null;
}

export interface SceneOuterRing {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface SceneAreaDefinition {
  readonly id: string;
  /** 配置名牌文字时显示；未配置时不显示名牌。 */
  readonly nameplate?: string;
  readonly bounds: SceneBounds;
  readonly outerRing: SceneOuterRing;
}

/** 空数组表示无可放区域；完全无界必须显式给出一个四边为 null 的区域。 */
export interface SceneSpace {
  readonly areas: readonly SceneAreaDefinition[];
}
