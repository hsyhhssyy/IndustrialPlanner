export type SankeyLinkDirection = "forward" | "backward" | "self";

export interface SankeyInputNode {
  readonly id: string;
  readonly value?: number;
}

export interface SankeyInputLink {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly value: number;
  readonly preferredFeedback?: boolean;
}

export interface SankeyNode<N extends SankeyInputNode> extends SankeyInputNode {
  readonly source: N;
  index: number;
  value: number;
  depth: number;
  height: number;
  layer: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  sourceLinks: SankeyLink<N, SankeyInputLink>[];
  targetLinks: SankeyLink<N, SankeyInputLink>[];
}

export type SankeyLink<N extends SankeyInputNode, L extends SankeyInputLink> = Omit<L, "source" | "target" | "value"> & {
  readonly id: string;
  readonly source: SankeyNode<N>;
  readonly target: SankeyNode<N>;
  readonly original: L;
  index: number;
  value: number;
  width: number;
  y0: number;
  y1: number;
  direction: SankeyLinkDirection;
};

export interface SankeyGraph<N extends SankeyInputNode, L extends SankeyInputLink> {
  readonly nodes: SankeyNode<N>[];
  readonly links: SankeyLink<N, L>[];
}

export interface SankeyLayoutOptions<N extends SankeyInputNode> {
  readonly width: number;
  readonly height: number;
  readonly nodeWidth?: number;
  readonly nodePadding?: number;
  readonly iterations?: number;
  readonly nodeAlign?: (node: SankeyNode<N>, columnCount: number) => number;
}

const MIN_VALUE = 0.000001;

export function createSankeyLayout<N extends SankeyInputNode, L extends SankeyInputLink>(
  input: { readonly nodes: readonly N[]; readonly links: readonly L[] },
  options: SankeyLayoutOptions<N>,
): SankeyGraph<N, L> {
  const nodeWidth = options.nodeWidth ?? 180;
  const nodePadding = options.nodePadding ?? 18;
  const iterations = options.iterations ?? 6;
  const nodeAlign = options.nodeAlign ?? sankeyJustify;
  const graph = createGraph(input);

  markFeedbackArcDirections(graph);
  computeNodeValues(graph);
  computeNodeDepths(graph.nodes);
  computeNodeHeights(graph.nodes);
  const columns = computeNodeLayers(graph.nodes, nodeAlign, options.width, nodeWidth);
  initializeNodeBreadths(columns, options.height, nodePadding);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const alpha = Math.pow(0.99, iteration);
    const beta = Math.max(1 - alpha, (iteration + 1) / iterations);
    relaxRightToLeft(columns, alpha, beta, options.height, nodePadding);
    relaxLeftToRight(columns, alpha, beta, options.height, nodePadding);
  }

  computeLinkBreadths(graph.nodes);
  return graph;
}

export function updateSankeyLinkBreadths<N extends SankeyInputNode, L extends SankeyInputLink>(
  graph: SankeyGraph<N, L>,
): SankeyGraph<N, L> {
  reorderLinks(graph.nodes);
  computeLinkBreadths(graph.nodes);
  return graph;
}

function createGraph<N extends SankeyInputNode, L extends SankeyInputLink>(
  input: { readonly nodes: readonly N[]; readonly links: readonly L[] },
): SankeyGraph<N, L> {
  const nodeById = new Map<string, SankeyNode<N>>();
  const nodes = input.nodes.map((node, index) => {
    const result: SankeyNode<N> = {
      ...node,
      source: node,
      index,
      value: Math.max(node.value ?? 0, MIN_VALUE),
      depth: 0,
      height: 0,
      layer: 0,
      x0: 0,
      x1: 0,
      y0: 0,
      y1: 0,
      sourceLinks: [],
      targetLinks: [],
    };
    nodeById.set(node.id, result);
    return result;
  });

  const links: SankeyLink<N, L>[] = [];
  input.links.forEach((link, index) => {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (source === undefined || target === undefined) {
      return;
    }

    const result: SankeyLink<N, L> = {
      ...link,
      source,
      target,
      original: link,
      index,
      value: Math.max(link.value, MIN_VALUE),
      width: 1,
      y0: 0,
      y1: 0,
      direction: source === target ? "self" : "forward",
    };
    source.sourceLinks.push(result);
    target.targetLinks.push(result);
    links.push(result);
  });

  return { nodes, links };
}

function computeNodeValues<N extends SankeyInputNode, L extends SankeyInputLink>(graph: SankeyGraph<N, L>): void {
  for (const node of graph.nodes) {
    const sourceValue = sum(node.sourceLinks, (link) => link.value);
    const targetValue = sum(node.targetLinks, (link) => link.value);
    node.value = Math.max(node.source.value ?? 0, sourceValue, targetValue, MIN_VALUE);
  }
}

function computeNodeDepths<N extends SankeyInputNode>(nodes: SankeyNode<N>[]): void {
  const maxIterations = nodes.length + 1;
  let current = new Set(nodes);
  let depth = 0;

  while (current.size > 0) {
    const next = new Set<SankeyNode<N>>();
    for (const node of current) {
      node.depth = depth;
      for (const link of node.sourceLinks) {
        if (link.direction === "forward") {
          next.add(link.target);
        }
      }
    }

    depth += 1;
    if (depth > maxIterations) {
      throw new Error("Unable to resolve Sankey node depth");
    }
    current = next;
  }
}

function computeNodeHeights<N extends SankeyInputNode>(nodes: SankeyNode<N>[]): void {
  const maxIterations = nodes.length + 1;
  let current = new Set(nodes);
  let height = 0;

  while (current.size > 0) {
    const next = new Set<SankeyNode<N>>();
    for (const node of current) {
      node.height = height;
      for (const link of node.targetLinks) {
        if (link.direction === "forward") {
          next.add(link.source);
        }
      }
    }

    height += 1;
    if (height > maxIterations) {
      throw new Error("Unable to resolve Sankey node height");
    }
    current = next;
  }
}

function computeNodeLayers<N extends SankeyInputNode>(
  nodes: SankeyNode<N>[],
  nodeAlign: (node: SankeyNode<N>, columnCount: number) => number,
  width: number,
  nodeWidth: number,
): SankeyNode<N>[][] {
  const columnCount = Math.max(1, Math.max(...nodes.map((node) => node.depth)) + 1);
  const xSpacing = columnCount <= 1 ? 0 : (width - nodeWidth) / (columnCount - 1);
  const columns = Array.from({ length: columnCount }, () => [] as SankeyNode<N>[]);

  for (const node of nodes) {
    const layer = clamp(Math.floor(nodeAlign(node, columnCount)), 0, columnCount - 1);
    node.layer = layer;
    node.x0 = layer * xSpacing;
    node.x1 = node.x0 + nodeWidth;
    columns[layer]?.push(node);
  }

  return columns;
}

function initializeNodeBreadths<N extends SankeyInputNode>(
  columns: SankeyNode<N>[][],
  height: number,
  nodePadding: number,
): void {
  const scaleCandidates = columns
    .filter((column) => column.length > 0)
    .map((column) => {
      const available = Math.max(1, height - (column.length - 1) * nodePadding);
      return available / Math.max(MIN_VALUE, sum(column, (node) => node.value));
    });
  const scale = scaleCandidates.length === 0 ? 1 : Math.max(MIN_VALUE, Math.min(...scaleCandidates));

  for (const column of columns) {
    let y = 0;
    for (const node of column) {
      const nodeHeight = Math.max(28, node.value * scale);
      node.y0 = y;
      node.y1 = y + nodeHeight;
      for (const link of node.sourceLinks) {
        link.width = Math.max(2, link.value * scale);
      }
      y = node.y1 + nodePadding;
    }

    const extra = (height - y + nodePadding) / (column.length + 1);
    for (let index = 0; index < column.length; index += 1) {
      const node = column[index];
      if (node === undefined) {
        continue;
      }
      const offset = Math.max(0, extra) * (index + 1);
      node.y0 += offset;
      node.y1 += offset;
    }
  }

  reorderLinks(columns.flat());
}

function relaxLeftToRight<N extends SankeyInputNode>(
  columns: SankeyNode<N>[][],
  alpha: number,
  beta: number,
  height: number,
  nodePadding: number,
): void {
  for (let columnIndex = 1; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex] ?? [];
    for (const target of column) {
      let weightedY = 0;
      let weight = 0;
      for (const link of target.targetLinks) {
        if (link.direction !== "forward") {
          continue;
        }
        const distance = Math.max(1, target.layer - link.source.layer);
        const linkWeight = link.value * distance;
        weightedY += targetTop(link.source, target, nodePadding) * linkWeight;
        weight += linkWeight;
      }
      if (weight <= 0) {
        continue;
      }
      const dy = (weightedY / weight - target.y0) * alpha;
      target.y0 += dy;
      target.y1 += dy;
      reorderNodeLinks(target);
    }
    column.sort(compareNodeBreadth);
    resolveCollisions(column, beta, height, nodePadding);
  }
}

function relaxRightToLeft<N extends SankeyInputNode>(
  columns: SankeyNode<N>[][],
  alpha: number,
  beta: number,
  height: number,
  nodePadding: number,
): void {
  for (let columnIndex = columns.length - 2; columnIndex >= 0; columnIndex -= 1) {
    const column = columns[columnIndex] ?? [];
    for (const source of column) {
      let weightedY = 0;
      let weight = 0;
      for (const link of source.sourceLinks) {
        if (link.direction !== "forward") {
          continue;
        }
        const distance = Math.max(1, link.target.layer - source.layer);
        const linkWeight = link.value * distance;
        weightedY += sourceTop(source, link.target, nodePadding) * linkWeight;
        weight += linkWeight;
      }
      if (weight <= 0) {
        continue;
      }
      const dy = (weightedY / weight - source.y0) * alpha;
      source.y0 += dy;
      source.y1 += dy;
      reorderNodeLinks(source);
    }
    column.sort(compareNodeBreadth);
    resolveCollisions(column, beta, height, nodePadding);
  }
}

function resolveCollisions<N extends SankeyInputNode>(
  nodes: SankeyNode<N>[],
  alpha: number,
  height: number,
  nodePadding: number,
): void {
  if (nodes.length === 0) {
    return;
  }

  let y = 0;
  for (const node of nodes) {
    const dy = (y - node.y0) * alpha;
    if (dy > 0) {
      node.y0 += dy;
      node.y1 += dy;
    }
    y = node.y1 + nodePadding;
  }

  y = height;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node === undefined) {
      continue;
    }
    const dy = (node.y1 - y) * alpha;
    if (dy > 0) {
      node.y0 -= dy;
      node.y1 -= dy;
    }
    y = node.y0 - nodePadding;
  }
}

function reorderNodeLinks<N extends SankeyInputNode>(node: SankeyNode<N>): void {
  for (const link of node.targetLinks) {
    link.source.sourceLinks.sort(compareTargetBreadth);
  }
  for (const link of node.sourceLinks) {
    link.target.targetLinks.sort(compareSourceBreadth);
  }
}

function reorderLinks<N extends SankeyInputNode>(nodes: SankeyNode<N>[]): void {
  for (const node of nodes) {
    node.sourceLinks.sort(compareTargetBreadth);
    node.targetLinks.sort(compareSourceBreadth);
  }
}

function computeLinkBreadths<N extends SankeyInputNode>(nodes: SankeyNode<N>[]): void {
  reorderLinks(nodes);
  for (const node of nodes) {
    let sourceY = node.y0;
    for (const link of node.sourceLinks) {
      link.y0 = sourceY + link.width / 2;
      sourceY += link.width;
    }

    let targetY = node.y0;
    for (const link of node.targetLinks) {
      link.y1 = targetY + link.width / 2;
      targetY += link.width;
    }
  }
}

function sourceTop<N extends SankeyInputNode>(
  source: SankeyNode<N>,
  target: SankeyNode<N>,
  nodePadding: number,
): number {
  let y = target.y0 - ((target.targetLinks.length - 1) * nodePadding) / 2;
  for (const link of target.targetLinks) {
    if (link.source === source) {
      break;
    }
    y += link.width + nodePadding;
  }
  for (const link of source.sourceLinks) {
    if (link.target === target) {
      break;
    }
    y -= link.width;
  }
  return y;
}

function targetTop<N extends SankeyInputNode>(
  source: SankeyNode<N>,
  target: SankeyNode<N>,
  nodePadding: number,
): number {
  let y = source.y0 - ((source.sourceLinks.length - 1) * nodePadding) / 2;
  for (const link of source.sourceLinks) {
    if (link.target === target) {
      break;
    }
    y += link.width + nodePadding;
  }
  for (const link of target.targetLinks) {
    if (link.source === source) {
      break;
    }
    y -= link.width;
  }
  return y;
}

function compareNodeBreadth<N extends SankeyInputNode>(left: SankeyNode<N>, right: SankeyNode<N>): number {
  return left.y0 - right.y0 || left.index - right.index;
}

function compareSourceBreadth<N extends SankeyInputNode>(
  left: SankeyLink<N, SankeyInputLink>,
  right: SankeyLink<N, SankeyInputLink>,
): number {
  return left.source.y0 - right.source.y0 || left.index - right.index;
}

function compareTargetBreadth<N extends SankeyInputNode>(
  left: SankeyLink<N, SankeyInputLink>,
  right: SankeyLink<N, SankeyInputLink>,
): number {
  return left.target.y0 - right.target.y0 || left.index - right.index;
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sankeyJustify<N extends SankeyInputNode>(node: SankeyNode<N>, columnCount: number): number {
  return node.sourceLinks.some((link) => link.direction === "forward") ? node.depth : columnCount - 1;
}

function markFeedbackArcDirections<N extends SankeyInputNode, L extends SankeyInputLink>(
  graph: SankeyGraph<N, L>,
): void {
  const nodes = new Set(graph.nodes);
  const indegrees = new Map<SankeyNode<N>, number>();
  const outdegrees = new Map<SankeyNode<N>, number>();

  for (const node of graph.nodes) {
    indegrees.set(node, node.targetLinks.filter((link) => link.source !== node).length);
    outdegrees.set(node, node.sourceLinks.filter((link) => link.target !== node).length);
  }

  const left: SankeyNode<N>[] = [];
  const right: SankeyNode<N>[] = [];
  const remove = (node: SankeyNode<N>) => {
    nodes.delete(node);
    for (const link of node.targetLinks) {
      if (nodes.has(link.source)) {
        outdegrees.set(link.source, (outdegrees.get(link.source) ?? 0) - 1);
      }
    }
    for (const link of node.sourceLinks) {
      if (nodes.has(link.target)) {
        indegrees.set(link.target, (indegrees.get(link.target) ?? 0) - 1);
      }
    }
  };

  while (nodes.size > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of [...nodes]) {
        if ((outdegrees.get(node) ?? 0) === 0) {
          right.push(node);
          remove(node);
          changed = true;
        }
      }
    }

    changed = true;
    while (changed) {
      changed = false;
      for (const node of [...nodes]) {
        if ((indegrees.get(node) ?? 0) === 0) {
          left.push(node);
          remove(node);
          changed = true;
        }
      }
    }

    if (nodes.size === 0) {
      break;
    }

    let selected: SankeyNode<N> | null = null;
    let bestDelta = Number.NEGATIVE_INFINITY;
    for (const node of nodes) {
      const delta = (outdegrees.get(node) ?? 0) - (indegrees.get(node) ?? 0);
      if (selected === null || delta > bestDelta) {
        selected = node;
        bestDelta = delta;
      }
    }

    if (selected !== null) {
      left.push(selected);
      remove(selected);
    }
  }

  const order = [...left, ...right.reverse()];
  const orderByNode = new Map(order.map((node, index) => [node, index]));
  for (const link of graph.links) {
    const sourceOrder = orderByNode.get(link.source) ?? 0;
    const targetOrder = orderByNode.get(link.target) ?? 0;
    link.direction = sourceOrder === targetOrder ? "self" : sourceOrder < targetOrder ? "forward" : "backward";
  }

  applyPreferredFeedbackArcDirections(graph);
}

function applyPreferredFeedbackArcDirections<N extends SankeyInputNode, L extends SankeyInputLink>(
  graph: SankeyGraph<N, L>,
): void {
  for (const link of graph.links) {
    if (link.original.preferredFeedback !== true || link.source === link.target) {
      continue;
    }

    link.direction = "backward";
    const opposite = graph.links.find((candidate) => (
      candidate !== link
      && candidate.source === link.target
      && candidate.target === link.source
      && candidate.original.preferredFeedback !== true
    ));
    if (opposite !== undefined) {
      opposite.direction = "forward";
    }
  }
}
