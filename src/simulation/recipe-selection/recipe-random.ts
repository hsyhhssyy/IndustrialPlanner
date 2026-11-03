/** 一次逻辑仿真共享的随机源，独立于 checkpoint；每次实际选择只调用一次。 */
export interface RecipeRandomSource {
  next(): number;
}

/** 固定非零种子的 xorshift32；新运行才创建，重算与拓扑迁移复用原实例。 */
export class RecipeRandom implements RecipeRandomSource {
  private state = 0x6d2b79f5;

  public next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return (this.state - 1) / 0xffffffff;
  }
}
