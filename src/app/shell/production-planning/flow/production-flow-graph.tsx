import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";

import type { ProductionPlanningDisplayMode, ProductionPlanningIndex, ProductionPlanningResult } from "../production-planning-model";
import { buildProductionFlowGraph, type ProductionFlowLink, type ProductionFlowNode } from "./flow-graph-builder";
import { createSankeyLayout, updateSankeyLinkBreadths, type SankeyGraph, type SankeyLink, type SankeyNode } from "./sankey-layout";
import styles from "../production-planning-panel.module.scss";

interface ProductionFlowGraphProps {
  readonly displayMode: ProductionPlanningDisplayMode;
  readonly initialViewport?: ViewportState;
  readonly plan: ProductionPlanningResult;
  readonly index: ProductionPlanningIndex;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly t: (key: string) => string;
}

interface ViewportState {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

type ViewportUpdate = ViewportState | ((current: ViewportState) => ViewportState);

interface NodeDragState {
  readonly pointerId: number;
  readonly nodeId: string;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startX0: number;
  readonly startX1: number;
  readonly startY0: number;
  readonly startY1: number;
}

interface PanDragState {
  readonly pointerId: number;
  readonly viewportX: number;
  readonly viewportY: number;
  clientX: number;
  clientY: number;
}

interface PinchState {
  readonly startDistance: number;
  readonly startScale: number;
  readonly startViewportX: number;
  readonly startViewportY: number;
  readonly midClientX: number;
  readonly midClientY: number;
  secondPointerId: number;
  secondClientX: number;
  secondClientY: number;
}

const NODE_WIDTH = 190;
const NODE_CARD_HEIGHT = 64;
const NODE_PADDING = 22;
const LAYOUT_HEIGHT = 620;
const MIN_SCALE = 0.15;
const MAX_SCALE = 3.0;

export function ProductionFlowGraph({
  displayMode,
  initialViewport,
  plan,
  index,
  onViewportChange,
  t,
}: ProductionFlowGraphProps) {
  const graphInput = useMemo(() => buildProductionFlowGraph(plan, index, t, displayMode), [displayMode, index, plan, t]);
  const initialLayout = useMemo(() => {
    const width = resolveLayoutWidth(graphInput);
    return createSankeyLayout(graphInput, {
      width,
      height: LAYOUT_HEIGHT,
      nodeWidth: NODE_WIDTH,
      nodePadding: NODE_PADDING,
      iterations: 8,
    });
  }, [graphInput]);
  const [graph, setGraph] = useState(() => cloneSankeyGraph(initialLayout));
  const [viewport, setRawViewport] = useState<ViewportState>(() => normalizeViewportState(initialViewport));
  const viewportRef = useRef(viewport);

  const setViewport = useCallback((update: ViewportUpdate) => {
    setRawViewport((current) => {
      const nextViewport = normalizeViewportState(
        typeof update === "function" ? update(current) : update,
      );
      onViewportChange?.(nextViewport);
      return nextViewport;
    });
  }, [onViewportChange]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const interactionRef = useRef<{
    node: NodeDragState | null;
    pan: PanDragState | null;
    pinch: PinchState | null;
  }>({
    node: null,
    pan: null,
    pinch: null,
  });

  useEffect(() => {
    setGraph(cloneSankeyGraph(initialLayout));
  }, [initialLayout]);

  const resetNodeLayout = useCallback(() => {
    setGraph(cloneSankeyGraph(initialLayout));
  }, [initialLayout]);

  // --- wheel zoom (centered on cursor) ---
  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;

    setViewport((current) => {
      const direction = event.deltaY > 0 ? -1 : 1;
      const nextScale = clamp(current.scale + direction * 0.1, MIN_SCALE, MAX_SCALE);
      const ratio = nextScale / current.scale;
      return {
        x: cursorX - ratio * (cursorX - current.x),
        y: cursorY - ratio * (cursorY - current.y),
        scale: nextScale,
      };
    });
  }, [setViewport]);

  // --- unified pointer down on canvas (not on a node / toolbar) ---
  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest(`.${styles["production-flow-toolbar"]}`) !== null) {
      return;
    }

    const interaction = interactionRef.current;

    // 2026-05-19 订正：仅对首指设置 pointer capture，避免第二指抢夺 capture 导致第一指丢失事件
    if (interaction.pan === null && interaction.pinch === null) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    // If we already have a pan going and a second pointer arrives, switch to pinch
    if (interaction.pan !== null && interaction.pan.pointerId !== event.pointerId) {
      const p0 = interaction.pan;
      const dx = event.clientX - p0.clientX;
      const dy = event.clientY - p0.clientY;
      // 2026-05-19 订正：不设置为 null，保留 pan 以追踪第一指位置，在 move 中通过 pinch 状态抑制 pan
      interaction.pinch = {
        startDistance: Math.sqrt(dx * dx + dy * dy),
        startScale: viewportRef.current.scale,
        startViewportX: viewportRef.current.x,
        startViewportY: viewportRef.current.y,
        midClientX: (event.clientX + p0.clientX) / 2,
        midClientY: (event.clientY + p0.clientY) / 2,
        secondPointerId: event.pointerId,
        secondClientX: event.clientX,
        secondClientY: event.clientY,
      };

      return;
    }

    // Start pan drag (any button — left, middle, or Alt+left)
    interaction.pan = {
      pointerId: event.pointerId,
      viewportX: viewportRef.current.x,
      viewportY: viewportRef.current.y,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    interaction.pinch = null;
  }, []);

  // --- node drag start ---
  const handleNodePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, node: SankeyNode<ProductionFlowNode>) => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const interaction = interactionRef.current;
    interaction.pan = null;
    interaction.pinch = null;
    interaction.node = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX0: node.x0,
      startX1: node.x1,
      startY0: node.y0,
      startY1: node.y1,
    };
  }, []);

  // --- unified pointer move ---
  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;

    // Pinch — must check before pan to suppress pan when two fingers are down
    if (interaction.pinch !== null && interaction.pan !== null) {
      const p0 = interaction.pan;
      const pinch = interaction.pinch;

      // Update the moving finger's position
      let finger1X = p0.clientX;
      let finger1Y = p0.clientY;
      let finger2X = pinch.secondClientX;
      let finger2Y = pinch.secondClientY;

      if (event.pointerId === p0.pointerId) {
        finger1X = event.clientX;
        finger1Y = event.clientY;
        p0.clientX = event.clientX;
        p0.clientY = event.clientY;
      } else if (event.pointerId === pinch.secondPointerId) {
        finger2X = event.clientX;
        finger2Y = event.clientY;
        pinch.secondClientX = event.clientX;
        pinch.secondClientY = event.clientY;
      }

      const dx = finger2X - finger1X;
      const dy = finger2Y - finger1Y;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);

      if (pinch.startDistance >= 1) {
        const scaleRatio = currentDistance / pinch.startDistance;
        const nextScale = clamp(pinch.startScale * scaleRatio, MIN_SCALE, MAX_SCALE);
        const midX = (finger2X + finger1X) / 2;
        const midY = (finger2Y + finger1Y) / 2;
        const ratio = nextScale / pinch.startScale;
        setViewport({
          x: midX - ratio * (midX - pinch.startViewportX),
          y: midY - ratio * (midY - pinch.startViewportY),
          scale: nextScale,
        });
      }

      return;
    }

    // Pan
    if (interaction.pan !== null && interaction.pan.pointerId === event.pointerId) {
      setViewport({
        x: interaction.pan.viewportX + event.clientX - interaction.pan.clientX,
        y: interaction.pan.viewportY + event.clientY - interaction.pan.clientY,
        scale: viewportRef.current.scale,
      });

      return;
    }

    // Node drag
    if (interaction.node !== null && interaction.node.pointerId === event.pointerId) {
      const nodeDrag = interaction.node;
      const dx = (event.clientX - nodeDrag.startClientX) / viewportRef.current.scale;
      const dy = (event.clientY - nodeDrag.startClientY) / viewportRef.current.scale;
      setGraph((current) => {
        const next: SankeyGraph<ProductionFlowNode, ProductionFlowLink> = {
          nodes: current.nodes.map((node) => {
            if (node.id !== nodeDrag.nodeId) {
              return node;
            }
            node.x0 = nodeDrag.startX0 + dx;
            node.x1 = nodeDrag.startX1 + dx;
            node.y0 = nodeDrag.startY0 + dy;
            node.y1 = Math.max(node.y0 + 28, nodeDrag.startY1 + dy);
            return node;
          }),
          links: current.links,
        };

        return updateSankeyLinkBreadths(next);
      });

      return;
    }
  }, [setViewport]);

  // --- unified pointer up ---
  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;

    if (interaction.pan?.pointerId === event.pointerId) {
      if (interaction.pinch !== null) {
        // 2026-05-19 订正：第一指抬起但 pinch 仍在进行，结束 pinch，清空 pan
        interaction.pan = null;
        interaction.pinch = null;
      } else {
        interaction.pan = null;
      }
      return;
    }

    if (interaction.pinch?.secondPointerId === event.pointerId) {
      // 2026-05-19 订正：第二指抬起，结束 pinch，保留 pan 继续单指拖动
      interaction.pinch = null;
      return;
    }

    if (interaction.node?.pointerId === event.pointerId) {
      interaction.node = null;
    }
  }, []);

  if (graphInput.nodes.length === 0) {
    return <div className={styles["production-planning-empty"]}>{t("productionPlanning.noRecipes")}</div>;
  }

  const bounds = getGraphBounds(graph);
  const canvasWidth = Math.max(960, bounds.width + 44);
  const canvasHeight = Math.max(520, bounds.height + 44);

  return (
    <div
      className={styles["production-flow-canvas"]}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className={styles["production-flow-toolbar"]}>
        <button type="button" onClick={() => setViewport({ x: 22, y: 22, scale: 1 })}>1:1</button>
        <button
          type="button"
          aria-label={t("productionPlanning.resetLayout")}
          title={t("productionPlanning.resetLayout")}
          onClick={resetNodeLayout}
        >
          <LucideRotateCcw aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setViewport((current) => ({ ...current, scale: clamp(current.scale - 0.12, MIN_SCALE, MAX_SCALE) }))}>-</button>
        <button type="button" onClick={() => setViewport((current) => ({ ...current, scale: clamp(current.scale + 0.12, MIN_SCALE, MAX_SCALE) }))}>+</button>
      </div>
      <div
        className={styles["production-flow-surface"]}
        style={{
          width: canvasWidth,
          height: canvasHeight,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <svg className={styles["production-flow-edges"]} width={canvasWidth} height={canvasHeight}>
          {graph.links.map((link) => (
            <FlowEdge key={link.id} link={link} />
          ))}
        </svg>
        <div className={styles["production-flow-nodes"]}>
          {graph.nodes.map((node) => (
            <FlowNode
              key={node.id}
              node={node}
              displayMode={displayMode}
              onPointerDown={handleNodePointerDown}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FlowNode({
  node,
  displayMode,
  onPointerDown,
}: {
  readonly node: SankeyNode<ProductionFlowNode>;
  readonly displayMode: ProductionPlanningDisplayMode;
  readonly onPointerDown: (event: React.PointerEvent<HTMLDivElement>, node: SankeyNode<ProductionFlowNode>) => void;
}) {
  const className = [
    styles["production-flow-node"],
    styles[`is-${node.source.kind}`],
    styles[`is-${node.source.tone}`],
    node.source.isTransient === true ? styles["is-transient"] : null,
  ].filter(Boolean).join(" ");
  const metric = node.source.kind === "recipe" && displayMode === "device"
    ? node.source.subtitle
    : `${node.source.subtitle}`;

  return (
    <div
      className={className}
      style={{
        left: node.x0 + 22,
        top: getNodeCardTop(node) + 22,
        width: node.x1 - node.x0,
        height: NODE_CARD_HEIGHT,
      }}
      onPointerDown={(event) => onPointerDown(event, node)}
    >
      <img alt="" src={node.source.iconSrc} />
      <div>
        <strong>{node.source.title}</strong>
        <span>{metric}</span>
      </div>
    </div>
  );
}

function FlowEdge({ link }: { readonly link: SankeyLink<ProductionFlowNode, ProductionFlowLink> }) {
  const path = createLinkPath(link);
  const className = [
    styles["production-flow-edge"],
    styles[`is-${link.direction}`],
    link.original.sourceSide === "left" ? styles["is-left-exit"] : null,
    link.original.targetSide === "right" ? styles["is-right-entry"] : null,
  ].filter(Boolean).join(" ");

  return (
    <g className={className}>
      <path id={edgePathId(link.id)} d={path} className={styles["production-flow-edge-label-path"]} />
      <path className={styles["production-flow-edge-path"]} d={path} strokeWidth={resolveVisibleLinkWidth(link)} />
      <text>
        <textPath href={`#${edgePathId(link.id)}`} startOffset="50%">
          {link.original.title} {link.original.label}
        </textPath>
      </text>
    </g>
  );
}

function createLinkPath(link: SankeyLink<ProductionFlowNode, ProductionFlowLink>): string {
  const sourceSide = link.original.sourceSide ?? "right";
  const sourceX = (sourceSide === "left" ? link.source.x0 : link.source.x1) + 22;
  const sourceY = mapLinkYToNodeCard(link.source, link.y0) + 22;
  const targetSide = link.original.targetSide ?? "left";
  const targetX = (targetSide === "right" ? link.target.x1 : link.target.x0) + 22;
  const targetY = mapLinkYToNodeCard(link.target, link.y1) + 22;
  const visibleWidth = resolveVisibleLinkWidth(link);
  const sideOffset = 48 + Math.max(8, visibleWidth);

  if (sourceSide === "left" && targetSide === "left") {
    const controlX = Math.min(sourceX, targetX) - sideOffset;
    return `M ${sourceX} ${sourceY} C ${controlX} ${sourceY}, ${controlX} ${targetY}, ${targetX} ${targetY}`;
  }

  if (sourceSide === "right" && targetSide === "right") {
    const controlX = Math.max(sourceX, targetX) + sideOffset;
    return `M ${sourceX} ${sourceY} C ${controlX} ${sourceY}, ${controlX} ${targetY}, ${targetX} ${targetY}`;
  }

  if (link.direction === "forward" && sourceSide === "right" && targetSide !== "right") {
    const midX = (sourceX + targetX) / 2;
    return `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;
  }

  const bottom = Math.max(
    getNodeCardTop(link.source) + NODE_CARD_HEIGHT,
    getNodeCardTop(link.target) + NODE_CARD_HEIGHT,
  ) + 52 + Math.max(8, visibleWidth) + 22;
  const sourceControl = sourceSide === "left" ? sourceX - 44 : sourceX + 44;
  const targetControl = targetSide === "right" ? targetX + 44 : targetX - 44;
  return `M ${sourceX} ${sourceY} C ${sourceControl} ${sourceY}, ${sourceControl} ${bottom}, ${sourceX} ${bottom} L ${targetX} ${bottom} C ${targetControl} ${bottom}, ${targetControl} ${targetY}, ${targetX} ${targetY}`;
}

function resolveVisibleLinkWidth(link: SankeyLink<ProductionFlowNode, ProductionFlowLink>): number {
  return Math.max(2, Math.min(18, link.width));
}

function getNodeCardTop(node: SankeyNode<ProductionFlowNode>): number {
  return node.y0 + Math.max(0, (node.y1 - node.y0 - NODE_CARD_HEIGHT) / 2);
}

function mapLinkYToNodeCard(node: SankeyNode<ProductionFlowNode>, linkY: number): number {
  const cardTop = getNodeCardTop(node);
  const virtualHeight = Math.max(1, node.y1 - node.y0);
  const ratio = clamp((linkY - node.y0) / virtualHeight, 0, 1);
  return cardTop + 12 + ratio * (NODE_CARD_HEIGHT - 24);
}

function edgePathId(id: string): string {
  return `production-flow-edge-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function getGraphBounds(graph: SankeyGraph<ProductionFlowNode, ProductionFlowLink>): { readonly width: number; readonly height: number } {
  const width = Math.max(...graph.nodes.map((node) => node.x1), 1);
  const height = Math.max(...graph.nodes.map((node) => node.y1), 1);
  return { width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeViewportState(value: ViewportState | undefined): ViewportState {
  return {
    x: normalizeFiniteNumber(value?.x, 22),
    y: normalizeFiniteNumber(value?.y, 22),
    scale: clamp(normalizeFiniteNumber(value?.scale, 1), MIN_SCALE, MAX_SCALE),
  };
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cloneSankeyGraph(
  graph: SankeyGraph<ProductionFlowNode, ProductionFlowLink>,
): SankeyGraph<ProductionFlowNode, ProductionFlowLink> {
  const nodeById = new Map<string, SankeyNode<ProductionFlowNode>>();
  const nodes = graph.nodes.map((node) => {
    const clone: SankeyNode<ProductionFlowNode> = {
      ...node,
      sourceLinks: [],
      targetLinks: [],
    };
    nodeById.set(clone.id, clone);
    return clone;
  });
  const links = graph.links.map((link) => {
    const source = nodeById.get(link.source.id);
    const target = nodeById.get(link.target.id);
    if (source === undefined || target === undefined) {
      throw new Error("Unable to clone Sankey graph link endpoint");
    }

    const clone: SankeyLink<ProductionFlowNode, ProductionFlowLink> = {
      ...link,
      source,
      target,
    };
    source.sourceLinks.push(clone);
    target.targetLinks.push(clone);
    return clone;
  });

  return { nodes, links };
}

function resolveLayoutWidth(graphInput: ReturnType<typeof buildProductionFlowGraph>): number {
  const layerCount = estimateLayerCount(graphInput);
  return Math.max(760, Math.min(2400, NODE_WIDTH + (layerCount - 1) * 270));
}

function estimateLayerCount(graphInput: ReturnType<typeof buildProductionFlowGraph>): number {
  const outgoing = new Map<string, string[]>();
  for (const node of graphInput.nodes) {
    outgoing.set(node.id, []);
  }
  for (const link of graphInput.links) {
    outgoing.get(link.source)?.push(link.target);
  }

  const memo = new Map<string, number>();
  const visit = (nodeId: string, visiting: ReadonlySet<string>): number => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);
    let depth = 0;
    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (nextVisiting.has(targetId)) {
        continue;
      }
      depth = Math.max(depth, 1 + visit(targetId, nextVisiting));
    }
    memo.set(nodeId, depth);
    return depth;
  };

  return Math.max(2, ...graphInput.nodes.map((node) => visit(node.id, new Set()) + 1));
}
