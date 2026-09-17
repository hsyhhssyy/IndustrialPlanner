/** 布局使用的有向依赖；回流边与普通供料边使用同一表示。 */
export interface LayoutGraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface LayoutGraphGroup {
  readonly nodeIds: readonly string[];
  readonly cyclic: boolean;
  readonly rank: number;
}

export interface LayoutGraph {
  readonly groups: readonly LayoutGraphGroup[];
  readonly groupIndexByNodeId: ReadonlyMap<string, number>;
}

/**
 * 将相互依赖的节点归入同组，并在组间计算从上游到下游的布局层级。
 * 层级只服务初始布局，不修改配方、回流边或设备数量。
 * 两次深度遍历均使用显式栈，避免长生产链依赖 JavaScript 调用栈深度。
 */
export function buildLayoutGraph(
  nodeIds: readonly string[],
  edges: readonly LayoutGraphEdge[],
): LayoutGraph {
  const nodeIndex = new Map<string, number>();
  for (const [index, id] of nodeIds.entries()) {
    if (nodeIndex.has(id)) {
      throw new Error(`Duplicate layout node: ${id}`);
    }
    nodeIndex.set(id, index);
  }

  const outgoing: number[][] = nodeIds.map(() => []);
  const incoming: number[][] = nodeIds.map(() => []);
  const selfConnected = new Set<number>();
  for (const edge of edges) {
    const from = nodeIndex.get(edge.from);
    const to = nodeIndex.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new Error(`Unknown layout edge endpoint: ${edge.from} -> ${edge.to}`);
    }
    outgoing[from]!.push(to);
    incoming[to]!.push(from);
    if (from === to) selfConnected.add(from);
  }

  const finishOrder: number[] = [];
  const visited = new Uint8Array(nodeIds.length);
  for (let root = 0; root < nodeIds.length; root += 1) {
    if (visited[root] !== 0) continue;
    visited[root] = 1;
    const stack = [{ node: root, nextEdge: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = outgoing[frame.node]![frame.nextEdge];
      if (next === undefined) {
        finishOrder.push(frame.node);
        stack.pop();
        continue;
      }
      frame.nextEdge += 1;
      if (visited[next] !== 0) continue;
      visited[next] = 1;
      stack.push({ node: next, nextEdge: 0 });
    }
  }

  const groupByNode = new Int32Array(nodeIds.length).fill(-1);
  const members: number[][] = [];
  for (let position = finishOrder.length - 1; position >= 0; position -= 1) {
    const root = finishOrder[position]!;
    if (groupByNode[root] !== -1) continue;
    const groupIndex = members.length;
    const group: number[] = [];
    const stack = [root];
    groupByNode[root] = groupIndex;
    while (stack.length > 0) {
      const node = stack.pop()!;
      group.push(node);
      for (const upstream of incoming[node]!) {
        if (groupByNode[upstream] !== -1) continue;
        groupByNode[upstream] = groupIndex;
        stack.push(upstream);
      }
    }
    // 同一循环内保持输入次序，使重复规划的初始分组可复现。
    group.sort((left, right) => left - right);
    members.push(group);
  }

  const downstreamGroups = members.map(() => new Set<number>());
  const indegrees = new Int32Array(members.length);
  for (let from = 0; from < outgoing.length; from += 1) {
    const fromGroup = groupByNode[from]!;
    for (const to of outgoing[from]!) {
      const toGroup = groupByNode[to]!;
      if (fromGroup === toGroup || downstreamGroups[fromGroup]!.has(toGroup)) {
        continue;
      }
      downstreamGroups[fromGroup]!.add(toGroup);
      indegrees[toGroup] = indegrees[toGroup]! + 1;
    }
  }

  const ranks = new Int32Array(members.length);
  const ready: number[] = [];
  for (let group = 0; group < members.length; group += 1) {
    if (indegrees[group] === 0) ready.push(group);
  }
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const group = ready[cursor]!;
    for (const downstream of downstreamGroups[group]!) {
      ranks[downstream] = Math.max(ranks[downstream]!, ranks[group]! + 1);
      indegrees[downstream] = indegrees[downstream]! - 1;
      if (indegrees[downstream] === 0) ready.push(downstream);
    }
  }

  return {
    groups: members.map((group, index) => ({
      nodeIds: group.map((node) => nodeIds[node]!),
      cyclic: group.length > 1 || selfConnected.has(group[0]!),
      rank: ranks[index]!,
    })),
    groupIndexByNodeId: new Map(
      nodeIds.map((id, index) => [id, groupByNode[index]!]),
    ),
  };
}
