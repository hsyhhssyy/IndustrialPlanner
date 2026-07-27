import { type CSSProperties, type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const itemElements = useRef<Map<string, HTMLElement>>(new Map());

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
      setClickedItemId(null);
    };

    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [clickedItemId]);

  const handleItemClick = useCallback((itemId: string) => {
    setClickedItemId((prev) => {
      if (prev === itemId) {
        setHoverItemId(null);
        return null;
      }
      return itemId;
    });
  }, []);

  const handleItemEnter = useCallback((itemId: string) => {
    if (isTouch) return;
    setHoverItemId(itemId);
  }, [isTouch]);

  const handleItemLeave = useCallback((itemId: string) => {
    if (isTouch) return;
    setHoverItemId((prev) => (prev === itemId ? null : prev));
  }, [isTouch]);

  const recipe = index.recipeById.get(recipeId);
  if (recipe === undefined) return null;

  const machine = index.entityById.get(recipe.machineId) ?? null;

  const activeTooltipItemId = clickedItemId ?? hoverItemId;
  const activeTooltipItem = activeTooltipItemId !== null ? index.itemById.get(activeTooltipItemId) ?? null : null;

  const renderItemIcon = (itemId: string, amount: number, key: string) => {
    const isActive = activeTooltipItemId === itemId;
    return (
      <span
        key={key}
        className={cm(styles, "recipe-display-formula-item")}
        ref={(el) => {
          if (el !== null) {
            itemElements.current.set(itemId, el);
          } else {
            itemElements.current.delete(itemId);
          }
        }}
        onMouseEnter={() => handleItemEnter(itemId)}
        onMouseLeave={() => handleItemLeave(itemId)}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          handleItemClick(itemId);
        }}
      >
        <span className={cm(styles, "recipe-display-formula-icon")}>
          <img alt="" src={resolveItemIconSrc(itemId, index)} />
          <span>{amount}</span>
        </span>
        {isActive && activeTooltipItem !== null ? (
          <div
            ref={tooltipRef}
            className={cm(styles, "recipe-display-item-tooltip")}
          >
            <img alt="" src={resolveItemIconSrc(activeTooltipItem.id, index)} />
            <span>{t(activeTooltipItem.nameKey)}</span>
          </div>
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
