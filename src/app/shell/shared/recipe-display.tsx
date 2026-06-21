import { type CSSProperties, type ReactNode } from "react";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import LucideChevronsRight from "~icons/lucide/chevrons-right";
import styles from "./recipe-display.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

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
  variant?: "default" | "inspectorStatus";
  progressPercent?: number | null;
  progressKind?: "ring" | "bar";
  t: (key: string) => string;
}

function resolveItemIconSrc(itemId: string, index: RecipeDisplayIndex): string {
  const item = index.itemById.get(itemId);
  return `/item-icons/${item?.iconId ?? itemId}.webp`;
}

function resolveEntityIconSrc(entityId: string): string {
  return `/device-icons/${entityId}.webp`;
}

export function RecipeDisplay({
  recipeId,
  index,
  showDevice = false,
  variant = "default",
  progressPercent = null,
  progressKind = "ring",
  t,
}: RecipeDisplayProps): ReactNode {
  const recipe = index.recipeById.get(recipeId);
  if (recipe === undefined) return null;

  const machine = index.entityById.get(recipe.machineId) ?? null;

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
            <span key={`in-${input.itemId}`} className={cm(styles, "recipe-display-formula-item")}>
              {i > 0 && <span className={cm(styles, "recipe-display-formula-plus")}>+</span>}
              <span className={cm(styles, "recipe-display-formula-icon")}>
                <img alt="" src={resolveItemIconSrc(input.itemId, index)} />
                <span>{input.amount}</span>
              </span>
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
            <span key={`out-${output.itemId}`} className={cm(styles, "recipe-display-formula-item")}>
              {i > 0 && <span className={cm(styles, "recipe-display-formula-plus")}>+</span>}
              <span className={cm(styles, "recipe-display-formula-icon")}>
                <img alt="" src={resolveItemIconSrc(output.itemId, index)} />
                <span>{output.amount}</span>
              </span>
            </span>
          ))}
        </span>
      </div>
    );
  }

  const formula = (
    <div className={cm(styles, "recipe-display-formula")}>
      {recipe.inputs.map((input, i) => (
        <span key={`in-${input.itemId}`} className={cm(styles, "recipe-display-formula-item")}>
          {i > 0 && <span className={cm(styles, "recipe-display-formula-plus")}>+</span>}
          <span className={cm(styles, "recipe-display-formula-icon")}>
            <img alt="" src={resolveItemIconSrc(input.itemId, index)} />
            <span>{input.amount}</span>
          </span>
        </span>
      ))}
      <span className={cm(styles, "recipe-display-formula-arrow")}>
        <span>▶▶</span>
        <span>{recipe.durationSeconds}{t("productionPlanning.second_short")}</span>
      </span>
      {recipe.outputs.map((output) => (
        <span key={`out-${output.itemId}`} className={cm(styles, "recipe-display-formula-item")}>
          <span className={cm(styles, "recipe-display-formula-icon")}>
            <img alt="" src={resolveItemIconSrc(output.itemId, index)} />
            <span>{output.amount}</span>
          </span>
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
          src={machine === null ? "/device-icons/item_port_grinder_1.webp" : resolveEntityIconSrc(machine.id)}
        />
        <span>{machine === null ? recipe.machineId : t(machine.nameKey)}</span>
      </div>
      <span className={cm(styles, "recipe-display-device-colon")}>:</span>
      {formula}
    </div>
  );
}
