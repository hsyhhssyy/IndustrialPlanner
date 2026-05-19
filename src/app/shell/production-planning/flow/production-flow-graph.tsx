import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

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

interface DragState {
  readonly pointerId: number;
  readonly nodeId: string;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startX0: number;
  readonly startX1: number;
  readonly startY0: number;
  readonly startY1: number;
}

const NODE_WIDTH = 190;
const NODE_CARD_HEIGHT = 64;
const NODE_PADDING = 22;
const LAYOUT_HEIGHT = 620;

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
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    setGraph(initialLayout);
  }, [initialLayout]);

  if (graphInput.nodes.length === 0) {
    return <div className={styles["production-planning-empty"]}>{t("productionPlanning.noRecipes")}</div>;
  }

  const bounds = getGraphBounds(graph);
  const canvasWidth = Math.max(960, bounds.width + 44);
  const canvasHeight = Math.max(520, bounds.height + 44);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextScale = clamp(viewport.scale + direction * 0.08, 0.55, 1.8);
    setViewport((current) => ({ ...current, scale: nextScale }));
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 && !(event.button === 0 && event.altKey)) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const base = viewport;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    const move = (moveEvent: PointerEvent) => {
      setViewport({
        ...base,
        x: base.x + moveEvent.clientX - startX,
        y: base.y + moveEvent.clientY - startY,
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLDivElement>, node: SankeyNode<ProductionFlowNode>) => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX0: node.x0,
      startX1: node.x1,
      startY0: node.y0,
      startY1: node.y1,
    };
  };

  const handleNodePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = (event.clientX - drag.startClientX) / viewport.scale;
    const dy = (event.clientY - drag.startClientY) / viewport.scale;
    setGraph((current) => {
      const next: SankeyGraph<ProductionFlowNode, ProductionFlowLink> = {
        nodes: current.nodes.map((node) => {
          if (node.id !== drag.nodeId) {
            return node;
          }
          node.x0 = drag.startX0 + dx;
          node.x1 = drag.startX1 + dx;
          node.y0 = Math.max(0, drag.startY0 + dy);
          node.y1 = Math.max(node.y0 + 28, drag.startY1 + dy);
          return node;
        }),
        links: current.links,
      };
      return updateSankeyLinkBreadths(next);
    });
  };

  const handleNodePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  return (
    <div
      className={styles["production-flow-canvas"]}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
    >
      <div className={styles["production-flow-toolbar"]}>
        <button type="button" onClick={() => setViewport({ x: 22, y: 22, scale: 1 })}>1:1</button>
        <button type="button" onClick={() => setViewport((current) => ({ ...current, scale: clamp(current.scale - 0.12, 0.55, 1.8) }))}>-</button>
        <button type="button" onClick={() => setViewport((current) => ({ ...current, scale: clamp(current.scale + 0.12, 0.55, 1.8) }))}>+</button>
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
              onPointerMove={handleNodePointerMove}
              onPointerUp={handleNodePointerEnd}
              onPointerCancel={handleNodePointerEnd}
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
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  readonly node: SankeyNode<ProductionFlowNode>;
  readonly displayMode: ProductionPlanningDisplayMode;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, node: SankeyNode<ProductionFlowNode>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
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
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
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
