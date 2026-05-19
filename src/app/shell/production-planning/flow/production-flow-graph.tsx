import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProductionPlanningDisplayMode, ProductionPlanningIndex, ProductionPlanningResult } from "../production-planning-model";
import { buildProductionFlowGraph, type ProductionFlowLink, type ProductionFlowNode } from "./flow-graph-builder";
import { createSankeyLayout, updateSankeyLinkBreadths, type SankeyGraph, type SankeyLink, type SankeyNode } from "./sankey-layout";
import styles from "../production-planning-panel.module.scss";

interface ProductionFlowGraphProps {
  readonly displayMode: ProductionPlanningDisplayMode;
  readonly plan: ProductionPlanningResult;
  readonly index: ProductionPlanningIndex;
  readonly t: (key: string) => string;
}

interface ViewportState {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

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
  readonly clientX: number;
  readonly clientY: number;
}

interface PinchState {
  readonly startDistance: number;
  readonly startScale: number;
  readonly startViewportX: number;
  readonly startViewportY: number;
  readonly midClientX: number;
  readonly midClientY: number;
}

const NODE_WIDTH = 190;
const NODE_CARD_HEIGHT = 64;
const NODE_PADDING = 22;
const LAYOUT_HEIGHT = 620;
const MIN_SCALE = 0.15;
const MAX_SCALE = 3.0;

export function ProductionFlowGraph({
  displayMode,
  plan,
  index,
  t,
}: ProductionFlowGraphProps) {
  const graphInput = useMemo(() => buildProductionFlowGraph(plan, index, t), [index, plan, t]);
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
  const [graph, setGraph] = useState(initialLayout);
  const [viewport, setViewport] = useState<ViewportState>({ x: 22, y: 22, scale: 1 });
  const viewportRef = useRef(viewport);

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
    setGraph(initialLayout);
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
  }, []);

  // --- unified pointer down on canvas (not on a node / toolbar) ---
  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest(`.${styles["production-flow-toolbar"]}`) !== null) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    const interaction = interactionRef.current;

    // If we already have a pan going and a second pointer arrives, switch to pinch
    if (interaction.pan !== null && interaction.pan.pointerId !== event.pointerId) {
      const p0 = interaction.pan;
      const dx = event.clientX - p0.clientX;
      const dy = event.clientY - p0.clientY;
      interaction.pan = null;
      interaction.pinch = {
        startDistance: Math.sqrt(dx * dx + dy * dy),
        startScale: viewportRef.current.scale,
        startViewportX: viewportRef.current.x,
        startViewportY: viewportRef.current.y,
        midClientX: (event.clientX + p0.clientX) / 2,
        midClientY: (event.clientY + p0.clientY) / 2,
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

    // Pinch
    if (interaction.pinch !== null && interaction.pan !== null) {
      const p0 = interaction.pan;
      const dx = event.clientX - p0.clientX;
      const dy = event.clientY - p0.clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      if (interaction.pinch.startDistance < 1) {
        return;
      }
      const scaleRatio = currentDistance / interaction.pinch.startDistance;
      const nextScale = clamp(interaction.pinch.startScale * scaleRatio, MIN_SCALE, MAX_SCALE);
      const midX = (event.clientX + p0.clientX) / 2;
      const midY = (event.clientY + p0.clientY) / 2;
      const ratio = nextScale / interaction.pinch.startScale;
      setViewport({
        x: midX - ratio * (midX - interaction.pinch.startViewportX),
        y: midY - ratio * (midY - interaction.pinch.startViewportY),
        scale: nextScale,
      });

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
      const dx = (event.clientX - interaction.node.startClientX) / viewportRef.current.scale;
      const dy = (event.clientY - interaction.node.startClientY) / viewportRef.current.scale;
      setGraph((current) => {
        const next: SankeyGraph<ProductionFlowNode, ProductionFlowLink> = {
          nodes: current.nodes.map((node) => {
            if (node.id !== interaction.node!.nodeId) {
              return node;
            }
            node.x0 = interaction.node!.startX0 + dx;
            node.x1 = interaction.node!.startX1 + dx;
            node.y0 = Math.max(0, interaction.node!.startY0 + dy);
            node.y1 = Math.max(node.y0 + 28, interaction.node!.startY1 + dy);
            return node;
          }),
          links: current.links,
        };

        return updateSankeyLinkBreadths(next);
      });

      return;
    }
  }, []);

  // --- unified pointer up ---
  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (interaction.node?.pointerId === event.pointerId) {
      interaction.node = null;
    }

    if (interaction.pan?.pointerId === event.pointerId) {
      // If pinch was active (meaning we had two pointers), just clean the pan slot
      if (interaction.pinch !== null) {
        interaction.pan = null;
        interaction.pinch = null;
      } else {
        interaction.pan = null;
      }
    }

    if (interaction.pinch !== null) {
      interaction.pinch = null;
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
  ].filter(Boolean).join(" ");

  return (
    <g className={className}>
      <path d={path} strokeWidth={Math.max(2, Math.min(18, link.width))} />
      <text>
        <textPath href={`#${edgePathId(link.id)}`} startOffset="50%">
          {link.original.title} {link.original.label}
        </textPath>
      </text>
      <path id={edgePathId(link.id)} d={path} className={styles["production-flow-edge-label-path"]} />
    </g>
  );
}

function createLinkPath(link: SankeyLink<ProductionFlowNode, ProductionFlowLink>): string {
  const sourceX = link.source.x1 + 22;
  const sourceY = mapLinkYToNodeCard(link.source, link.y0) + 22;
  const targetX = link.target.x0 + 22;
  const targetY = mapLinkYToNodeCard(link.target, link.y1) + 22;

  if (link.direction === "forward") {
    const midX = (sourceX + targetX) / 2;
    return `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;
  }

  const bottom = Math.max(
    getNodeCardTop(link.source) + NODE_CARD_HEIGHT,
    getNodeCardTop(link.target) + NODE_CARD_HEIGHT,
  ) + 52 + Math.max(8, link.width) + 22;
  const sourceControl = sourceX + 44;
  const targetControl = targetX - 44;
  return `M ${sourceX} ${sourceY} C ${sourceControl} ${sourceY}, ${sourceControl} ${bottom}, ${sourceX} ${bottom} L ${targetX} ${bottom} C ${targetControl} ${bottom}, ${targetControl} ${targetY}, ${targetX} ${targetY}`;
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
