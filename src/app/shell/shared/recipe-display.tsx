import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import LucideChevronsRight from "~icons/lucide/chevrons-right";
import styles from "./recipe-display.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createDeviceIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";

/** 配方展示所需的最小索引，同时被 ProductionPlanningIndex 和 ModuleBalancingIndex 满足 */
export interface RecipeDisplayIndex {
  itemById: Map<string, ItemDefinition>;
  entityById: Map<string, EntityDefinition>;
  recipeById: Map<string, RecipeDefinition>;
}

export interface RecipeDisplayProps {
  recipeId: string;
  index: RecipeDisplayIndex;
  /** 是否显示设备图标和名称，默认 false */
  showDevice?: boolean;
  variant?: "default" | "inspectorStatus" | "moduleLibrary";
  progressPercent?: number | null;
  progressKind?: "ring" | "bar";
  /** 是否为触屏设备，触屏时禁用 hover 触发，仅保留 click toggle */
  isTouch?: boolean;
  t: (key: string) => string;
}

interface RecipeTooltipPosition {
  readonly itemId: string;
  readonly left: number;
  readonly top: number;
}

const RECIPE_TOOLTIP_GAP = 4;
const RECIPE_TOOLTIP_VIEWPORT_PADDING = 8;

function resolveRecipeTooltipPosition(
  anchorRect: DOMRect,
  tooltipRect: DOMRect,
): Pick<RecipeTooltipPosition, "left" | "top"> {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = Math.max(
    RECIPE_TOOLTIP_VIEWPORT_PADDING,
    viewportWidth - RECIPE_TOOLTIP_VIEWPORT_PADDING - tooltipRect.width,
  );
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
  const left = Math.min(
    maxLeft,
    Math.max(RECIPE_TOOLTIP_VIEWPORT_PADDING, centeredLeft),
  );
  const spaceAbove = anchorRect.top - RECIPE_TOOLTIP_GAP - RECIPE_TOOLTIP_VIEWPORT_PADDING;
  const spaceBelow = viewportHeight
    - anchorRect.bottom
    - RECIPE_TOOLTIP_GAP
    - RECIPE_TOOLTIP_VIEWPORT_PADDING;
  const placeBelow = spaceBelow >= tooltipRect.height || spaceBelow >= spaceAbove;
  const preferredTop = placeBelow
    ? anchorRect.bottom + RECIPE_TOOLTIP_GAP
    : anchorRect.top - RECIPE_TOOLTIP_GAP - tooltipRect.height;
  const maxTop = Math.max(
    RECIPE_TOOLTIP_VIEWPORT_PADDING,
    viewportHeight - RECIPE_TOOLTIP_VIEWPORT_PADDING - tooltipRect.height,
  );
  const top = Math.min(
    maxTop,
    Math.max(RECIPE_TOOLTIP_VIEWPORT_PADDING, preferredTop),
  );

  return { left, top };
}

function resolveItemIconSrc(itemId: string, index: RecipeDisplayIndex): string {
  const item = index.itemById.get(itemId);
  return createItemIconAssetUrl(item?.iconId ?? itemId);
}

function resolveEntityIconSrc(definition: EntityDefinition): string {
  return createDeviceIconAssetUrl(definition.spriteId);
}

export function RecipeDisplay({
  recipeId,
  index,
  showDevice = false,
  variant = "default",
  progressPercent = null,
  progressKind = "ring",
  isTouch = false,
  t,
}: RecipeDisplayProps): ReactNode {
  const [hoverItemId, setHoverItemId] = useState<string | null>(null);
  const [clickedItemId, setClickedItemId] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<RecipeTooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const itemElements = useRef<Map<string, HTMLElement>>(new Map());
  const hoverItemElementRef = useRef<HTMLElement | null>(null);
  const clickedItemElementRef = useRef<HTMLElement | null>(null);

  // 点击外部关闭 tooltip
  useEffect(() => {
    if (clickedItemId === null) return;

    const handler = (e: PointerEvent) => {
      const tooltipEl = tooltipRef.current;
      const itemEl = itemElements.current.get(clickedItemId);
      const target = e.target as Node | null;
      if (target === null) return;
      // 点击在 tooltip 内 → 不关闭
      if (tooltipEl?.contains(target)) return;
      // 点击在触发 item 上 → 不关闭，交给 item 的 onClick 处理 toggle
      if (itemEl?.contains(target)) return;
      clickedItemElementRef.current = null;
      setClickedItemId(null);
    };

    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [clickedItemId]);

  const handleItemClick = useCallback((itemId: string, itemElement: HTMLElement) => {
    setClickedItemId((prev) => {
      if (prev === itemId) {
        clickedItemElementRef.current = null;
        hoverItemElementRef.current = null;
        setHoverItemId(null);
        return null;
      }
      clickedItemElementRef.current = itemElement;
      return itemId;
    });
  }, []);

  const handleItemEnter = useCallback((itemId: string, itemElement: HTMLElement) => {
    if (isTouch) return;
    hoverItemElementRef.current = itemElement;
    setHoverItemId(itemId);
  }, [isTouch]);

  const handleItemLeave = useCallback((itemId: string) => {
    if (isTouch) return;
    setHoverItemId((prev) => {
      if (prev !== itemId) return prev;
      hoverItemElementRef.current = null;
      return null;
    });
  }, [isTouch]);

  const recipe = index.recipeById.get(recipeId);
  const activeTooltipItemId = clickedItemId ?? hoverItemId;
  const activeTooltipItem = activeTooltipItemId !== null ? index.itemById.get(activeTooltipItemId) ?? null : null;

  useLayoutEffect(() => {
    if (activeTooltipItemId === null || activeTooltipItem === null) return;

    const updateTooltipPosition = () => {
      const anchorElement = clickedItemId === null
        ? hoverItemElementRef.current
        : clickedItemElementRef.current;
      const tooltipElement = tooltipRef.current;
      if (anchorElement === null || tooltipElement === null) return;

      const nextPosition = resolveRecipeTooltipPosition(
        anchorElement.getBoundingClientRect(),
        tooltipElement.getBoundingClientRect(),
      );
      setTooltipPosition((current) =>
        current?.itemId === activeTooltipItemId
          && current.left === nextPosition.left
          && current.top === nextPosition.top
          ? current
          : {
              itemId: activeTooltipItemId,
              ...nextPosition,
            },
      );
    };

    updateTooltipPosition();
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);
    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [activeTooltipItem, activeTooltipItemId, clickedItemId]);

  if (recipe === undefined) return null;

  const machine = index.entityById.get(recipe.machineId) ?? null;

  const renderItemIcon = (itemId: string, amount: number, key: string) => {
    const isActive = activeTooltipItemId === itemId;
    return (
      <span
        key={key}
        className={cm(styles, "recipe-display-formula-item")}
        data-recipe-item-id={itemId}
        ref={(el) => {
          if (el !== null) {
            itemElements.current.set(itemId, el);
          } else {
            itemElements.current.delete(itemId);
          }
        }}
        onMouseEnter={(event) => handleItemEnter(itemId, event.currentTarget)}
        onMouseLeave={() => handleItemLeave(itemId)}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          handleItemClick(itemId, e.currentTarget);
        }}
      >
        <span className={cm(styles, "recipe-display-formula-icon")}>
          <img alt="" src={resolveItemIconSrc(itemId, index)} />
          <span>{amount}</span>
        </span>
        {isActive && activeTooltipItem !== null ? (
          createPortal(
            <div
              ref={tooltipRef}
              className={cm(styles, "recipe-display-item-tooltip")}
              data-recipe-item-tooltip
              role="tooltip"
              style={{
                left: tooltipPosition?.itemId === activeTooltipItemId
                  ? `${tooltipPosition.left}px`
                  : "0px",
                top: tooltipPosition?.itemId === activeTooltipItemId
                  ? `${tooltipPosition.top}px`
                  : "0px",
                visibility: tooltipPosition?.itemId === activeTooltipItemId
                  ? "visible"
                  : "hidden",
              }}
            >
              <img alt="" src={resolveItemIconSrc(activeTooltipItem.id, index)} />
              <span>{t(activeTooltipItem.nameKey)}</span>
            </div>,
            document.body,
          )
        ) : null}
      </span>
    );
  };

  if (variant === "inspectorStatus") {
    const progressStyle = progressPercent === null
      ? undefined
      : ({
        "--recipe-progress-deg": `${Math.max(0, Math.min(100, progressPercent)) * 3.6}deg`,
        "--recipe-progress-percent": `${Math.max(0, Math.min(100, progressPercent))}%`,
      } as CSSProperties);

    return (
      <div className={cm(styles, "recipe-display-formula recipe-display-formula-inspector")}>
        <span className={cm(styles, "recipe-display-formula-group")}>
          {recipe.inputs.map((input, i) => (
            <span key={`in-${input.itemId}`} className={cm(styles, "recipe-display-formula-item-group")}>
              {i > 0 && <span className={cm(styles, "recipe-display-formula-plus")}>+</span>}
              {renderItemIcon(input.itemId, input.amount, `in-${input.itemId}`)}
            </span>
          ))}
        </span>
        <span
          className={cm(styles, "recipe-display-formula-progress")}
          data-progress-kind={progressKind}
          data-progress-empty={progressPercent === null ? "true" : "false"}
          style={progressStyle}
        >
          <LucideChevronsRight aria-hidden="true" />
        </span>
        <span className={cm(styles, "recipe-display-formula-group")}>
          {recipe.outputs.map((output, i) => (
            <span key={`out-${output.itemId}`} className={cm(styles, "recipe-display-formula-item-group")}>
              {i > 0 && <span className={cm(styles, "recipe-display-formula-plus")}>+</span>}
              {renderItemIcon(output.itemId, output.amount, `out-${output.itemId}`)}
            </span>
          ))}
        </span>
      </div>
    );
  }

  const formula = (
    <div className={cm(styles, `recipe-display-formula${variant === "moduleLibrary" ? " recipe-display-formula-module-library" : ""}`)}>
      {recipe.inputs.map((input, i) => (
        <span key={`in-${input.itemId}`} className={cm(styles, "recipe-display-formula-item-group")}>
          {i > 0 && <span className={cm(styles, "recipe-display-formula-plus")}>+</span>}
          {renderItemIcon(input.itemId, input.amount, `in-${input.itemId}`)}
        </span>
      ))}
      <span className={cm(styles, "recipe-display-formula-arrow")}>
        <span>▶▶</span>
        <span>{recipe.durationSeconds}{t("productionPlanning.second_short")}</span>
      </span>
      {recipe.outputs.map((output, i) => (
        <span key={`out-${output.itemId}`} className={cm(styles, "recipe-display-formula-item-group")}>
          {i > 0 && <span className={cm(styles, "recipe-display-formula-plus")}>+</span>}
          {renderItemIcon(output.itemId, output.amount, `out-${output.itemId}`)}
        </span>
      ))}
    </div>
  );

  if (!showDevice) return formula;

  return (
    <div className={cm(styles, "recipe-display")}>
      <div className={cm(styles, "recipe-display-device")}>
        <img
          alt=""
          src={machine === null ? createDeviceIconAssetUrl("item_port_grinder_1") : resolveEntityIconSrc(machine)}
        />
        <span>{machine === null ? recipe.machineId : t(machine.nameKey)}</span>
      </div>
      <span className={cm(styles, "recipe-display-device-colon")}>:</span>
      {formula}
    </div>
  );
}
