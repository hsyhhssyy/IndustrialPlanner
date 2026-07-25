import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import LucideChevronRight from "~icons/lucide/chevron-right";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";

import type { ProductionPlanningIndex, ProductionPlanningResult } from "../production-planning-model";
import { buildProcessGraph } from "./process-graph-builder";
import type { ProcessGraph, ProcessNode } from "./process-graph-model";
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";
import { createDeviceIconAssetUrl } from "@/shared/browser/public-asset-url";
import styles from "./process-graph.module.scss";

interface ProcessGraphViewProps {
  readonly plan: ProductionPlanningResult;
  readonly index: ProductionPlanningIndex;
  readonly recipeChoices: ReadonlyMap<string, string>;
  readonly expandedItemIds: ReadonlySet<string>;
  readonly initialViewport?: ViewportState;
  readonly onToggleItem: (itemId: string) => void;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly t: (key: string) => string;
}

interface ViewportState {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

interface PanState {
  readonly pointerId: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly clientX: number;
  readonly clientY: number;
}

const CELL_WIDTH = 140;
const CELL_HEIGHT = 44;
const NODE_PADDING = 20;
const COL_GAP = 40;
const MIN_SCALE = 0.15;
const MAX_SCALE = 3.0;

export function ProcessGraphView({
  plan,
  index,
  recipeChoices,
  expandedItemIds,
  initialViewport,
  onToggleItem,
  onViewportChange,
  t,
}: ProcessGraphViewProps) {
  const graph = useMemo(
    () => buildProcessGraph(plan, index, recipeChoices, expandedItemIds, t),
    [plan, index, recipeChoices, expandedItemIds, t],
  );

  const [viewport, setRawViewport] = useState<ViewportState>(
    () => normalizeViewportState(initialViewport),
  );
  const viewportRef = useRef(viewport);
  const [detailExpandedNodeKey, setDetailExpandedNodeKey] = useState<string | null>(null);

  const setViewport = useCallback((next: ViewportState) => {
    setRawViewport(next);
    viewportRef.current = next;
    onViewportChange?.(next);
  }, [onViewportChange]);

  // Dismiss detail popup on click outside
  useEffect(() => {
    if (detailExpandedNodeKey === null) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target === null) return;
      // Don't dismiss if clicking inside the popup
      if (target.closest(`.${styles["process-detail-popup"]}`) !== null) return;
      setDetailExpandedNodeKey(null);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [detailExpandedNodeKey]);

  // Compute expanded node info for the popup
  const expandedNode = detailExpandedNodeKey !== null
    ? graph.nodes.find((n) => `${n.col}:${n.row}` === detailExpandedNodeKey) ?? null
    : null;
  const expandedNodeCanvasX = expandedNode !== null ? nodeCenterX(expandedNode.col) : 0;
  const expandedNodeCanvasY = expandedNode !== null ? nodeCenterY(expandedNode.row) : 0;
  const expandedRecipeId = expandedNode?.recipeId ?? expandedNode?.expandedRecipeId ?? null;
  const expandedRecipe = expandedRecipeId !== null ? index.recipeById.get(expandedRecipeId) ?? undefined : undefined;
  const expandedDevice = expandedRecipe !== undefined ? index.entityById.get(expandedRecipe.machineId) ?? null : null;

  const handleDetailToggle = useCallback((nodeKey: string) => {
    setDetailExpandedNodeKey((prev) => (prev === nodeKey ? null : nodeKey));
  }, []);

  // Viewport anchoring: keep the toggled node at the same screen position
  const anchorRef = useRef<{ itemId: string; canvasX: number; canvasY: number } | null>(null);

  const handleToggle = useCallback((itemId: string, nodeCol: number, nodeRow: number) => {
    // Record canvas position of the toggle button before the graph changes
    const canvasX = nodeCenterX(nodeCol) - CELL_WIDTH / 2 - COL_GAP / 2;
    const canvasY = nodeCenterY(nodeRow);
    anchorRef.current = { itemId, canvasX, canvasY };
    onToggleItem(itemId);
  }, [onToggleItem]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return;
    anchorRef.current = null;

    // Find the new position of the anchored item
    const anchoredNode = graph.nodes.find((n) => n.itemId === anchor.itemId);
    if (anchoredNode === undefined) return;

    const newCanvasX = nodeCenterX(anchoredNode.col) - CELL_WIDTH / 2 - COL_GAP / 2;
    const newCanvasY = nodeCenterY(anchoredNode.row);

    const current = viewportRef.current;
    // Old screen position
    const oldScreenX = anchor.canvasX * current.scale + current.x;
    const oldScreenY = anchor.canvasY * current.scale + current.y;
    // New viewport that keeps the anchor at the same screen position
    const newX = oldScreenX - newCanvasX * current.scale;
    const newY = oldScreenY - newCanvasY * current.scale;

    if (Math.abs(newX - current.x) > 0.5 || Math.abs(newY - current.y) > 0.5) {
      setViewport({ x: newX, y: newY, scale: current.scale });
    }
  }, [graph, setViewport]);

  const panRef = useRef<PanState | null>(null);

  // Wheel zoom
  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const current = viewportRef.current;
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextScale = clamp(current.scale + direction * 0.1, MIN_SCALE, MAX_SCALE);
    const ratio = nextScale / current.scale;
    setViewport({
      x: cx - ratio * (cx - current.x),
      y: cy - ratio * (cy - current.y),
      scale: nextScale,
    });
  }, [setViewport]);

  // Pan
  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    // Don't start pan on buttons/expand icons
    if (target.closest("button") !== null || target.closest(`.${styles["process-node-expand"]}`) !== null) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      viewportX: viewportRef.current.x,
      viewportY: viewportRef.current.y,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (panRef.current === null || panRef.current.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - panRef.current.clientX;
    const dy = event.clientY - panRef.current.clientY;
    setViewport({
      x: panRef.current.viewportX + dx,
      y: panRef.current.viewportY + dy,
      scale: viewportRef.current.scale,
    });
  }, [setViewport]);

  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
    }
  }, []);

  const handleReset = useCallback(() => {
    setViewport({ x: 22, y: 22, scale: 1 });
  }, [setViewport]);

  if (plan.roots.length === 0) {
    return <div>{t("productionPlanning.noRecipes")}</div>;
  }

  const totalWidth = (graph.maxCol + 1) * (CELL_WIDTH + COL_GAP) + NODE_PADDING * 2;
  const totalHeight = (graph.maxRow + 1) * CELL_HEIGHT + NODE_PADDING * 2;

  // Popup screen coordinates (outside the inner transform layer)
  const popupScreenX = expandedNodeCanvasX * viewport.scale + viewport.x;
  const popupScreenY = expandedNodeCanvasY * viewport.scale + viewport.y;

  return (
    <div
      className={styles["process-graph-canvas"]}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className={styles["process-graph-toolbar"]}>
        <button onClick={handleReset} title="Reset">
          <LucideRotateCcw />
        </button>
      </div>

      <div
        className={styles["process-graph-inner"]}
        style={{
          width: totalWidth,
          height: totalHeight,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <svg
          key={`${graph.maxCol}-${graph.maxRow}-${graph.links.length}`}
          className={styles["process-graph-svg"]}
          width={totalWidth}
          height={totalHeight}
        >
          {graph.links.map((link) => {
            const key = `${link.fromCol}:${link.fromRow}-${link.toCol}:${link.toRow}`;
            const fromX = nodeCenterX(link.fromCol) + CELL_WIDTH / 2;
            const fromY = nodeCenterY(link.fromRow);
            const toX = nodeCenterX(link.toCol) - CELL_WIDTH / 2;
            const toY = nodeCenterY(link.toRow);
            // Middle boundary column
            const boundaryX = nodeCenterX(link.boundaryCol) + CELL_WIDTH / 2 + COL_GAP / 2;

            // Orthogonal path: horizontal from -> boundary, vertical, horizontal boundary -> to
            const d = [
              `M ${fromX} ${fromY}`,
              `H ${boundaryX}`,
              `V ${toY}`,
              `H ${toX}`,
            ].join(" ");

            return (
              <path
                key={key}
                d={d}
                className={link.fromRow === link.toRow ? styles["is-main"] : undefined}
              />
            );
          })}
        </svg>

        {graph.nodes.map((node) => {
          const cx = nodeCenterX(node.col);
          const cy = nodeCenterY(node.row);
          const isExpandable = node.type === "secondary";
          const isCollapsible = expandedItemIds.has(node.itemId);
          const nodeKey = `${node.col}:${node.row}`;
          const hasRecipe = (node.recipeId ?? node.expandedRecipeId) !== null;
          return (
            <ProcessNodeCard
              key={nodeKey}
              node={node}
              cx={cx}
              cy={cy}
              isExpanded={isCollapsible}
              onToggle={(isExpandable || isCollapsible) ? () => handleToggle(node.itemId, node.col, node.row) : undefined}
              onDetailToggle={hasRecipe ? () => handleDetailToggle(nodeKey) : undefined}
            />
          );
        })}
      </div>

      {/* Detail popup — outside inner transform layer */}
      {detailExpandedNodeKey !== null && expandedNode !== null && (
        <div
          className={styles["process-detail-popup"]}
          style={{
            left: popupScreenX,
            top: popupScreenY,
            transformOrigin: "center center",
          }}
        >
          {expandedRecipeId !== null && (
            <div className={styles["process-detail-popup-formula"]}>
              <RecipeDisplay
                recipeId={expandedRecipeId}
                index={index}
                t={t}
                showDevice={false}
              />
            </div>
          )}
          {expandedDevice !== null && (
            <div className={styles["process-detail-popup-device"]}>
              <img
                alt=""
                src={createDeviceIconAssetUrl(expandedDevice.spriteId)}
              />
              <span>{t(expandedDevice.nameKey)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProcessNodeCard({
  node,
  cx,
  cy,
  isExpanded,
  onToggle,
  onDetailToggle,
}: {
  node: ProcessNode;
  cx: number;
  cy: number;
  isExpanded: boolean;
  onToggle?: () => void;
  onDetailToggle?: () => void;
}) {
  const classes = [
    styles["process-node"],
    node.type === "target" ? styles["is-target"] : "",
    node.type === "natural" ? styles["is-natural"] : "",
    node.type === "cycle" ? styles["is-cycle"] : "",
    node.type === "dangling" ? styles["is-dangling"] : "",
    onDetailToggle ? styles["has-detail"] : "",
  ]
    .filter(Boolean)
    .join(" ");

  const nodeWidth = Math.max(80, CELL_WIDTH - 8);

  return (
    <>
      <div
        className={classes}
        style={{
          left: cx - nodeWidth / 2,
          top: cy - CELL_HEIGHT / 2 + 2,
          width: nodeWidth,
          height: CELL_HEIGHT - 4,
        }}
        onClick={onDetailToggle}
      >
        <div className={styles["process-node-header"]}>
          <img alt="" src={node.iconSrc} />
          <span>{node.name}</span>
        </div>
      </div>
      {onToggle && (
        <div
          className={styles["process-node-expand"]}
          style={{
            left: nodeCenterX(node.col) - CELL_WIDTH / 2 - COL_GAP / 2 - 9,
            top: cy - 9,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {isExpanded ? <LucideChevronDown /> : <LucideChevronRight />}
        </div>
      )}
    </>
  );
}

function nodeCenterX(col: number): number {
  return NODE_PADDING + col * (CELL_WIDTH + COL_GAP);
}

function nodeCenterY(row: number): number {
  return NODE_PADDING + row * CELL_HEIGHT + CELL_HEIGHT / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeViewportState(value: ViewportState | undefined): ViewportState {
  return {
    x: typeof value?.x === "number" && Number.isFinite(value.x) ? value.x : 22,
    y: typeof value?.y === "number" && Number.isFinite(value.y) ? value.y : 22,
    scale: clamp(
      typeof value?.scale === "number" && Number.isFinite(value.scale) && value.scale > 0 ? value.scale : 1,
      MIN_SCALE,
      MAX_SCALE,
    ),
  };
}
