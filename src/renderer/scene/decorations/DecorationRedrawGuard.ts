type DrawingInput = string | number | boolean | null | undefined;

/** 比较实际绘制输入；不把仿真 tick 当成静态图形失效条件。 */
export function createDecorationRedrawGuard(): (inputs: readonly DrawingInput[]) => boolean {
  let previous: readonly DrawingInput[] | null = null;
  return (inputs) => {
    if (previous !== null && previous.length === inputs.length
      && inputs.every((value, index) => Object.is(value, previous![index]))) {
      return false;
    }
    // 保存值快照，避免区域草稿、视口等可变对象原地更新后漏掉重绘。
    previous = inputs.slice();
    return true;
  };
}

/** 活跃层继续逐帧更新；进入无内容状态时保留一次清理，随后跳过重复空清理。 */
export function createDecorationActivityGuard(): (active: boolean) => boolean {
  let inactive = false;
  return (active) => {
    const sync = active || !inactive;
    inactive = !active;
    return sync;
  };
}
