import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import LucideChevronRight from "~icons/lucide/chevron-right";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideRepeat from "~icons/lucide/repeat";
import LucideListTree from "~icons/lucide/list-tree";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

import {
  resolveProductionPlanningModuleIconSrcs,
  isWaterPurifierNodeRecipe,
  type ProductionPlanningDisplayMode,
  type ProductionPlanningIndex,
  type ProductionPlanningResult,
} from "../production-planning-model";
// AI-REMOVED 2026-09-01:
// Reason: 模块详情图标已统一由组合图标解析函数生成，不再在视图内分别判断实体与物品。
// Trigger: ESLint 检出组合图标接入后遗留的未使用导入。
// Evidence: expandedModuleIconSrcs 只调用 resolveProductionPlanningModuleIconSrcs。
// Replacement: resolveProductionPlanningModuleIconSrcs import
// Risk: Low
// Human Review: Required
//
// Original code:
// import { resolveProductionPlanningEntityIconSrc, resolveProductionPlanningItemIconSrc } from "../production-planning-model";
import { buildProcessGraph } from "./process-graph-builder";
import type { ProcessNode } from "./process-graph-model";
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";
import { CompositeItemIcon } from "@/app/shell/shared";
import { createEntityIconAssetUrl } from "@/shared/browser/public-asset-url";
import { resolveWheelZoomDirection } from "@/shared/browser/wheel-zoom";
import styles from "./process-graph.module.scss";

interface ProcessGraphViewProps {
  readonly plan: ProductionPlanningResult;
  readonly index: ProductionPlanningIndex;
  readonly recipeChoices: ReadonlyMap<string, string>;
  readonly externalItemIds: ReadonlySet<string>;
  readonly expandedBranchIds: ReadonlySet<string>;
  readonly displayMode: ProductionPlanningDisplayMode;
  readonly initialViewport?: ViewportState;
  readonly invertWheelZoom?: boolean;
  readonly onToggleBranch: (branchId: string) => void;
  readonly onCoverDemand: (itemId: string) => void;
  readonly onRemoveExternalSupply: (itemId: string) => void;
  readonly onRequestRecipeSelection: (itemId: string, recipes: readonly RecipeDefinition[]) => void;
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
  externalItemIds,
  expandedBranchIds,
  displayMode,
  initialViewport,
  invertWheelZoom = false,
  onToggleBranch,
  onCoverDemand,
  onRemoveExternalSupply,
  onRequestRecipeSelection,
  onViewportChange,
  t,
}: ProcessGraphViewProps) {
  const graph = useMemo(
    () => buildProcessGraph(plan, index, recipeChoices, expandedBranchIds, t, displayMode),
    [plan, index, recipeChoices, expandedBranchIds, t, displayMode],
  );

  const [viewport, setRawViewport] = useState<ViewportState>(
    () => normalizeViewportState(initialViewport),
  );
  const viewportRef = useRef(viewport);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
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
  const expandedCandidate = expandedNode?.candidateId === undefined
    ? undefined
    : index.candidateById.get(expandedNode.candidateId);
  const expandedRecipeId = expandedCandidate?.recipeId
    ?? expandedNode?.recipeId
    ?? expandedNode?.expandedRecipeId
    ?? null;
  const expandedRecipe = expandedRecipeId !== null ? index.recipeById.get(expandedRecipeId) ?? undefined : undefined;
  const expandedDevice = expandedRecipe !== undefined ? index.entityById.get(expandedRecipe.machineId) ?? null : null;
  const expandedModule = expandedCandidate?.module ?? null;
  const expandedModuleIconSrcs = expandedModule === null
    ? null
    : resolveProductionPlanningModuleIconSrcs(expandedModule, index);
  const expandedIsExternal = expandedNode !== null && externalItemIds.has(expandedNode.itemId);
  const expandedRecipes = expandedNode === null ? []
    : (index.recipesByOutputItem.get(expandedNode.itemId) ?? [])
      .filter((recipe) => !isWaterPurifierNodeRecipe(recipe));

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const popup = popupRef.current;
    if (canvas === null || popup === null) return;
    const position = () => {
      const halfWidth = popup.offsetWidth / 2;
      const halfHeight = popup.offsetHeight / 2;
      const x = expandedNodeCanvasX * viewport.scale + viewport.x;
      const y = expandedNodeCanvasY * viewport.scale + viewport.y;
      popup.style.left = `${clamp(x, halfWidth + 8, canvas.clientWidth - halfWidth - 8)}px`;
      popup.style.top = `${clamp(y, halfHeight + 8, canvas.clientHeight - halfHeight - 8)}px`;
    };
    position();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(position);
    observer.observe(canvas);
    observer.observe(popup);
    return () => observer.disconnect();
  }, [expandedNode, expandedNodeCanvasX, expandedNodeCanvasY, viewport]);

  const handleDetailToggle = useCallback((nodeKey: string) => {
    setDetailExpandedNodeKey((prev) => (prev === nodeKey ? null : nodeKey));
  }, []);

  // Viewport anchoring: keep the toggled node at the same screen position
  // AI-CORRECTION 2026-10-26：设置/移除原料也复用节点锚定，切断上游后保持被点击物品的位置。
  const anchorRef = useRef<{ itemId: string; branchId?: string; canvasX: number; canvasY: number } | null>(null);

  const anchorNode = useCallback((itemId: string, nodeCol: number, nodeRow: number, branchId?: string) => {
    // Record canvas position of the toggle button before the graph changes
    const canvasX = nodeCenterX(nodeCol) - CELL_WIDTH / 2 - COL_GAP / 2;
    const canvasY = nodeCenterY(nodeRow);
    anchorRef.current = { itemId, branchId, canvasX, canvasY };
  }, []);

  const handleToggle = useCallback((node: ProcessNode) => {
    if (node.branch === undefined) return;
    anchorNode(node.itemId, node.col, node.row, node.branch.id);
    onToggleBranch(node.branch.id);
  }, [anchorNode, onToggleBranch]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return;
    anchorRef.current = null;

    // Find the new position of the anchored item
    const anchoredNode = graph.nodes.find((n) => anchor.branchId === undefined
      ? n.itemId === anchor.itemId : n.branch?.id === anchor.branchId);
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
    if ((event.target as HTMLElement).closest(`.${styles["process-detail-popup"]}`)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const current = viewportRef.current;
    const direction = resolveWheelZoomDirection(event.deltaY, invertWheelZoom);
    if (direction === 0) return;
    const nextScale = clamp(current.scale + direction * 0.1, MIN_SCALE, MAX_SCALE);
    const ratio = nextScale / current.scale;
    setViewport({
      x: cx - ratio * (cx - current.x),
      y: cy - ratio * (cy - current.y),
      scale: nextScale,
    });
  }, [invertWheelZoom, setViewport]);

  // Pan
  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    // Don't start pan on buttons, expand icons, or clickable node cards
    if (
      target.closest("button") !== null
      || target.closest(`.${styles["process-detail-popup"]}`) !== null
      || target.closest(`.${styles["process-node-expand"]}`) !== null
      || target.closest(`.${styles["process-node"]}.${styles["has-detail"]}`) !== null
    ) {
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
      ref={canvasRef}
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
          const isDeviceNode = node.type === "device";
          // AI-REMOVED 2026-10-26:
          // Reason: 节点类型和物品 ID 展开标记不能证明存在可折叠子级。
          // Trigger: 终端箭头点击后只消失，主链与支线共用展开状态。
          // Evidence: 主链不读取展开列表，natural 终端也可能存在于旧展开集合。
          // Replacement: ProcessNode.branch。Risk: Low。Human Review: Required
          // Original code:
          // const isExpandable = node.type === "secondary";
          // const isCollapsible = expandedItemIds.has(node.itemId);
          const nodeKey = `${node.col}:${node.row}`;
          // AI-REMOVED 2026-10-26:
          // Reason: 无生产配方的原料节点也需要显示原料操作。
          // Trigger: 用户要求通过工序图设置原料。
          // Evidence: 原条件令自然资源和外供节点无法打开详情。
          // Replacement: 非设备节点均可打开详情。Risk: Low。Human Review: Required
          // Original code:
          // const hasRecipe = node.candidateId !== undefined || (node.recipeId ?? node.expandedRecipeId) !== null;
          // 设备节点不显示展开/收起和详情弹窗
          const showToggle = isDeviceNode ? undefined
            : node.branch !== undefined ? () => handleToggle(node)
            : undefined;
          const showDetail = isDeviceNode ? undefined
            : () => handleDetailToggle(nodeKey);
          return (
            <ProcessNodeCard
              key={node.branch?.id ?? nodeKey}
              node={node}
              cx={cx}
              cy={cy}
              isExpanded={node.branch?.expanded === true}
              onToggle={showToggle}
              toggleLabel={node.branch === undefined ? undefined : t(node.branch.expanded
                ? "productionPlanning.collapseBranch" : "productionPlanning.expandBranch").replace("{item}", node.name)}
              onDetailToggle={showDetail}
              materialLabel={externalItemIds.has(node.itemId) ? t("productionPlanning.supplies") : undefined}
            />
          );
        })}
      </div>

      {/* Detail popup — outside inner transform layer */}
      {detailExpandedNodeKey !== null && expandedNode !== null && (
        <div
          ref={popupRef}
          className={styles["process-detail-popup"]}
          role="dialog"
          aria-label={expandedNode.name}
          style={{
            left: popupScreenX,
            top: popupScreenY,
            transformOrigin: "center center",
          }}
        >
          <strong className={styles["process-detail-popup-title"]}>{expandedNode.name}</strong>
          <div className={styles["process-detail-popup-actions"]}>
            <button type="button" onClick={() => {
              anchorNode(expandedNode.itemId, expandedNode.col, expandedNode.row);
              setDetailExpandedNodeKey(null);
              if (expandedIsExternal) onRemoveExternalSupply(expandedNode.itemId);
              else onCoverDemand(expandedNode.itemId);
            }}>
              <LucideRepeat />
              <span>{t(expandedIsExternal ? "productionPlanning.removeExternalSupply" : "productionPlanning.coverDemand")}</span>
            </button>
            <button type="button" disabled={expandedRecipes.length <= 1} onClick={() => {
              setDetailExpandedNodeKey(null);
              onRequestRecipeSelection(expandedNode.itemId, expandedRecipes);
            }}>
              <LucideListTree />
              <span>{t("productionPlanning.chooseRecipe")}</span>
            </button>
          </div>
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
                src={createEntityIconAssetUrl(expandedDevice.iconPath)}
              />
              <span>{t(expandedDevice.nameKey)}</span>
            </div>
          )}
          {expandedModule !== null && expandedModuleIconSrcs !== null && (
            <div className={styles["process-detail-popup-device"]}>
              <CompositeItemIcon iconSrcs={expandedModuleIconSrcs} size={24} />
              <span>
                {expandedModule.name} · {t(
                  expandedModule.sourceType === "custom-module"
                    ? "moduleBalancing.customModules"
                    : "moduleBalancing.recommendedModules",
                )}
              </span>
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
  toggleLabel,
  onDetailToggle,
  materialLabel,
}: {
  node: ProcessNode;
  cx: number;
  cy: number;
  isExpanded: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
  onDetailToggle?: () => void;
  materialLabel?: string;
}) {
  const classes = [
    styles["process-node"],
    node.type === "target" ? styles["is-target"] : "",
    node.type === "natural" ? styles["is-natural"] : "",
    node.type === "cycle" ? styles["is-cycle"] : "",
    node.type === "device" ? styles["is-device"] : "",
    onDetailToggle ? styles["has-detail"] : "",
    materialLabel ? styles["is-material"] : "",
  ]
    .filter(Boolean)
    .join(" ");

  const nodeWidth = Math.max(80, CELL_WIDTH - 8);

  return (
    <>
      <div
        className={classes}
        role={onDetailToggle ? "button" : undefined}
        tabIndex={onDetailToggle ? 0 : undefined}
        aria-label={onDetailToggle ? node.name : undefined}
        style={{
          left: cx - nodeWidth / 2,
          top: cy - CELL_HEIGHT / 2 + 2,
          width: nodeWidth,
          height: CELL_HEIGHT - 4,
        }}
        onClick={onDetailToggle}
        onKeyDown={onDetailToggle ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onDetailToggle();
          }
        } : undefined}
      >
        <div className={styles["process-node-header"]}>
          <CompositeItemIcon iconSrcs={node.iconSrcs} size={24} />
          <span>{node.name}</span>
          {materialLabel && <span className={styles["process-node-material"]}>{materialLabel}</span>}
        </div>
      </div>
      {onToggle && (
        /* AI-REMOVED 2026-10-26:
        Reason: 旧 div 没有按钮语义、键盘支持或操作说明。
        Trigger: 用户无法识别圆形箭头用途，并要求有效的支线展开/收起。
        Evidence: 原节点只有 click handler，没有 title、aria-expanded 或可访问名称。
        Replacement: 下方带操作名称的原生 button。Risk: Low。Human Review: Required
        Original code:
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
        */
        <button
          type="button"
          className={styles["process-node-expand"]}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={isExpanded}
          style={{
            left: nodeCenterX(node.col) - CELL_WIDTH / 2 - COL_GAP / 2 - 12,
            top: cy - 12,
          }}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {isExpanded ? <LucideChevronDown /> : <LucideChevronRight />}
        </button>
      )}
    </>
  );
}

function nodeCenterX(col: number): number {
  // 2026-10-26：卡片按中心定位，首列需预留半张卡片宽度，避免左侧图标被裁掉。
  return NODE_PADDING + CELL_WIDTH / 2 + col * (CELL_WIDTH + COL_GAP);
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
