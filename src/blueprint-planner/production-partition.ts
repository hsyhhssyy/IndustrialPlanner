import { buildLayoutGraph, type LayoutGraphEdge } from "./layout-graph";

export interface ProductionPartition {
  /** 每层完整覆盖全部节点；环内节点不可拆，共享上游只有一个归属。 */
  readonly levels: readonly (readonly (readonly number[])[])[];
}

/** 在 SCC 压缩图上求后支配树：模块是通往同一汇合点的完整上游子树。 */
export function buildProductionPartition(nodeIds: readonly string[], edges: readonly LayoutGraphEdge[], depth: number,
  productionNodeIds?: ReadonlySet<string>): ProductionPartition {
  if (!Number.isSafeInteger(depth) || depth < 0) throw new Error("生产分区层级无效。");
  const graph = buildLayoutGraph(nodeIds, edges), count = graph.groups.length;
  if (!count) return { levels: [[]] };
  const indices = new Map(nodeIds.map((id, index) => [id, index]));
  const downstream = graph.groups.map(() => new Set<number>());
  for (const edge of edges) {
    const from = graph.groupIndexByNodeId.get(edge.from)!, to = graph.groupIndexByNodeId.get(edge.to)!;
    if (from !== to) downstream[from]!.add(to);
  }
  if (productionNodeIds) {
    const core = graph.groups.flatMap((group, index) => group.nodeIds.some(id => productionNodeIds.has(id)) ? [index] : []);
    if (!core.length) return { levels: Array.from({ length: depth + 1 }, () => nodeIds.length ? [nodeIds.map((_, index) => index)] : []) };
    const coreSet = new Set(core), upstream = graph.groups.map(() => new Set<number>());
    downstream.forEach((targets, source) => targets.forEach(target => upstream[target]!.add(source)));
    const projected: LayoutGraphEdge[] = [];
    for (const source of core) {
      const pending = [...downstream[source]!], seen = new Set<number>();
      while (pending.length) {
        const target = pending.pop()!;
        if (seen.has(target)) continue;
        seen.add(target);
        if (coreSet.has(target)) projected.push({ from: String(source), to: String(target) });
        else pending.push(...downstream[target]!);
      }
    }
    const hierarchy = buildProductionPartition(core.map(String), projected, depth);
    // 辅助 SCC 按到生产组的图距离归属；逐层限定在原父模块内，既不复制也不跨层搬家。
    const affinity = graph.groups.map((_, source) => {
      const scores = new Map<number, number>();
      for (const [links, weight] of [[downstream, 2], [upstream, 1]] as const) {
        const queue = [{ node: source, distance: 0 }], seen = new Set([source]);
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const { node, distance } = queue[cursor]!;
          if (coreSet.has(node) && node !== source) { scores.set(node, (scores.get(node) ?? 0) + weight / distance); continue; }
          for (const next of links[node]!) if (!seen.has(next)) { seen.add(next); queue.push({ node: next, distance: distance + 1 }); }
        }
      }
      return scores;
    });
    let previous = new Int32Array(count);
    const levels = hierarchy.levels.map(level => {
      const owners = new Int32Array(count).fill(-1), groups: number[][] = level.map(() => []);
      const parents = level.map(module => previous[core[module[0]!]!]!);
      level.forEach((module, owner) => module.forEach(index => owners[core[index]!] = owner));
      for (let group = 0; group < count; group++) {
        if (owners[group] === -1) {
          let best = -1, bestScore = -1;
          for (const [owner, module] of level.entries()) {
            if (parents[owner] !== previous[group]) continue;
            const score = module.reduce((sum, index) => sum + (affinity[group]!.get(core[index]!) ?? 0), 0);
            if (score > bestScore) { bestScore = score; best = owner; }
          }
          if (best < 0) throw new Error("生产分区辅助节点丢失父模块。");
          owners[group] = best;
        }
        groups[owners[group]!]!.push(...graph.groups[group]!.nodeIds.map(id => indices.get(id)!));
      }
      previous = owners;
      return groups.map(group => group.sort((a, b) => a - b));
    });
    return { levels };
  }
  const sink = count, postdominators: Set<number>[] = Array.from({ length: count + 1 }, () => new Set<number>());
  postdominators[sink]!.add(sink);
  const order = graph.groups.map((_, index) => index).sort((a, b) => graph.groups[b]!.rank - graph.groups[a]!.rank || a - b);
  const children: number[][] = Array.from({ length: count + 1 }, () => []);
  for (const group of order) {
    const next = downstream[group]!.size ? [...downstream[group]!] : [sink];
    const common = [...postdominators[next[0]!]!].filter(candidate => next.every(target => postdominators[target]!.has(candidate)));
    // 压缩后无环；共同后支配点沿路径有序，离当前最近者的后支配集合最大。
    const parent = common.reduce((best, candidate) => postdominators[candidate]!.size > postdominators[best]!.size ? candidate : best, sink);
    children[parent]!.push(group);
    postdominators[group] = new Set([group, ...common]);
  }
  for (const group of children) group.sort((a, b) => a - b);
  const subtree = (root: number): number[] => {
    const result: number[] = [], stack = [root];
    while (stack.length) { const next = stack.pop()!; if (next !== sink) result.push(next); stack.push(...children[next]!); }
    return result;
  };
  // 每次穿过单链直至真实分叉。汇合设备及其下游链成为独立装配模块，支路按下一层继续细分。
  let frontier = [{ root: sink, groups: subtree(sink), terminal: false }];
  const levels: number[][][] = [];
  const capture = () => frontier.map(module => module.groups.flatMap(group => graph.groups[group]!.nodeIds.map(id => indices.get(id)!)).sort((a, b) => a - b));
  levels.push(capture());
  for (let level = 0; level < depth; level++) {
    frontier = frontier.flatMap(module => {
      if (module.terminal) return [module];
      let root = module.root;
      const assembly: number[] = [];
      while (children[root]!.length === 1) { if (root !== sink) assembly.push(root); root = children[root]![0]!; }
      if (children[root]!.length < 2) return [{ ...module, terminal: true }];
      if (root !== sink) assembly.push(root);
      return [...children[root]!.map(child => ({ root: child, groups: subtree(child), terminal: false })),
        ...(assembly.length ? [{ root, groups: assembly, terminal: true }] : [])];
    });
    levels.push(capture());
  }
  return { levels };
}

export interface ProductionRegion { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }

/** 按设备占地递归切分同一个外框。区域是搜索偏好，不新增面积或物理墙。 */
// AI-CORRECTION 2026-11-06：区域仅用于新模块初始化；保留设备和接口最小尺寸，无法切分则返回 null 并继续融合搜索。
export function productionPartitionRegions(groups: readonly (readonly number[])[], sizes: readonly { width: number; height: number }[],
  outline: { width: number; height: number }, transpose = false): ProductionRegion[] | null {
  if (!groups.length) return [];
  if (transpose) {
    const transposed = productionPartitionRegions(groups, sizes.map(size => ({ width: size.height, height: size.width })),
      { width: outline.height, height: outline.width });
    return transposed?.map(box => ({ x: box.y, y: box.x, width: box.height, height: box.width })) ?? null;
  }
  const weights = groups.map(g => g.reduce((sum, i) => sum + (sizes[i]!.width + 1) * (sizes[i]!.height + 1), 0));
  const total = weights.reduce((a, b) => a + b, 0), area = outline.width * outline.height;
  const minimum = groups.map((g, i) => ({ width: Math.max(...g.map(n => sizes[n]!.width)) + 2,
    height: Math.max(...g.map(n => sizes[n]!.height)) + 2, area: Math.ceil(weights[i]! * area / total * .65) }));
  const failed = new Set<string>(); let visited = 0;
  const bounds = (start: number, end: number) => ({ width: Math.max(...minimum.slice(start, end).map(m => m.width)),
    height: Math.max(...minimum.slice(start, end).map(m => m.height)), area: minimum.slice(start, end).reduce((sum, m) => sum + m.area, 0) });
  type Rect = { x: number; y: number; width: number; height: number };
  function place(start: number, end: number, width: number, height: number): Rect[] | null {
    const key = `${start}/${end}/${width}/${height}`; if (failed.has(key)) return null;
    const min = bounds(start, end); if (width < min.width || height < min.height || width * height < min.area) return null;
    if (end - start === 1) return [{ x: 0, y: 0, width, height }];
    if (++visited > 100000) return null;
    const sum = weights.slice(start, end).reduce((a, b) => a + b, 0), candidates = [];
    for (let cut = start + 1; cut < end; cut++) {
      const left = bounds(start, cut), right = bounds(cut, end), ratio = weights.slice(start, cut).reduce((a, b) => a + b, 0) / sum;
      for (const horizontal of [true, false]) {
        const span = horizontal ? width : height, cross = horizontal ? height : width;
        if (cross < Math.max(horizontal ? left.height : left.width, horizontal ? right.height : right.width)) continue;
        const a = Math.max(horizontal ? left.width : left.height, Math.ceil(left.area / cross)),
          b = span - Math.max(horizontal ? right.width : right.height, Math.ceil(right.area / cross));
        for (let split = a; split <= b; split++) candidates.push({ cut, horizontal, split,
          score: Math.abs(split / span - ratio) * 4 + Math.abs(ratio - .5)
            + Math.abs(Math.log(split / cross)) * .03 + Math.abs(Math.log((span - split) / cross)) * .03 });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const { cut, horizontal, split } of candidates) {
      const a = place(start, cut, horizontal ? split : width, horizontal ? height : split); if (!a) continue;
      const b = place(cut, end, horizontal ? width - split : width, horizontal ? height : height - split); if (!b) continue;
      return [...a, ...b.map(box => ({ ...box, x: box.x + (horizontal ? split : 0), y: box.y + (horizontal ? 0 : split) }))];
    }
    failed.add(key); return null;
  }
  const result = place(0, groups.length, outline.width, outline.height);
  return result;
}

// AI-REMOVED 2026-11-06:
// Reason: 面积比例切分会产生宽 3 格的模块，无法容纳 5 格设备。
// Trigger: 独立模块求解必须保留接口空间。
// Evidence: boundary-interface-probe 的两个模块始终几何失败。
// Replacement: 上方带最小尺寸及面积约束的有界切分搜索。
// Risk: 保守分区可能放弃可融合布局，调用者回退融合；Human Review: Required
// Original code:
// export function productionPartitionRegions(modules: readonly (readonly number[])[], sizes: readonly { width: number; height: number }[],
//   outline: { width: number; height: number }, transpose: boolean): ProductionRegion[] {
//   if (!modules.length) return [];
//   const regions: ProductionRegion[] = [];
//   const weights = modules.map(group => group.reduce((sum, index) => sum + (sizes[index]!.width + 1) * (sizes[index]!.height + 1), 0));
//   const pending = [{ start: 0, end: modules.length, box: { x: 0, y: 0, ...outline } }];
//   while (pending.length) {
//     const { start, end, box } = pending.pop()!;
//     if (end - start === 1) { regions[start] = box; continue; }
//     const total = weights.slice(start, end).reduce((sum, value) => sum + value, 0);
//     let cut = start + 1, first = weights[start]!;
//     while (cut < end - 1 && Math.abs(first + weights[cut]! - total / 2) < Math.abs(first - total / 2)) first += weights[cut++]!;
//     const horizontal = box.width === box.height ? !transpose : box.width > box.height;
//     const extent = horizontal ? box.width : box.height;
//     const split = extent > 1 ? Math.max(1, Math.min(extent - 1, Math.round(extent * first / total))) : extent / 2;
//     const a = horizontal ? { ...box, width: split } : { ...box, height: split };
//     const b = horizontal ? { ...box, x: box.x + split, width: box.width - split } : { ...box, y: box.y + split, height: box.height - split };
//     pending.push({ start, end: cut, box: a }, { start: cut, end, box: b });
//   }
//   return regions;
// }
