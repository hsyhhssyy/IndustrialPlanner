/** Sequence Pair 的两个拓扑次序决定左右/上下关系，最长路压紧后矩形不会重叠。 */
export function compactSequencePair(blocks: readonly { width: number; height: number }[],
  positive: readonly number[], negative: readonly number[], clearance: number): Array<{ x: number; y: number }> {
  if (positive.length !== blocks.length || negative.length !== blocks.length || new Set(positive).size !== blocks.length
    || new Set(negative).size !== blocks.length || [...positive, ...negative].some(index => !Number.isInteger(index) || index < 0 || index >= blocks.length)
    || !Number.isInteger(clearance) || clearance < 0) throw new Error("Sequence Pair 次序或间距不合法。");
  const negativePosition = new Map(negative.map((index, position) => [index, position]));
  const result = blocks.map(() => ({ x: 0, y: 0 }));
  for (let position = 0; position < positive.length; position++) {
    const index = positive[position]!;
    for (let preceding = 0; preceding < position; preceding++) {
      const previous = positive[preceding]!;
      if (negativePosition.get(previous)! < negativePosition.get(index)!) {
        result[index]!.x = Math.max(result[index]!.x, result[previous]!.x + blocks[previous]!.width + clearance);
      } else result[index]!.y = Math.max(result[index]!.y, result[previous]!.y + blocks[previous]!.height + clearance);
    }
  }
  return result;
}
