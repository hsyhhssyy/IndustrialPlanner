import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { observer, useLocalObservable } from "mobx-react-lite";
import LucideBox from "~icons/lucide/box";
import LucideBoxes from "~icons/lucide/boxes";
import LucideClock3 from "~icons/lucide/clock-3";
import LucideArrowLeft from "~icons/lucide/arrow-left";
import LucideCalculator from "~icons/lucide/calculator";
import LucideFactory from "~icons/lucide/factory";
import LucideGauge from "~icons/lucide/gauge";
import LucideInfinity from "~icons/lucide/infinity";
import LucideListTree from "~icons/lucide/list-tree";
import LucidePackagePlus from "~icons/lucide/package-plus";
import LucidePlus from "~icons/lucide/plus";
import LucideTarget from "~icons/lucide/target";
import LucideRepeat from "~icons/lucide/repeat";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideWorkflow from "~icons/lucide/workflow";

import type { AppHost } from "@/app/host/app-host";
import type { PlannerFlowViewportState } from "@/shared/storage/planner-storage";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import {
  BELT_TRANSPORT_DURATION_SECONDS,
  PIPE_TRANSPORT_DURATION_SECONDS,
} from "@/domain/registry";
import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  createProductionPlanningId,
  formatProductionDeviceCount,
  formatProductionFlow,
  isRecipeExcludedFromProductionPlanningAuto,
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  resolveProductionPlanningRecipeName,
  type ProductionPlanningByproductPolicy,
  type ProductionPlanningDisplayMode,
  type ProductionPlanningIndex,
  type ProductionPlanningItemNode,
  type ProductionPlanningPort,
  type ProductionPlanningRecipeNode,
  type ProductionPlanningResult,
  type ProductionPlanningSewagePolicy,
  type ProductionPlanningSourceConfig,
  type ProductionPlanningViewMode,
} from "@/app/shell/production-planning/production-planning-model";
import { ProductionFlowGraph } from "@/app/shell/production-planning/flow";
import { ProductionPlanningInputStore } from "./production-planning-state";
import { hookPlannerIndexedDbPersistence } from "./production-planning-persist";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type ProductionPlanningScreen = "input" | "result";

type ProductionPlanningCalculation = {
  readonly targets: readonly ProductionPlanningPort[];
  readonly supplies: readonly ProductionPlanningPort[];
  readonly infiniteItemIds: ReadonlySet<string>;
  readonly recipeChoices: Readonly<Record<string, string>>;
  readonly sourceConfig: ProductionPlanningSourceConfig;
  readonly plan: ProductionPlanningResult;
};

type ProductionPlanningSwipeState = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
};

type ProductionPlanningTreeRow = ProductionPlanningTreeItemRow | ProductionPlanningTreeRecipeRow;

type ProductionPlanningTreeRowBase = {
  readonly id: string;
  readonly depth: number;
  readonly parentIds: readonly string[];
  readonly childIds: readonly string[];
};

type ProductionPlanningTreeItemRow = ProductionPlanningTreeRowBase & {
  readonly kind: "item";
  readonly itemId: string;
  readonly node: ProductionPlanningItemNode;
  readonly nodes: readonly ProductionPlanningItemNode[];
  readonly total: ProductionPlanningResult["itemTotals"][number] | null;
  readonly producerIds: readonly string[];
  readonly consumerIds: readonly string[];
  readonly isByproduct: boolean;
};

type ProductionPlanningTreeRecipeRow = ProductionPlanningTreeRowBase & {
  readonly kind: "recipe";
  readonly recipeId: string;
  readonly targetItemId: string;
  readonly recipeNode: ProductionPlanningRecipeNode;
  readonly recipeNodes: readonly ProductionPlanningRecipeNode[];
  readonly total: ProductionPlanningResult["recipeTotals"][number] | null;
  readonly inputItemIds: readonly string[];
  readonly outputItemIds: readonly string[];
  readonly isByproduct: boolean;
};

const PRODUCTION_PLANNING_EPSILON = 0.0001;
const EXTERNAL_SUPPLY_RECIPE_ID_PREFIX = "external-supply:";
const EXTERNAL_SUPPLY_ENTITY_ID = "item_port_sp_hub_1";

export const ProductionPlanningPanel = observer(function ProductionPlanningPanel({
  appHost,
  isTouch,
}: {
  appHost: AppHost;
  isTouch: boolean;
}) {
  const t = appHost.actions.translate;
  const index = useMemo(
    () => buildProductionPlanningIndex(appHost.workspace.registry),
    [appHost.workspace.registry],
  );
  const store = useLocalObservable(() => new ProductionPlanningInputStore());
  useEffect(() => hookPlannerIndexedDbPersistence(store), [store]);
  const {
    targets,
    supplies,
    displayMode,
    viewMode,
    recipeChoices,
    sourceConfig,
    session,
    hydrated,
  } = store;
  // AI-REMOVED 2026-05-21:
  // Reason: 页面位置需要跟产线规划会话一起持久化，不能继续只放在组件内存状态。
  // Trigger: 用户要求关闭后再打开恢复上次处于输入页还是计算结果页。
  // Evidence: Search-First 显示现有 IndexedDB planner-state 已持久化输入、展示模式和视图模式，但 activeScreen 仍是本地 useState。
  // Replacement: ProductionPlanningInputStore.session.activeScreen
  // Risk: Low；计算结果仍由持久化输入重新计算，不直接持久化 plan。
  // Human Review: Required
  //
  // Original code:
  // const [activeScreen, setActiveScreen] = useState<ProductionPlanningScreen>("input");
  const activeScreen = session.activeScreen;
  const [calculation, setCalculation] = useState<ProductionPlanningCalculation | null>(null);
  const swipeStateRef = useRef<ProductionPlanningSwipeState | null>(null);
  // AI-CORRECTION 2026-05-22:
  // 自然资源不再从 infiniteItemIds 补齐；缺失时走 null 配方（矿机/水泵）生产。
  // infiniteItemIds 现在仅包含 external-supply 模式下的污水。
  const infiniteItemIds = useMemo(() => {
    const result = new Set<string>();
    if (sourceConfig.sewagePolicy === "external-supply") {
      result.add("item_liquid_sewage");
    }
    return result;
  }, [sourceConfig.sewagePolicy]);
  const resultRecipeChoiceMap = useMemo(
    () => new Map(Object.entries(calculation?.recipeChoices ?? recipeChoices)),
    [calculation?.recipeChoices, recipeChoices],
  );

  const setActiveScreen = (nextScreen: ProductionPlanningScreen) => {
    if (store.session.activeScreen === nextScreen) {
      return;
    }

    store.session = { ...store.session, activeScreen: nextScreen };
  };

  const setFlowViewport = (flowViewport: PlannerFlowViewportState) => {
    store.session = { ...store.session, flowViewport };
  };

  const setTreeScrollTop = (scrollTop: number) => {
    const treeScrollTop = Math.max(0, scrollTop);
    if (store.session.treeScrollTop === treeScrollTop) {
      return;
    }

    store.session = { ...store.session, treeScrollTop };
  };

  useEffect(() => {
    if (!hydrated || activeScreen !== "result" || calculation !== null) {
      return;
    }

    if (targets.length === 0) {
      store.session = { ...store.session, activeScreen: "input" };
      return;
    }

    const calculationTargets = targets.map(clonePort);
    const calculationSupplies = supplies.map(clonePort);
    const calculationInfiniteItemIds = new Set(infiniteItemIds);
    const calculationRecipeChoices = { ...recipeChoices };
    const calculationSourceConfig: ProductionPlanningSourceConfig = {
      waterPolicy: sourceConfig.waterPolicy,
      acidPolicy: sourceConfig.acidPolicy,
      sewagePolicy: sourceConfig.sewagePolicy,
    };
    const plan = computeProductionPlan({
      targets: calculationTargets,
      supplies: calculationSupplies,
      infiniteItemIds: calculationInfiniteItemIds,
      recipeChoices: new Map(Object.entries(calculationRecipeChoices)),
      sourceConfig: calculationSourceConfig,
    }, index);

    setCalculation({
      targets: calculationTargets,
      supplies: calculationSupplies,
      infiniteItemIds: calculationInfiniteItemIds,
      recipeChoices: calculationRecipeChoices,
      sourceConfig: calculationSourceConfig,
      plan,
    });
  }, [
    activeScreen,
    calculation,
    hydrated,
    index,
    infiniteItemIds,
    recipeChoices,
    sourceConfig.acidPolicy,
    sourceConfig.sewagePolicy,
    sourceConfig.waterPolicy,
    store,
    supplies,
    targets,
  ]);

  const requestItemSelection = async (onSelect: (itemId: string) => void) => {
    const itemId = await appHost.encyclopediaPicker.pickItem({
      title: t("encyclopediaPicker.title.item"),
    });

    if (itemId !== null) {
      onSelect(itemId);
    }
  };

  const addTarget = () => {
    void requestItemSelection((itemId) => {
      store.targets = [...store.targets, createPort(itemId, 60)];
    });
  };

  const addSupply = () => {
    void requestItemSelection((itemId) => {
      store.supplies = [...store.supplies, createPort(itemId, 60)];
    });
  };

  const updateTarget = (id: string, patch: Partial<ProductionPlanningPort>) => {
    store.targets = updatePort(store.targets, id, patch);
  };

  const updateSupply = (id: string, patch: Partial<ProductionPlanningPort>) => {
    store.supplies = updatePort(store.supplies, id, patch);
  };

  const toggleSupplyInfinite = (id: string, isInfinite: boolean) => {
    const supply = store.supplies.find((line) => line.id === id);
    if (supply === undefined || index.naturalResourceItemIds.has(supply.itemId)) {
      return;
    }

    updateSupply(id, { isInfinite });
  };

  const selectRecipe = (itemId: string, recipeId: string | null) => {
    const nextRecipeChoices = updateRecipeChoices(store.recipeChoices, itemId, recipeId);
    store.recipeChoices = nextRecipeChoices;
    setCalculation((current) => {
      if (current === null) {
        return null;
      }

      const nextPlan = computeProductionPlan({
        targets: current.targets,
        supplies: current.supplies,
        infiniteItemIds: current.infiniteItemIds,
        recipeChoices: new Map(Object.entries(nextRecipeChoices)),
        sourceConfig: current.sourceConfig,
      }, index);

      return {
        ...current,
        recipeChoices: nextRecipeChoices,
        plan: nextPlan,
      };
    });
  };

  const handleCoverDemand = (itemId: string) => {
    const demandPerMinute = calculation?.plan.itemTotals.find((t) => t.itemId === itemId)?.demandPerMinute ?? 0;
    if (demandPerMinute <= 0) {
      return;
    }

    store.supplies = [...store.supplies, createPort(itemId, demandPerMinute)];
    setCalculation((current) => {
      if (current === null) {
        return null;
      }

      const nextPlan = computeProductionPlan({
        targets: current.targets,
        supplies: store.supplies,
        infiniteItemIds: current.infiniteItemIds,
        recipeChoices: new Map(Object.entries(current.recipeChoices)),
        sourceConfig: current.sourceConfig,
      }, index);

      return {
        ...current,
        supplies: store.supplies,
        plan: nextPlan,
      };
    });
  };

  const handleRemoveExternalSupply = (itemId: string) => {
    store.supplies = store.supplies.filter((s) => s.itemId !== itemId);
    setCalculation((current) => {
      if (current === null) {
        return null;
      }

      const nextPlan = computeProductionPlan({
        targets: current.targets,
        supplies: store.supplies,
        infiniteItemIds: current.infiniteItemIds,
        recipeChoices: new Map(Object.entries(current.recipeChoices)),
        sourceConfig: current.sourceConfig,
      }, index);

      return {
        ...current,
        supplies: store.supplies,
        plan: nextPlan,
      };
    });
  };

  const updateSourceConfig = (patch: Partial<ProductionPlanningSourceConfig>) => {
    store.sourceConfig = { ...store.sourceConfig, ...patch };
  };

  const calculate = () => {
    const calculationTargets = targets.map(clonePort);
    const calculationSupplies = supplies.map(clonePort);
    const calculationInfiniteItemIds = new Set(infiniteItemIds);
    const calculationRecipeChoices = { ...recipeChoices };
    const calculationSourceConfig: ProductionPlanningSourceConfig = {
      waterPolicy: sourceConfig.waterPolicy,
      acidPolicy: sourceConfig.acidPolicy,
      sewagePolicy: sourceConfig.sewagePolicy,
    };
    const plan = computeProductionPlan({
      targets: calculationTargets,
      supplies: calculationSupplies,
      infiniteItemIds: calculationInfiniteItemIds,
      recipeChoices: new Map(Object.entries(calculationRecipeChoices)),
      sourceConfig: calculationSourceConfig,
    }, index);

    setCalculation({
      targets: calculationTargets,
      supplies: calculationSupplies,
      infiniteItemIds: calculationInfiniteItemIds,
      recipeChoices: calculationRecipeChoices,
      sourceConfig: calculationSourceConfig,
      plan,
    });
    setActiveScreen("result");
  };

  const handleSwipePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isTouch || event.pointerType !== "touch" || shouldIgnoreProductionPlanningSwipeStart(event.target)) {
      return;
    }

    swipeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleSwipePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const state = swipeStateRef.current;
    swipeStateRef.current = null;

    if (!isTouch || event.pointerId !== state?.pointerId) {
      return;
    }

    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) {
      return;
    }

    if (deltaX < 0 && activeScreen === "input" && store.targets.length > 0) {
      calculate();
    } else if (deltaX > 0 && activeScreen === "result") {
      setActiveScreen("input");
    }
  };

  const handleSwipePointerCancel = () => {
    swipeStateRef.current = null;
  };

  const panelClassName = [
    "production-planning-panel",
    activeScreen === "result" ? "is-result-screen" : "is-input-screen",
    isTouch ? "is-touch" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={cm(styles, panelClassName)}
      onPointerDown={handleSwipePointerDown}
      onPointerUp={handleSwipePointerUp}
      onPointerCancel={handleSwipePointerCancel}
    >
      <div className={cm(styles, "production-planning-stage")}>
        <section className={cm(styles, "production-planning-screen production-planning-input-screen")}>
          <div className={cm(styles, "production-planning-config")}>
            <LineSection
              icon={<LucideTarget />}
              title={t("productionPlanning.targets")}
              addLabel={t("productionPlanning.addTarget")}
              lines={targets}
              index={index}
              onAdd={addTarget}
              onPickItem={(id) => {
                void requestItemSelection((itemId) => updateTarget(id, { itemId }));
              }}
              onRemove={(id) => { store.targets = store.targets.filter((line) => line.id !== id); }}
              onUpdateRate={(id, perMinute) => updateTarget(id, { perMinute })}
              t={t}
            />
            <LineSection
              icon={<LucidePackagePlus />}
              title={t("productionPlanning.supplies")}
              addLabel={t("productionPlanning.addSupply")}
              lines={supplies}
              index={index}
              onAdd={addSupply}
              onPickItem={(id) => {
                void requestItemSelection((itemId) => updateSupply(id, {
                  itemId,
                  ...(index.naturalResourceItemIds.has(itemId) ? { isInfinite: false } : {}),
                }));
              }}
              onRemove={(id) => { store.supplies = store.supplies.filter((line) => line.id !== id); }}
              onUpdateRate={(id, perMinute) => updateSupply(id, { perMinute })}
              onToggleInfinite={toggleSupplyInfinite}
              canToggleInfinite
              t={t}
            />
            <SourcePolicyPanel
              index={index}
              sourceConfig={sourceConfig}
              onUpdate={updateSourceConfig}
              t={t}
            />
          </div>
          <div className={cm(styles, "production-planning-input-footer")}>
            <button
              type="button"
              className={cm(styles, "production-planning-primary-button")}
              disabled={targets.length === 0}
              onClick={calculate}
            >
              <LucideCalculator />
              <span>{t("productionPlanning.calculate")}</span>
            </button>
          </div>
        </section>

        <section className={cm(styles, "production-planning-screen production-planning-workspace")}>
          <div className={cm(styles, "production-planning-toolbar")}>
            <button
              type="button"
              className={cm(styles, "production-planning-back-button")}
              onClick={() => setActiveScreen("input")}
            >
              <LucideArrowLeft />
              <span>{t("productionPlanning.modify")}</span>
            </button>
            <div className={cm(styles, "production-planning-toolbar-controls")}>
              <SegmentedControl<ProductionPlanningDisplayMode>
                label={t("productionPlanning.displayMode")}
                value={displayMode}
                options={[
                  { value: "item", label: t("productionPlanning.modeItem"), icon: <LucideBox /> },
                  { value: "device", label: t("productionPlanning.modeDevice"), icon: <LucideFactory /> },
                ]}
                onChange={(v) => { store.displayMode = v; }}
              />
              <SegmentedControl<ProductionPlanningViewMode>
                label={t("productionPlanning.viewMode")}
                value={viewMode}
                options={[
                  { value: "tree", label: t("productionPlanning.viewTree"), icon: <LucideListTree /> },
                  { value: "flow", label: t("productionPlanning.viewFlow"), icon: <LucideWorkflow /> },
                ]}
                onChange={(v) => { store.viewMode = v; }}
              />
            </div>
          </div>

          <div className={cm(styles, "production-planning-main")}>
            <div className={cm(styles, "production-planning-graph", viewMode === "tree" ? "is-tree-view" : "is-flow-view")}>
              {calculation === null ? (
                <div className={cm(styles, "production-planning-empty")}>{t("productionPlanning.noResult")}</div>
              ) : (
                <PlanGraph
                  displayMode={displayMode}
                  flowViewport={session.flowViewport}
                  viewMode={viewMode}
                  plan={calculation.plan}
                  index={index}
                  recipeChoices={resultRecipeChoiceMap}
                  treeScrollTop={session.treeScrollTop}
                  onFlowViewportChange={setFlowViewport}
                  onSelectRecipe={selectRecipe}
                  onCoverDemand={handleCoverDemand}
                  onRemoveExternalSupply={handleRemoveExternalSupply}
                  onTreeScrollTopChange={setTreeScrollTop}
                  t={t}
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
});

function LineSection({
  icon,
  title,
  addLabel,
  lines,
  index,
  onAdd,
  onPickItem,
  onRemove,
  onUpdateRate,
  onToggleInfinite,
  canToggleInfinite = false,
  t,
}: {
  icon: ReactNode;
  title: string;
  addLabel: string;
  lines: readonly ProductionPlanningPort[];
  index: ProductionPlanningIndex;
  onAdd: () => void;
  onPickItem: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdateRate: (id: string, perMinute: number) => void;
  onToggleInfinite?: (id: string, isInfinite: boolean) => void;
  canToggleInfinite?: boolean;
  t: (key: string) => string;
}) {
  return (
    <section className={cm(styles, "production-planning-config-section")}>
      <div className={cm(styles, "production-planning-section-header")}>
        <h3>{icon}<span>{title}</span></h3>
        <button type="button" className={cm(styles, "production-planning-icon-text-button")} onClick={onAdd}>
          <LucidePlus />
          <span>{addLabel}</span>
        </button>
      </div>
      <div className={cm(styles, "production-planning-line-list")}>
        {lines.length === 0 ? (
          <p className={cm(styles, "production-planning-muted")}>{t("productionPlanning.emptyLines")}</p>
        ) : lines.map((line) => (
          <PortEditorRow
            key={line.id}
            line={line}
            index={index}
            onPickItem={() => onPickItem(line.id)}
            onRemove={() => onRemove(line.id)}
            onUpdateRate={(perMinute) => onUpdateRate(line.id, perMinute)}
            onToggleInfinite={onToggleInfinite === undefined ? undefined : (isInfinite) => onToggleInfinite(line.id, isInfinite)}
            canToggleInfinite={canToggleInfinite}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function PortEditorRow({
  line,
  index,
  onPickItem,
  onRemove,
  onUpdateRate,
  onToggleInfinite,
  canToggleInfinite = false,
  t,
}: {
  line: ProductionPlanningPort;
  index: ProductionPlanningIndex;
  onPickItem: () => void;
  onRemove: () => void;
  onUpdateRate: (perMinute: number) => void;
  onToggleInfinite?: (isInfinite: boolean) => void;
  canToggleInfinite?: boolean;
  t: (key: string) => string;
}) {
  const isNaturalResource = index.naturalResourceItemIds.has(line.itemId);
  const isInfinite = canToggleInfinite && !isNaturalResource && line.isInfinite === true;
  const rowClassName = [
    "production-planning-line-row",
    canToggleInfinite ? "has-infinite-toggle" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={cm(styles, rowClassName)}>
      <button
        type="button"
        className={cm(styles, "production-planning-item-picker-button")}
        onClick={onPickItem}
      >
        <img alt="" src={resolveProductionPlanningItemIconSrc(line.itemId, index)} />
        <span>{resolveProductionPlanningItemName(line.itemId, index, t)}</span>
      </button>
      <label className={cm(styles, "production-planning-rate-input")}>
        <span>{t("productionPlanning.perMinute")}</span>
        <input
          type={isInfinite ? "text" : "number"}
          min={isInfinite ? undefined : "0"}
          step={isInfinite ? undefined : "0.01"}
          value={isInfinite ? "∞" : line.perMinute}
          disabled={isInfinite}
          onChange={(event) => onUpdateRate(normalizeFlowInput(event.currentTarget.value))}
        />
      </label>
      {canToggleInfinite && (
        <button
          type="button"
          className={cm(styles, [
            "production-planning-icon-button production-planning-infinite-toggle",
            isInfinite ? "is-active" : "",
          ].filter(Boolean).join(" "))}
          aria-label={t("productionPlanning.infinite")}
          aria-pressed={isInfinite}
          title={isNaturalResource ? t("productionPlanning.infiniteNaturalDisabled") : t("productionPlanning.infinite")}
          disabled={isNaturalResource || onToggleInfinite === undefined}
          onClick={() => onToggleInfinite?.(!isInfinite)}
        >
          <LucideInfinity />
        </button>
      )}
      <button
        type="button"
        className={cm(styles, "production-planning-icon-button")}
        aria-label={t("productionPlanning.remove")}
        title={t("productionPlanning.remove")}
        onClick={onRemove}
      >
        <LucideTrash2 />
      </button>
    </div>
  );
}

function SourcePolicyPanel({
  index,
  sourceConfig,
  onUpdate,
  t,
}: {
  index: ProductionPlanningIndex;
  sourceConfig: ProductionPlanningSourceConfig;
  onUpdate: (patch: Partial<ProductionPlanningSourceConfig>) => void;
  t: (key: string) => string;
}) {
  return (
    <section className={cm(styles, "production-planning-config-section")}>
      <div className={cm(styles, "production-planning-section-header")}>
        <h3><LucideInfinity /><span>{t("productionPlanning.sourcePolicy")}</span></h3>
      </div>
      <div className={cm(styles, "production-planning-source-policy")}>
        <div className={cm(styles, "production-planning-source-pill")}>
          <LucideBoxes />
          <span>{t("productionPlanning.naturalResources")}</span>
        </div>
        <div className={cm(styles, "production-planning-natural-resource-icons")}>
          {Array.from(index.naturalResourceItemIds).map((itemId) => (
            <img
              key={itemId}
              alt=""
              src={resolveProductionPlanningItemIconSrc(itemId, index)}
              title={resolveProductionPlanningItemName(itemId, index, t)}
            />
          ))}
        </div>
        <ByproductPolicyToggle
          itemId="item_liquid_water"
          index={index}
          policy={sourceConfig.waterPolicy}
          optionA="use-byproduct"
          optionALabel={t("productionPlanning.byproductUse")}
          optionB="dump-byproduct"
          optionBLabel={t("productionPlanning.byproductDump")}
          onChange={(policy) => onUpdate({ waterPolicy: policy })}
          t={t}
        />
        <ByproductPolicyToggle
          itemId="item_liquid_acid"
          index={index}
          policy={sourceConfig.acidPolicy}
          optionA="use-byproduct"
          optionALabel={t("productionPlanning.byproductUse")}
          optionB="dump-byproduct"
          optionBLabel={t("productionPlanning.byproductDump")}
          onChange={(policy) => onUpdate({ acidPolicy: policy })}
          t={t}
        />
        <SewagePolicyToggle
          index={index}
          policy={sourceConfig.sewagePolicy}
          onChange={(policy) => onUpdate({ sewagePolicy: policy })}
          t={t}
        />
      </div>
    </section>
  );
}

function ByproductPolicyToggle({
  itemId,
  index,
  policy,
  optionA,
  optionALabel,
  optionB,
  optionBLabel,
  onChange,
  t: _t,
}: {
  itemId: string;
  index: ProductionPlanningIndex;
  policy: ProductionPlanningByproductPolicy;
  optionA: ProductionPlanningByproductPolicy;
  optionALabel: string;
  optionB: ProductionPlanningByproductPolicy;
  optionBLabel: string;
  onChange: (policy: ProductionPlanningByproductPolicy) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-special-source")}>
      <div className={cm(styles, "production-planning-special-source-label")}>
        <img alt="" src={resolveProductionPlanningItemIconSrc(itemId, index)} />
        <span>{resolveProductionPlanningItemName(itemId, index, _t)}</span>
      </div>
      <div className={cm(styles, "production-planning-two-option-toggle")}>
        <button
          type="button"
          className={cm(styles, policy === optionA ? "is-active" : "")}
          onClick={() => onChange(optionA)}
        >
          {optionALabel}
        </button>
        <button
          type="button"
          className={cm(styles, policy === optionB ? "is-active" : "")}
          onClick={() => onChange(optionB)}
        >
          {optionBLabel}
        </button>
      </div>
    </div>
  );
}

function SewagePolicyToggle({
  index,
  policy,
  onChange,
  t: _t,
}: {
  index: ProductionPlanningIndex;
  policy: ProductionPlanningSewagePolicy;
  onChange: (policy: ProductionPlanningSewagePolicy) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-special-source")}>
      <div className={cm(styles, "production-planning-special-source-label")}>
        <img alt="" src={resolveProductionPlanningItemIconSrc("item_liquid_sewage", index)} />
        <span>{resolveProductionPlanningItemName("item_liquid_sewage", index, _t)}</span>
      </div>
      <div className={cm(styles, "production-planning-two-option-toggle")}>
        <button
          type="button"
          className={cm(styles, policy === "external-supply" ? "is-active" : "")}
          onClick={() => onChange("external-supply")}
        >
          {_t("productionPlanning.externalSupply")}
        </button>
        <button
          type="button"
          className={cm(styles, policy === "self-produce" ? "is-active" : "")}
          onClick={() => onChange("self-produce")}
        >
          {_t("productionPlanning.selfProduce")}
        </button>
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className={cm(styles, "production-planning-segmented")} aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cm(styles, value === option.value ? "is-active" : "")}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PlanGraph({
  displayMode,
  flowViewport,
  viewMode,
  plan,
  index,
  recipeChoices,
  treeScrollTop,
  onFlowViewportChange,
  onSelectRecipe,
  onCoverDemand,
  onRemoveExternalSupply,
  onTreeScrollTopChange,
  t,
}: {
  displayMode: ProductionPlanningDisplayMode;
  flowViewport: PlannerFlowViewportState;
  viewMode: ProductionPlanningViewMode;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  treeScrollTop: number;
  onFlowViewportChange: (viewport: PlannerFlowViewportState) => void;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  onCoverDemand: (itemId: string) => void;
  onRemoveExternalSupply: (itemId: string) => void;
  onTreeScrollTopChange: (scrollTop: number) => void;
  t: (key: string) => string;
}) {
  if (viewMode === "flow") {
    return (
      <FlowGraph
        displayMode={displayMode}
        flowViewport={flowViewport}
        plan={plan}
        index={index}
        recipeChoices={recipeChoices}
        onFlowViewportChange={onFlowViewportChange}
        onSelectRecipe={onSelectRecipe}
        t={t}
      />
    );
  }

  return (
    <ProductionPlanningTreeTable
      displayMode={displayMode}
      plan={plan}
      index={index}
      recipeChoices={recipeChoices}
      treeScrollTop={treeScrollTop}
      onSelectRecipe={onSelectRecipe}
      onCoverDemand={onCoverDemand}
      onRemoveExternalSupply={onRemoveExternalSupply}
      onTreeScrollTopChange={onTreeScrollTopChange}
      t={t}
    />
  );
}

function ProductionPlanningTreeTable({
  displayMode,
  plan,
  index,
  recipeChoices,
  treeScrollTop,
  onSelectRecipe,
  onCoverDemand,
  onRemoveExternalSupply,
  onTreeScrollTopChange,
  t,
}: {
  displayMode: ProductionPlanningDisplayMode;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  treeScrollTop: number;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  onCoverDemand: (itemId: string) => void;
  onRemoveExternalSupply: (itemId: string) => void;
  onTreeScrollTopChange: (scrollTop: number) => void;
  t: (key: string) => string;
}) {
  const rows = useMemo(() => buildProductionPlanningTreeRows(plan, displayMode), [displayMode, plan]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  // 折叠跳转映射：折叠后的关联节点 ID → 实际行 ID
  const jumpMap = useMemo(() => buildProductionPlanningTreeJumpMap(plan, displayMode), [displayMode, plan]);
  const treePaneRef = useRef<HTMLDivElement | null>(null);
  const rowElementRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(() => new Set());
  const visibleRows = useMemo(
    () => filterVisibleProductionPlanningTreeRows(rows, rowById, collapsedRowIds),
    [collapsedRowIds, rowById, rows],
  );
  const visibleRowIds = useMemo(() => new Set(visibleRows.map((row) => row.id)), [visibleRows]);
  const selectedRow = (
    selectedRowId !== null && visibleRowIds.has(selectedRowId)
      ? rowById.get(selectedRowId) ?? null
      : null
  ) ?? visibleRows[0] ?? null;

  useEffect(() => {
    setCollapsedRowIds((current) => {
      if (current.size === 0) {
        return current;
      }

      const collapsibleRowIds = new Set(rows.filter((row) => row.childIds.length > 0).map((row) => row.id));
      let changed = false;
      const next = new Set<string>();
      for (const rowId of current) {
        if (collapsibleRowIds.has(rowId)) {
          next.add(rowId);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [rows]);

  useEffect(() => {
    if (selectedRowId === null || visibleRowIds.has(selectedRowId)) {
      return;
    }

    setSelectedRowId(visibleRows[0]?.id ?? null);
  }, [selectedRowId, visibleRowIds, visibleRows]);

  useLayoutEffect(() => {
    const element = treePaneRef.current;
    if (element === null) {
      return;
    }

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.min(treeScrollTop, maxScrollTop);
  }, [treeScrollTop, visibleRows]);

  const selectRow = (rowId: string) => {
    setSelectedRowId(rowId);
    requestAnimationFrame(() => {
      rowElementRefs.current.get(rowId)?.scrollIntoView({ block: "nearest" });
    });
  };

  const toggleRowCollapsed = (rowId: string) => {
    const row = rowById.get(rowId);
    if (row === undefined || row.childIds.length === 0) {
      return;
    }

    const nextCollapsed = !collapsedRowIds.has(rowId);
    setCollapsedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });

    if (
      nextCollapsed
      && selectedRowId !== null
      && selectedRowId !== rowId
      && isProductionPlanningTreeDescendant(rowById, rowId, selectedRowId)
    ) {
      setSelectedRowId(rowId);
    }
  };

  if (rows.length === 0) {
    return <div className={cm(styles, "production-planning-empty")}>{t("productionPlanning.noRecipes")}</div>;
  }

  const layoutClassName = [
    "production-planning-tree-table-layout",
    displayMode === "device" ? "is-device-mode" : "is-item-mode",
  ].join(" ");

  return (
    <div className={cm(styles, layoutClassName)}>
      <div
        className={cm(styles, "production-planning-tree-table-pane")}
        onScroll={(event) => onTreeScrollTopChange(event.currentTarget.scrollTop)}
        ref={treePaneRef}
      >
        <table className={cm(styles, "production-planning-tree-table")}>
          <colgroup>
            <col className={cm(styles, "production-planning-tree-table-node-col")} />
            <col className={cm(styles, "production-planning-tree-table-rate-col")} />
          </colgroup>
          <thead>
            <tr>
              <th>{t("productionPlanning.node")}</th>
              <th>{t("productionPlanning.rate")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <ProductionPlanningTreeTableRow
                key={row.id}
                row={row}
                index={index}
                displayMode={displayMode}
                collapsed={collapsedRowIds.has(row.id)}
                selected={selectedRow?.id === row.id}
                onSelect={() => selectRow(row.id)}
                onToggleCollapsed={() => toggleRowCollapsed(row.id)}
                setRowElement={(element) => {
                  if (element === null) {
                    rowElementRefs.current.delete(row.id);
                  } else {
                    rowElementRefs.current.set(row.id, element);
                  }
                }}
                t={t}
              />
            ))}
          </tbody>
        </table>
      </div>
      <aside className={cm(styles, "production-planning-tree-detail")}>
        {selectedRow !== null && (
          <ProductionPlanningTreeDetail
            row={selectedRow}
            rowById={rowById}
            index={index}
            displayMode={displayMode}
            recipeChoices={recipeChoices}
            jumpMap={jumpMap}
            onSelectRow={selectRow}
            onSelectRecipe={onSelectRecipe}
            onCoverDemand={onCoverDemand}
            onRemoveExternalSupply={onRemoveExternalSupply}
            t={t}
          />
        )}
      </aside>
    </div>
  );
}

function ProductionPlanningTreeRowChip({
  row,
  index: _index,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}): ReactNode {
  const isByproduct = (
    (row.kind === "recipe" && row.isByproduct)
    || (row.kind === "item" && row.isByproduct)
  );
  if (!isByproduct) {
    return null;
  }

  return (
    <span className={cm(styles, "production-planning-tree-table-chip")}>
      {t("productionPlanning.byproduct")}
    </span>
  );
}

function ProductionPlanningTreeTableRow({
  row,
  index,
  displayMode,
  collapsed,
  selected,
  onSelect,
  onToggleCollapsed,
  setRowElement,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  displayMode: ProductionPlanningDisplayMode;
  collapsed: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleCollapsed: () => void;
  setRowElement: (element: HTMLTableRowElement | null) => void;
  t: (key: string) => string;
}) {
  const className = [
    "production-planning-tree-table-row",
    row.parentIds.length > 1 ? "is-shared" : "",
    selected ? "is-active" : "",
  ].filter(Boolean).join(" ");

  const hasChildren = row.childIds.length > 0;
  const toggleLabel = collapsed ? t("action.expand") : t("action.collapse");

  return (
    <tr className={cm(styles, className)} ref={setRowElement}>
      <td>
        <div
          className={cm(styles, "production-planning-tree-table-node-cell")}
          style={{ "--tree-depth": row.depth } as CSSProperties}
        >
          {hasChildren ? (
            <button
              type="button"
              className={cm(styles, "production-planning-tree-table-branch-button")}
              aria-expanded={!collapsed}
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={onToggleCollapsed}
            >
              <span className={cm(styles, "production-planning-tree-table-branch")} aria-hidden="true">
                {collapsed ? "+" : "-"}
              </span>
            </button>
          ) : (
            <span className={cm(styles, "production-planning-tree-table-branch-spacer")} aria-hidden="true">
              <span className={cm(styles, "production-planning-tree-table-branch is-leaf")} />
            </span>
          )}
          <button
            type="button"
            className={cm(styles, "production-planning-tree-table-node-button")}
            aria-pressed={selected}
            onClick={onSelect}
          >
            {row.kind === "item" ? (
              <ItemIdentity itemId={row.itemId} index={index} t={t} />
            ) : (
              <RecipeIdentity
                recipeNode={row.recipeNode}
                targetItemId={row.targetItemId}
                displayMode={displayMode}
                index={index}
                t={t}
              />
            )}
            {row.parentIds.length > 1 && (
              <span className={cm(styles, "production-planning-tree-table-chip")}>
                {t("productionPlanning.shared")}
              </span>
            )}
            {ProductionPlanningTreeRowChip({ row, index, t })}
          </button>
        </div>
      </td>
      <td>
        <ProductionPlanningTreeRowRate row={row} index={index} displayMode={displayMode} t={t} />
      </td>
    </tr>
  );
}

/*
AI-REMOVED 2026-05-22:
Reason: 设备树节点现在定义为“设备 + 目标产物”pair，RecipeIdentity 已显示目标产物；继续追加输出物品 chip 会造成产物重复显示，并让设备模式误读成物品节点。
Trigger: 用户指出设备模式不应继续出现物品 node。
Evidence: ProductionPlanningTreeTableRow 在设备模式下只渲染 RecipeIdentity，速率列和详情仍展示产物流量与端口信息。
Replacement: RecipeIdentity targetItemId subtitle + ProductionPlanningTreeRowRate
Risk: Low；删除的是重复摘要 UI，不改变树结构和计算数据。
Human Review: Required

Original code:
function renderFoldedOutputItems(
  row: ProductionPlanningTreeRecipeRow,
  index: ProductionPlanningIndex,
  t: (key: string) => string,
): ReactNode {
  const outputs = row.total?.outputs ?? row.recipeNode.outputs;
  if (outputs.length === 0) {
    return null;
  }

  return (
    <span className={cm(styles, "production-planning-tree-table-folded-items")}>
      {outputs.map((port) => (
        <span key={port.itemId} className={cm(styles, "production-planning-tree-table-folded-item-chip")}>
          <img alt="" src={resolveProductionPlanningItemIconSrc(port.itemId, index)} />
          <span>{resolveProductionPlanningItemName(port.itemId, index, t)}</span>
          <span>{formatProductionFlow(port.perMinute)}/min</span>
        </span>
      ))}
    </span>
  );
}
*/

function filterVisibleProductionPlanningTreeRows(
  rows: readonly ProductionPlanningTreeRow[],
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>,
  collapsedRowIds: ReadonlySet<string>,
): ProductionPlanningTreeRow[] {
  if (collapsedRowIds.size === 0) {
    return [...rows];
  }

  const hiddenRowIds = new Set<string>();
  for (const row of rows) {
    if (hiddenRowIds.has(row.id) || !collapsedRowIds.has(row.id)) {
      continue;
    }

    collectProductionPlanningTreeDescendantIds(rowById, row.id, hiddenRowIds);
  }

  return rows.filter((row) => !hiddenRowIds.has(row.id));
}

function collectProductionPlanningTreeDescendantIds(
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>,
  rowId: string,
  result: Set<string>,
): void {
  const row = rowById.get(rowId);
  if (row === undefined) {
    return;
  }

  for (const childId of row.childIds) {
    const childRow = rowById.get(childId);
    if (childRow === undefined || childRow.parentIds.length !== 1 || result.has(childId)) {
      continue;
    }

    result.add(childId);
    collectProductionPlanningTreeDescendantIds(rowById, childId, result);
  }
}

function isProductionPlanningTreeDescendant(
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>,
  ancestorRowId: string,
  candidateRowId: string,
): boolean {
  const descendantRowIds = new Set<string>();
  collectProductionPlanningTreeDescendantIds(rowById, ancestorRowId, descendantRowIds);
  return descendantRowIds.has(candidateRowId);
}

function ProductionPlanningTreeRowRate({
  row,
  index,
  displayMode,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  displayMode: ProductionPlanningDisplayMode;
  t: (key: string) => string;
}) {
  if (row.kind === "item") {
    const flowPerMinute = row.total?.demandPerMinute ?? row.node.demandPerMinute;
    // AI-CORRECTION 2026-05-22: flowPerMinute 在单配方折叠场景下等同于 outputFlow，
    // 显示两个相同数值的 /min 属于冗余；速率列改为三段式：设备数 + 产量 + 物流
    if (displayMode === "item" && row.node.recipeNode !== null) {
      const recipe = index.recipeById.get(row.node.recipeNode.recipeId);
      const machineId = recipe?.machineId ?? row.node.recipeNode.recipeId;
      const outputFlow = row.node.recipeNode.outputs[0]?.perMinute ?? row.node.recipeNode.cyclesPerMinute;
      const logisticsItemId = row.node.recipeNode.outputs[0]?.itemId ?? row.itemId;

      return (
        <div className={cm(styles, "production-planning-tree-table-rate")}>
          <span className={cm(styles, "production-planning-tree-rate-piece")} title={recipe === undefined ? row.node.recipeNode.recipeId : t(index.entityById.get(machineId)?.nameKey ?? recipe.nameKey)}>
            <strong>{formatProductionDeviceCount(row.node.recipeNode.deviceCount)}</strong>
            <img alt="" src={recipe === undefined ? "/device-icons/item_port_grinder_1.webp" : resolveProductionPlanningEntityIconSrc(machineId)} />
          </span>
          <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
          <span className={cm(styles, "production-planning-tree-rate-piece")}>
            <strong>{formatProductionFlow(outputFlow)}/min</strong>
          </span>
          <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
          <ProductionPlanningLogisticsRate flowPerMinute={outputFlow} itemId={logisticsItemId} index={index} t={t} />
        </div>
      );
    }

    return (
      <div className={cm(styles, "production-planning-tree-table-rate")}>
        <span className={cm(styles, "production-planning-tree-rate-piece")}>
          <strong>{formatProductionFlow(flowPerMinute)}/min</strong>
        </span>
        <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
        <ProductionPlanningLogisticsRate flowPerMinute={flowPerMinute} itemId={row.itemId} index={index} t={t} />
      </div>
    );
  }

  if (isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
    const outputFlow = resolveProductionPlanningRecipeDisplayFlow(row);
    const logisticsItemId = resolveProductionPlanningRecipeDisplayItemId(row);

    return (
      <div className={cm(styles, "production-planning-tree-table-rate")}>
        <span className={cm(styles, "production-planning-tree-rate-piece")}>
          <strong>{formatProductionFlow(outputFlow)}/min</strong>
        </span>
        {logisticsItemId !== null && (
          <>
            <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
            <ProductionPlanningLogisticsRate flowPerMinute={outputFlow} itemId={logisticsItemId} index={index} t={t} />
          </>
        )}
      </div>
    );
  }

  const recipe = index.recipeById.get(row.recipeId);
  const machineId = recipe?.machineId ?? row.recipeNode.recipeId;
  const outputFlow = resolveProductionPlanningRecipeDisplayFlow(row);
  const logisticsItemId = resolveProductionPlanningRecipeDisplayItemId(row);

  return (
    <div className={cm(styles, "production-planning-tree-table-rate")}>
      <span className={cm(styles, "production-planning-tree-rate-piece")} title={recipe === undefined ? row.recipeId : t(index.entityById.get(machineId)?.nameKey ?? recipe.nameKey)}>
        <strong>{formatProductionDeviceCount(row.total?.deviceCount ?? row.recipeNode.deviceCount)}</strong>
        <img alt="" src={recipe === undefined ? "/device-icons/item_port_grinder_1.webp" : resolveProductionPlanningEntityIconSrc(machineId)} />
      </span>
      <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
      <span className={cm(styles, "production-planning-tree-rate-piece")}>
        <strong>{formatProductionFlow(outputFlow)}/min</strong>
      </span>
      {logisticsItemId !== null && (
        <>
          <span className={cm(styles, "production-planning-tree-rate-separator")}>·</span>
          <ProductionPlanningLogisticsRate flowPerMinute={outputFlow} itemId={logisticsItemId} index={index} t={t} />
        </>
      )}
    </div>
  );
}

function ProductionPlanningLogisticsRate({
  flowPerMinute,
  itemId,
  index,
  t,
}: {
  flowPerMinute: number;
  itemId: string;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  const logisticsKind = resolveProductionPlanningLogisticsKind(itemId, index);
  const count = Math.ceil(flowPerMinute / resolveProductionPlanningLogisticsThroughput(logisticsKind));
  const entityId = logisticsKind === "pipe" ? "pipe_straight_1x1" : "belt_straight_1x1";
  const entity = index.entityById.get(entityId);

  return (
    <span
      className={cm(styles, "production-planning-tree-rate-piece")}
      title={entity === undefined ? entityId : t(entity.nameKey)}
    >
      <strong>{formatProductionDeviceCount(count)}</strong>
      <img alt="" src={resolveProductionPlanningEntityIconSrc(entityId)} />
    </span>
  );
}

function ProductionPlanningTreeDetail({
  row,
  rowById,
  index,
  displayMode,
  recipeChoices,
  jumpMap,
  onSelectRow,
  onSelectRecipe,
  onCoverDemand,
  onRemoveExternalSupply,
  t,
}: {
  row: ProductionPlanningTreeRow;
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>;
  index: ProductionPlanningIndex;
  displayMode: ProductionPlanningDisplayMode;
  recipeChoices: ReadonlyMap<string, string>;
  jumpMap: ProductionPlanningTreeJumpMap;
  onSelectRow: (rowId: string) => void;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  onCoverDemand: (itemId: string) => void;
  onRemoveExternalSupply: (itemId: string) => void;
  t: (key: string) => string;
}) {
  const resolveRowId = (rawId: string) => jumpMap.get(rawId) ?? rawId;
  const resolveRelatedRowIds = (itemIds: readonly string[]) => itemIds
    .map((itemId) => resolveRowId(buildProductionPlanningTreeItemRowId(itemId)))
    .filter((rowId) => rowId !== row.id);

  if (row.kind === "recipe") {
    const recipe = index.recipeById.get(row.recipeNode.recipeId);
    const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
    const isExternal = isProductionPlanningExternalSupplyRecipeId(row.recipeId);
    const productName = row.targetItemId.length > 0
      ? resolveProductionPlanningItemName(row.targetItemId, index, t)
      : isExternal
        ? ""
        : resolveProductionPlanningRecipeName(recipe!, index, t);
    const machineName = isExternal
      ? t("productionPlanning.externalSupply")
      : machine === null ? row.recipeNode.recipeId : t(machine.nameKey);
    const title = displayMode === "item" ? productName : machineName;
    const subtitle = displayMode === "item"
      ? (isExternal ? t("productionPlanning.externalSupply") : `由 ${machineName} 产出`)
      : (isExternal ? `${t("productionPlanning.produced")} ${productName}` : `产出 ${productName}`);
    const iconSrc = displayMode === "item" && row.targetItemId.length > 0
      ? resolveProductionPlanningItemIconSrc(row.targetItemId, index)
      : isExternal
        ? resolveProductionPlanningExternalSupplyIconSrc()
        : machine === null
          ? "/device-icons/item_port_grinder_1.webp"
          : resolveProductionPlanningEntityIconSrc(machine.id);

    return (
      <article className={cm(styles, "production-planning-tree-detail-stack")}>
        <div className={cm(styles, "production-planning-recipe-header")}>
          <img alt="" src={iconSrc} />
          <div>
            <h4>{title}</h4>
            <span>{subtitle}</span>
          </div>
          <button
            type="button"
            className={cm(styles, "production-planning-icon-button")}
            aria-label={isExternal ? t("productionPlanning.removeExternalSupply") : t("productionPlanning.coverDemand")}
            title={isExternal ? t("productionPlanning.removeExternalSupply") : t("productionPlanning.coverDemand")}
            onClick={() => isExternal ? onRemoveExternalSupply(row.targetItemId) : onCoverDemand(row.targetItemId)}
          >
            <LucideRepeat />
          </button>
        </div>
        {recipe !== undefined && (
          <div className={cm(styles, "production-planning-recipe-formula")}>
            {recipe.inputs.map((input, i) => (
              <span key={`in-${input.itemId}`} className={cm(styles, "production-planning-recipe-formula-item")}>
                {i > 0 && <span className={cm(styles, "production-planning-recipe-formula-plus")}>+</span>}
                <span className={cm(styles, "production-planning-recipe-formula-icon")}>
                  <img alt="" src={resolveProductionPlanningItemIconSrc(input.itemId, index)} />
                  <span>{input.amount}</span>
                </span>
              </span>
            ))}
            <span className={cm(styles, "production-planning-recipe-formula-arrow")}>
              <span>▶▶</span>
              <span>{row.recipeNode.durationSeconds}{t("productionPlanning.second_short")}</span>
            </span>
            {recipe.outputs.map((output) => (
              <span key={`out-${output.itemId}`} className={cm(styles, "production-planning-recipe-formula-item")}>
                <span className={cm(styles, "production-planning-recipe-formula-icon")}>
                  <img alt="" src={resolveProductionPlanningItemIconSrc(output.itemId, index)} />
                  <span>{output.amount}</span>
                </span>
              </span>
            ))}
          </div>
        )}
        <div className={cm(styles, "production-planning-recipe-ports")}>
          <PortChipList title={t("productionPlanning.requiredInputs")} ports={row.recipeNode.inputs} index={index} t={t} />
          <PortChipList title={t("productionPlanning.totalOutputs")} ports={row.recipeNode.outputs} index={index} t={t} />
        </div>
        <ProductionPlanningTreeRelations
          groups={[
            {
              label: t("productionPlanning.inputSources"),
              rowIds: resolveRelatedRowIds(row.inputItemIds),
            },
            {
              label: t("productionPlanning.outputTargets"),
              rowIds: resolveRelatedRowIds(row.outputItemIds),
            },
          ]}
          rowById={rowById}
          index={index}
          onSelectRow={(id) => onSelectRow(resolveRowId(id))}
          t={t}
        />
      </article>
    );
  }

  const recipes = index.recipesByOutputItem.get(row.itemId) ?? [];
  const total = row.total;
  const producerRow = row.producerIds
    .map((rowId) => rowById.get(rowId) ?? null)
    .find((candidate): candidate is ProductionPlanningTreeRecipeRow => candidate?.kind === "recipe") ?? null;
  const demandPerMinute = total?.demandPerMinute ?? row.node.demandPerMinute;
  const suppliedPerMinute = total?.suppliedPerMinute ?? row.node.suppliedPerMinute;
  const producedPerMinute = total?.producedPerMinute ?? row.node.producedPerMinute;
  const unresolvedPerMinute = total?.unresolvedPerMinute ?? row.node.unresolvedPerMinute;

  return (
    <article className={cm(styles, "production-planning-item-detail")}>
      <div className={cm(styles, "production-planning-item-detail-header")}>
        <ItemIdentity itemId={row.itemId} index={index} t={t} />
        <NodeStatus node={row.node} t={t} />
      </div>
      <div className={cm(styles, "production-planning-node-metrics")}>
        <Metric label={t("productionPlanning.demand")} value={formatProductionFlow(demandPerMinute)} />
        <Metric label={t("productionPlanning.supply")} value={formatProductionFlow(suppliedPerMinute)} tone={suppliedPerMinute > 0 ? "good" : undefined} />
        <Metric label={t("productionPlanning.produced")} value={formatProductionFlow(producedPerMinute)} />
        <Metric label={t("productionPlanning.missing")} value={formatProductionFlow(unresolvedPerMinute)} tone={unresolvedPerMinute > 0 ? "bad" : undefined} />
      </div>
      <ProductionPlanningTreeRelations
        groups={[
          { label: t("productionPlanning.producedBy"), rowIds: row.producerIds },
          { label: t("productionPlanning.usedBy"), rowIds: row.consumerIds },
        ]}
        rowById={rowById}
        index={index}
        onSelectRow={(id) => onSelectRow(resolveRowId(id))}
        t={t}
      />
      {recipes.length > 0 && (
        <RecipeSelect
          itemId={row.itemId}
          recipes={recipes}
          index={index}
          selectedRecipeId={recipeChoices.get(row.itemId) ?? null}
          onSelectRecipe={onSelectRecipe}
          t={t}
        />
      )}
      {producerRow !== null && <RecipeCard recipeNode={producerRow.recipeNode} index={index} t={t} />}
    </article>
  );
}

function ProductionPlanningTreeRelations({
  groups,
  rowById,
  index,
  onSelectRow,
  t,
}: {
  groups: readonly { readonly label: string; readonly rowIds: readonly string[] }[];
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>;
  index: ProductionPlanningIndex;
  onSelectRow: (rowId: string) => void;
  t: (key: string) => string;
}) {
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      rows: uniqueProductionPlanningTreeRowIds(group.rowIds)
        .map((rowId) => rowById.get(rowId) ?? null)
        .filter((relatedRow): relatedRow is ProductionPlanningTreeRow => relatedRow !== null),
    }))
    .filter((group) => group.rows.length > 0);

  if (visibleGroups.length === 0) {
    return null;
  }

  return (
    <div className={cm(styles, "production-planning-tree-relations")}>
      {visibleGroups.map((group) => (
        <div key={group.label} className={cm(styles, "production-planning-tree-relation-group")}>
          <span>{group.label}</span>
          <div>
            {group.rows.map((relatedRow) => (
              <button
                key={relatedRow.id}
                type="button"
                className={cm(styles, "production-planning-tree-relation-button")}
                title={resolveProductionPlanningTreeRowTitle(relatedRow, index, t)}
                onClick={() => onSelectRow(relatedRow.id)}
              >
                <ProductionPlanningTreeRelationIdentity row={relatedRow} index={index} t={t} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductionPlanningTreeRelationIdentity({
  row,
  index,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  if (row.kind === "item") {
    return (
      <>
        <img alt="" src={resolveProductionPlanningItemIconSrc(row.itemId, index)} />
        <span>{resolveProductionPlanningItemName(row.itemId, index, t)}</span>
      </>
    );
  }

  const recipe = index.recipeById.get(row.recipeId);
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const isExternal = isProductionPlanningExternalSupplyRecipeId(row.recipeId);
  const machineId = isExternal ? EXTERNAL_SUPPLY_ENTITY_ID : (recipe?.machineId ?? "");
  const machineName = isExternal
    ? t("productionPlanning.externalSupply")
    : machine === null ? row.recipeId : t(machine.nameKey);
  const iconSrc = isExternal
    ? resolveProductionPlanningExternalSupplyIconSrc()
    : machineId.length > 0
      ? resolveProductionPlanningEntityIconSrc(machineId)
      : "/device-icons/item_port_grinder_1.webp";

  return (
    <>
      <img alt="" src={iconSrc} />
      <span>
        {machineName}
        {row.targetItemId.length > 0 ? ` · ${resolveProductionPlanningItemName(row.targetItemId, index, t)}` : ""}
      </span>
    </>
  );
}

function RecipeIdentity({
  recipeNode,
  targetItemId,
  displayMode,
  index,
  t,
}: {
  recipeNode: ProductionPlanningRecipeNode;
  targetItemId?: string;
  displayMode: ProductionPlanningDisplayMode;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  const recipe = index.recipeById.get(recipeNode.recipeId);
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const productItemId = targetItemId ?? recipeNode.targetItemId;
  const isExternal = isProductionPlanningExternalSupplyRecipeId(recipeNode.recipeId);

  const productName = productItemId.length > 0
    ? resolveProductionPlanningItemName(productItemId, index, t)
    : recipe === undefined
      ? recipeNode.recipeId
      : resolveProductionPlanningRecipeName(recipe, index, t);
  const machineName = isExternal
    ? t("productionPlanning.externalSupply")
    : machine === null ? recipeNode.recipeId : t(machine.nameKey);
  const title = displayMode === "item" ? productName : machineName;
  const subtitle = displayMode === "item" ? machineName : productName;
  const iconSrc = (() => {
    if (displayMode === "item" && productItemId.length > 0) {
      return resolveProductionPlanningItemIconSrc(productItemId, index);
    }
    if (isExternal) {
      return resolveProductionPlanningExternalSupplyIconSrc();
    }
    return recipe === undefined
      ? "/device-icons/item_port_grinder_1.webp"
      : resolveProductionPlanningEntityIconSrc(recipe.machineId);
  })();

  return (
    <div className={cm(styles, "production-planning-recipe-identity")}>
      <img alt="" src={iconSrc} />
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

type MutableProductionPlanningTreeRow = MutableProductionPlanningTreeItemRow | MutableProductionPlanningTreeRecipeRow;

type MutableProductionPlanningTreeRowBase = {
  id: string;
  depth: number;
  order: number;
  parentIds: Set<string>;
  childIds: Set<string>;
};

type MutableProductionPlanningTreeItemRow = MutableProductionPlanningTreeRowBase & {
  kind: "item";
  itemId: string;
  node: ProductionPlanningItemNode;
  nodes: ProductionPlanningItemNode[];
  total: ProductionPlanningResult["itemTotals"][number] | null;
  producerIds: Set<string>;
  consumerIds: Set<string>;
  isByproduct: boolean;
};

type MutableProductionPlanningTreeRecipeRow = MutableProductionPlanningTreeRowBase & {
  kind: "recipe";
  recipeId: string;
  targetItemId: string;
  recipeNode: ProductionPlanningRecipeNode;
  recipeNodes: ProductionPlanningRecipeNode[];
  total: ProductionPlanningResult["recipeTotals"][number] | null;
  inputItemIds: Set<string>;
  outputItemIds: Set<string>;
  isByproduct: boolean;
};

// AI-CORRECTION 2026-05-21: buildProductionPlanningTreeRows 现在按 displayMode 分发到两套独立逻辑；
// 物品模式折叠 recipe 行（只保留 item 行），设备模式折叠中间 item 行（只保留 recipe + raw item 行）。
// AI-CORRECTION 2026-05-22: 设备模式也折叠 item 行；树节点定义为“配方设备 + 目标产物”的 unique pair。
// AI-CORRECTION 2026-05-22: 物品/设备模式现在共享同一套 unique pair 树；displayMode 只影响树表外显身份。
export function buildProductionPlanningTreeRows(
  plan: ProductionPlanningResult,
  _displayMode: ProductionPlanningDisplayMode,
): ProductionPlanningTreeRow[] {
  // AI-CORRECTION 2026-05-22:
  // 树表改为先建立物品流 ledger 视图，再生成 pair 行；多输出、共享来源和处置配方不再复用递归 recipe 行的整包 outputs。
  // AI-REMOVED 2026-05-22:
  // Reason: 旧构建器把同一 recipe 的全部 outputs 塞入当前 target pair，导致多输出配方副产物标记污染目标行。
  // Trigger: 用户指出“一个配方出两个物品应该生成两个设备×物品 pair，标记不应打错”。
  // Evidence: 赫铜装备原件链路中“混合池×壤晶废液”被“惰性壤晶废液”的副产物状态污染。
  // Replacement: buildLedgerProductionPlanningTreeRows
  // Risk: Medium；树表结构来源从递归 recipeNode 改为 ledger 关系，流程图仍保留旧路径。
  // Human Review: Required
  //
  // Original code:
  // return buildDeviceProductPairTreeRows(plan);
  return buildLedgerProductionPlanningTreeRows(plan);
}

function buildLedgerProductionPlanningTreeRows(plan: ProductionPlanningResult): ProductionPlanningTreeRow[] {
  const recipeTotals = new Map(plan.recipeTotals.map((total) => [total.recipeId, total]));
  const rowById = new Map<string, MutableProductionPlanningTreeRow>();
  const producerRowIdsByItem = new Map<string, Set<string>>();
  const surplusProducerRowIdsByItem = new Map<string, Set<string>>();
  const byproductRowIds = new Set<string>();
  let nextOrder = 0;

  const addRowIdByItem = (target: Map<string, Set<string>>, itemId: string, rowId: string) => {
    const existing = target.get(itemId);
    if (existing === undefined) {
      target.set(itemId, new Set([rowId]));
      return;
    }
    existing.add(rowId);
  };

  const ensureRecipeRow = (
    recipeId: string,
    targetItemId: string,
    recipeNode: ProductionPlanningRecipeNode | null,
    rowIdOverride?: string,
  ): MutableProductionPlanningTreeRecipeRow => {
    const rowId = rowIdOverride ?? buildProductionPlanningTreeDeviceProductRowId(recipeId, targetItemId);
    const existing = rowById.get(rowId);
    const total = recipeTotals.get(recipeId) ?? null;
    const targetRecipeNode = recipeNode === null
      ? createProductionPlanningTreeSyntheticRecipeNode(recipeId, total, null, targetItemId)
      : createProductionPlanningTreeTargetedRecipeNode(recipeNode, targetItemId);

    if (existing !== undefined) {
      if (existing.kind !== "recipe") {
        throw new Error(`Production planning tree row id collision: ${rowId}`);
      }
      existing.total = total;
      if (recipeNode === null && existing.recipeNodes.length > 0) {
        if (targetItemId.length > 0) {
          existing.outputItemIds.add(targetItemId);
        }
        return existing;
      }
      if (!existing.recipeNodes.some((candidate) => candidate.id === targetRecipeNode.id)) {
        existing.recipeNodes.push(targetRecipeNode);
        existing.recipeNode = mergeProductionPlanningTreeRecipeNodes(existing.recipeNode, targetRecipeNode);
      }
      if (targetItemId.length > 0) {
        existing.outputItemIds.add(targetItemId);
      }
      return existing;
    }

    const recipeRow: MutableProductionPlanningTreeRecipeRow = {
      id: rowId,
      kind: "recipe",
      depth: 0,
      order: nextOrder,
      parentIds: new Set(),
      childIds: new Set(),
      recipeId,
      targetItemId,
      recipeNode: targetRecipeNode,
      recipeNodes: [targetRecipeNode],
      total,
      inputItemIds: new Set(targetRecipeNode.inputs.map((input) => input.itemId)),
      outputItemIds: targetItemId.length > 0 ? new Set([targetItemId]) : new Set(),
      isByproduct: false,
    };
    nextOrder += 1;
    rowById.set(rowId, recipeRow);
    return recipeRow;
  };

  const ensureExternalSupplyRow = (node: ProductionPlanningItemNode): MutableProductionPlanningTreeRecipeRow | null => {
    const perMinute = resolveProductionPlanningExternalSupplyPerMinute(node);
    if (perMinute <= PRODUCTION_PLANNING_EPSILON) {
      return null;
    }

    const recipeNode = createProductionPlanningExternalSupplyRecipeNode(node, perMinute);
    return ensureRecipeRow(recipeNode.recipeId, recipeNode.targetItemId, recipeNode);
  };

  const registerRecipeOutputs = (recipeNode: ProductionPlanningRecipeNode) => {
    for (const output of recipeNode.outputs) {
      if (output.perMinute <= PRODUCTION_PLANNING_EPSILON) {
        continue;
      }
      const row = ensureRecipeRow(recipeNode.recipeId, output.itemId, recipeNode);
      if (!isProductionPlanningDisposalRecipeId(row.recipeId) && !isProductionPlanningExternalSupplyRecipeId(row.recipeId)) {
        addRowIdByItem(producerRowIdsByItem, output.itemId, row.id);
        if (output.itemId !== recipeNode.targetItemId) {
          addRowIdByItem(surplusProducerRowIdsByItem, output.itemId, row.id);
          if (plan.byproductItemIds.has(output.itemId)) {
            byproductRowIds.add(row.id);
          }
        }
      }
    }
  };

  const collectRowsFromItemNode = (node: ProductionPlanningItemNode): void => {
    // AI-REMOVED 2026-05-22:
    // Reason: 外部供给不是联产 surplus 来源，不能进入 producerRowIdsByItem，否则后续 supply.surplus 边会误连外部源。
    // Trigger: ledger 树需要区分 finite/infinite external supply 与 reusable byproduct output。
    // Evidence: connectItemSources 已对 node.supply.manual / node.supply.infinite 直接创建外部供给边；surplus 来源只应来自生产配方输出。
    // Replacement: ensureExternalSupplyRow(node)
    // Risk: Low；外部供给仍会在直接供给关系中显示，只是不再作为副产物来源。
    // Human Review: Required
    //
    // Original code:
    // const externalRow = ensureExternalSupplyRow(node);
    // if (externalRow !== null) {
    //   addProducerRowId(node.itemId, externalRow.id);
    // }
    ensureExternalSupplyRow(node);

    if (node.recipeNode === null) {
      return;
    }

    registerRecipeOutputs(node.recipeNode);
    for (const child of node.recipeNode.inputItems) {
      collectRowsFromItemNode(child);
    }
  };

  for (const root of plan.roots) {
    collectRowsFromItemNode(root);
  }

  for (const total of plan.recipeTotals) {
    const targetItemIds = total.outputs.length > 0
      ? total.outputs.map((output) => output.itemId)
      : total.inputs.slice(0, 1).map((input) => input.itemId);

    for (const targetItemId of targetItemIds) {
      const row = ensureRecipeRow(total.recipeId, targetItemId, null);
      for (const input of total.inputs) {
        row.inputItemIds.add(input.itemId);
      }
      row.outputItemIds.add(targetItemId);
      if (total.outputs.some((output) => output.itemId === targetItemId) && !isProductionPlanningDisposalRecipeId(total.recipeId)) {
        addRowIdByItem(producerRowIdsByItem, targetItemId, row.id);
      }
    }
  }

  const addProducerEdges = (
    parentRow: MutableProductionPlanningTreeRecipeRow,
    itemId: string,
    producerRowIdsByItemMap: ReadonlyMap<string, ReadonlySet<string>>,
  ) => {
    const producerRowIds = producerRowIdsByItemMap.get(itemId);
    if (producerRowIds === undefined) {
      return;
    }

    for (const producerRowId of producerRowIds) {
      addProductionPlanningTreeEdge(rowById, parentRow.id, producerRowId);
    }
  };

  const connectItemSources = (
    node: ProductionPlanningItemNode,
    parentRow: MutableProductionPlanningTreeRecipeRow,
  ): void => {
    parentRow.inputItemIds.add(node.itemId);

    const externalRow = ensureExternalSupplyRow(node);
    if (externalRow !== null) {
      addProductionPlanningTreeEdge(rowById, parentRow.id, externalRow.id);
    }

    if (node.supply.surplus > PRODUCTION_PLANNING_EPSILON) {
      addProducerEdges(parentRow, node.itemId, surplusProducerRowIdsByItem);
    }

    if (node.recipeNode !== null) {
      const childRow = ensureRecipeRow(node.recipeNode.recipeId, node.recipeNode.targetItemId, node.recipeNode);
      addProductionPlanningTreeEdge(rowById, parentRow.id, childRow.id);
      connectRecipeInputs(node.recipeNode);
    }
  };

  function connectRecipeInputs(recipeNode: ProductionPlanningRecipeNode): void {
    const parentRow = ensureRecipeRow(recipeNode.recipeId, recipeNode.targetItemId, recipeNode);
    for (const child of recipeNode.inputItems) {
      connectItemSources(child, parentRow);
    }
  }

  for (const root of plan.roots) {
    if (root.recipeNode !== null) {
      connectRecipeInputs(root.recipeNode);
    } else {
      ensureExternalSupplyRow(root);
    }
  }

  markLedgerByproductRows(rowById, byproductRowIds);
  connectDisposalRowsToByproductSources(rowById, surplusProducerRowIdsByItem, plan, nextOrder);

  const rootRowIds = new Set(
    Array.from(rowById.values())
      .filter((row) => row.parentIds.size !== 1)
      .map((row) => row.id),
  );

  return finalizeProductionPlanningTreeRows(rowById, rootRowIds);
}

function createProductionPlanningTreeTargetedRecipeNode(
  recipeNode: ProductionPlanningRecipeNode,
  targetItemId: string,
): ProductionPlanningRecipeNode {
  if (recipeNode.targetItemId === targetItemId) {
    return recipeNode;
  }

  return {
    ...recipeNode,
    id: `${recipeNode.id}:target:${targetItemId}`,
    targetItemId,
  };
}

function markLedgerByproductRows(
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
  byproductRowIds: ReadonlySet<string>,
): void {
  for (const row of rowById.values()) {
    if (row.kind !== "recipe") {
      continue;
    }

    row.isByproduct = byproductRowIds.has(row.id) || isProductionPlanningDisposalRecipeId(row.recipeId);
  }
}

function connectDisposalRowsToByproductSources(
  rowById: Map<string, MutableProductionPlanningTreeRow>,
  producerRowIdsByItem: ReadonlyMap<string, ReadonlySet<string>>,
  plan: ProductionPlanningResult,
  nextOrderStart: number,
): void {
  let nextOrder = nextOrderStart;

  for (const row of Array.from(rowById.values())) {
    if (row.kind !== "recipe" || !isProductionPlanningDisposalRecipeId(row.recipeId)) {
      continue;
    }

    const itemId = row.targetItemId || row.recipeNode.inputs[0]?.itemId || row.total?.inputs[0]?.itemId || "";
    if (itemId.length === 0 || !plan.byproductItemIds.has(itemId)) {
      continue;
    }

    const producerRowIds = producerRowIdsByItem.get(itemId);
    if (producerRowIds === undefined) {
      continue;
    }

    for (const producerRowId of producerRowIds) {
      const producerRow = rowById.get(producerRowId);
      if (producerRow === undefined || producerRow.kind !== "recipe" || producerRow.id === row.id) {
        continue;
      }

      if (producerRow.parentIds.size === 0) {
        addProductionPlanningTreeEdge(rowById, row.id, producerRow.id);
        producerRow.isByproduct = true;
        continue;
      }

      const cloneRowId = buildProductionPlanningTreeDisposalSourceRowId(row.id, producerRow.id);
      if (rowById.has(cloneRowId)) {
        addProductionPlanningTreeEdge(rowById, row.id, cloneRowId);
        continue;
      }

      const cloneRow: MutableProductionPlanningTreeRecipeRow = {
        id: cloneRowId,
        kind: "recipe",
        depth: 0,
        order: nextOrder,
        parentIds: new Set(),
        childIds: new Set(),
        recipeId: producerRow.recipeId,
        targetItemId: producerRow.targetItemId,
        recipeNode: producerRow.recipeNode,
        recipeNodes: [...producerRow.recipeNodes],
        total: producerRow.total,
        inputItemIds: new Set(producerRow.inputItemIds),
        outputItemIds: new Set([producerRow.targetItemId]),
        isByproduct: true,
      };
      nextOrder += 1;
      rowById.set(cloneRowId, cloneRow);
      addProductionPlanningTreeEdge(rowById, row.id, cloneRow.id);
    }
  }
}

function isProductionPlanningDisposalRecipeId(recipeId: string): boolean {
  return recipeId.startsWith("r_dumper_void_") || recipeId.startsWith("r_chrono_wastewater_treatment");
}

function buildProductionPlanningTreeDisposalSourceRowId(disposalRowId: string, producerRowId: string): string {
  return `disposal-source:${disposalRowId}:${producerRowId}`;
}

// AI-REMOVED 2026-05-23:
// Reason: ledger 树构建器(buildLedgerProductionPlanningTreeRows)已接管全部树表行生成
// Trigger: 清理死代码（kind=item 遗留来源）
// Replacement: buildLedgerProductionPlanningTreeRows
// Risk: Low
// Human Review: Not Required


/** 折叠跳转映射：被折叠节点的原始 ID → 包含它的实际树行 ID */
type ProductionPlanningTreeJumpMap = ReadonlyMap<string, string>;

function buildProductionPlanningTreeJumpMap(
  plan: ProductionPlanningResult,
  _displayMode: ProductionPlanningDisplayMode,
): ProductionPlanningTreeJumpMap {
  const map = new Map<string, string>();
  // AI-CORRECTION 2026-05-22: 物品/设备模式共享 unique pair 树，跳转目标统一为“设备/配方 + 产物”行。
  const mapExternalSupply = (node: ProductionPlanningItemNode): void => {
    if (resolveProductionPlanningExternalSupplyPerMinute(node) <= PRODUCTION_PLANNING_EPSILON || node.recipeNode !== null) {
      return;
    }

    map.set(
      buildProductionPlanningTreeItemRowId(node.itemId),
      buildProductionPlanningTreeDeviceProductRowId(buildProductionPlanningExternalSupplyRecipeId(node.itemId), node.itemId),
    );
  };
  const walkRecipes = (recipeNode: ProductionPlanningRecipeNode): void => {
    for (const output of recipeNode.outputs) {
      map.set(
        buildProductionPlanningTreeItemRowId(output.itemId),
        buildProductionPlanningTreeDeviceProductRowId(recipeNode.recipeId, output.itemId),
      );
    }
    for (const child of recipeNode.inputItems) {
      if (child.recipeNode !== null) {
        map.set(
          buildProductionPlanningTreeItemRowId(child.itemId),
          buildProductionPlanningTreeDeviceProductRowId(child.recipeNode.recipeId, child.recipeNode.targetItemId),
        );
        walkRecipes(child.recipeNode);
      } else {
        mapExternalSupply(child);
      }
    }
  };
  for (const root of plan.roots) {
    if (root.recipeNode !== null) {
      walkRecipes(root.recipeNode);
    } else {
      mapExternalSupply(root);
    }
  }

  return map;
}

function finalizeProductionPlanningTreeRows(
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
  rootRowIds: ReadonlySet<string>,
): ProductionPlanningTreeRow[] {
  const result: ProductionPlanningTreeRow[] = [];
  const emittedRowIds = new Set<string>();
  const orderedRows = Array.from(rowById.values()).sort(compareMutableProductionPlanningTreeRows);

  const emitRow = (row: MutableProductionPlanningTreeRow, depth: number) => {
    if (emittedRowIds.has(row.id)) {
      return;
    }

    emittedRowIds.add(row.id);
    result.push(finalizeProductionPlanningTreeRow(row, depth, rowById));

    const childRows = Array.from(row.childIds)
      .map((childId) => rowById.get(childId) ?? null)
      .filter((childRow): childRow is MutableProductionPlanningTreeRow => childRow !== null && childRow.parentIds.size === 1)
      .sort(compareMutableProductionPlanningTreeRows);
    for (const childRow of childRows) {
      emitRow(childRow, depth + 1);
    }
  };

  for (const row of orderedRows) {
    if (rootRowIds.has(row.id)) {
      emitRow(row, 0);
    }
  }

  for (const row of orderedRows) {
    emitRow(row, 0);
  }

  return result;
}

function resolveProductionPlanningRecipeDisplayFlow(row: ProductionPlanningTreeRecipeRow): number {
  const itemId = resolveProductionPlanningRecipeDisplayItemId(row);
  if (itemId !== null) {
    const outputPort = row.total?.outputs.find((port) => port.itemId === itemId)
      ?? row.recipeNode.outputs.find((port) => port.itemId === itemId);
    if (outputPort !== undefined) {
      return outputPort.perMinute;
    }
  }

  return row.total?.outputs[0]?.perMinute
    ?? row.recipeNode.outputs[0]?.perMinute
    ?? row.total?.inputs[0]?.perMinute
    ?? row.recipeNode.inputs[0]?.perMinute
    ?? row.total?.cyclesPerMinute
    ?? row.recipeNode.cyclesPerMinute;
}

function resolveProductionPlanningRecipeDisplayItemId(row: ProductionPlanningTreeRecipeRow): string | null {
  if (
    row.recipeNode.targetItemId.length > 0
    && (row.outputItemIds.includes(row.recipeNode.targetItemId)
      || row.total?.outputs.some((port) => port.itemId === row.recipeNode.targetItemId)
      || row.recipeNode.outputs.some((port) => port.itemId === row.recipeNode.targetItemId))
  ) {
    return row.recipeNode.targetItemId;
  }

  return row.outputItemIds[0]
    ?? row.total?.outputs[0]?.itemId
    ?? row.recipeNode.outputs[0]?.itemId
    ?? row.total?.inputs[0]?.itemId
    ?? row.recipeNode.inputs[0]?.itemId
    ?? null;
}

function resolveProductionPlanningLogisticsKind(
  itemId: string,
  index: ProductionPlanningIndex,
): "belt" | "pipe" {
  return index.itemById.get(itemId)?.tags.includes("liquid") ? "pipe" : "belt";
}

function resolveProductionPlanningLogisticsThroughput(kind: "belt" | "pipe"): number {
  const secondsPerCell = kind === "pipe" ? PIPE_TRANSPORT_DURATION_SECONDS : BELT_TRANSPORT_DURATION_SECONDS;
  return 60 / secondsPerCell;
}

/*
AI-REMOVED 2026-05-21:
Reason: 速率列改为可读的设备数、主产量和物流需求三段式展示，旧字符串把配方循环次数显示成 `/min`，容易被误解为物品产量。
Trigger: 用户要求速率列显示为 `设备数[设备图标] · 产量/min · 物流数[传送带/管道图标]`，界面单位只保留 `/min`。
Evidence: ProductionPlanningTreeRowRate 现在直接渲染结构化 JSX，并按主产物速率计算向上取整的物流数量。
Replacement: ProductionPlanningTreeRowRate / resolveProductionPlanningRecipeDisplayFlow / ProductionPlanningLogisticsRate
Risk: Low；仅改变表格展示，不改变求解结果。
Human Review: Required

Original code:
function formatProductionPlanningTreeRowRate(row: ProductionPlanningTreeRow): string {
  if (row.kind === "item") {
    return `${formatProductionFlow(row.total?.demandPerMinute ?? row.node.demandPerMinute)}/min`;
  }

  return `${formatProductionDeviceCount(row.total?.deviceCount ?? row.recipeNode.deviceCount)} · ${formatProductionFlow(row.total?.cyclesPerMinute ?? row.recipeNode.cyclesPerMinute)}/min`;
}
*/

function finalizeProductionPlanningTreeRow(
  row: MutableProductionPlanningTreeRow,
  depth: number,
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
): ProductionPlanningTreeRow {
  const parentIds = sortProductionPlanningTreeRowIds(row.parentIds, rowById);
  const childIds = sortProductionPlanningTreeRowIds(row.childIds, rowById);

  if (row.kind === "item") {
    return {
      id: row.id,
      kind: "item",
      depth,
      parentIds,
      childIds,
      itemId: row.itemId,
      node: row.node,
      nodes: row.nodes,
      total: row.total,
      producerIds: sortProductionPlanningTreeRowIds(row.producerIds, rowById),
      consumerIds: sortProductionPlanningTreeRowIds(row.consumerIds, rowById),
      isByproduct: row.isByproduct,
    };
  }

  return {
    id: row.id,
    kind: "recipe",
    depth,
    parentIds,
    childIds,
    recipeId: row.recipeId,
    targetItemId: row.targetItemId,
    recipeNode: row.recipeNode,
    recipeNodes: row.recipeNodes,
    total: row.total,
    inputItemIds: sortProductionPlanningTreeItemIds(row.inputItemIds, rowById),
    outputItemIds: sortProductionPlanningTreeItemIds(row.outputItemIds, rowById),
    isByproduct: row.isByproduct,
  };
}

function addProductionPlanningTreeEdge(
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
  parentId: string,
  childId: string,
): void {
  if (parentId === childId) {
    return;
  }

  const parent = rowById.get(parentId);
  const child = rowById.get(childId);
  if (parent === undefined || child === undefined) {
    return;
  }

  parent.childIds.add(childId);
  child.parentIds.add(parentId);
}

function buildProductionPlanningTreeItemRowId(itemId: string): string {
  return `item:${itemId}`;
}

// AI-REMOVED 2026-05-23:
// Reason: 函数定义后从未被调用
// Trigger: ESLint @typescript-eslint/no-unused-vars
// Evidence: grep 全仓库无调用点
// Replacement: None
// Risk: Low — 仅用于构建 rowId，无副作用
// Human Review: Not Required
//
// function buildProductionPlanningTreeRecipeRowId(recipeId: string): string {
//   return `recipe:${recipeId}`;
// }

function buildProductionPlanningTreeDeviceProductRowId(recipeId: string, targetItemId: string): string {
  return `recipe:${recipeId}:target:${targetItemId}`;
}

// AI-REMOVED 2026-05-23:
// Reason: ledger 树构建器(buildLedgerProductionPlanningTreeRows)已接管全部树表行生成
// Trigger: 清理死代码（kind=item 遗留来源）
// Replacement: buildLedgerProductionPlanningTreeRows
// Risk: Low
// Human Review: Not Required

function createProductionPlanningTreeSyntheticRecipeNode(
  recipeId: string,
  total: ProductionPlanningResult["recipeTotals"][number] | null,
  fallback: ProductionPlanningRecipeNode | null,
  targetItemId: string = fallback?.targetItemId ?? total?.outputs[0]?.itemId ?? total?.inputs[0]?.itemId ?? "",
): ProductionPlanningRecipeNode {
  if (total === null) {
    return fallback ?? {
      id: `total:${recipeId}`,
      kind: "recipe",
      recipeId,
      targetItemId,
      durationSeconds: 0,
      cyclesPerMinute: 0,
      deviceCount: 0,
      inputs: [],
      outputs: [],
      inputItems: [],
    };
  }

  return {
    id: fallback?.id ?? `total:${recipeId}`,
    kind: "recipe",
    recipeId,
    targetItemId,
    durationSeconds: total.durationSeconds,
    cyclesPerMinute: total.cyclesPerMinute,
    deviceCount: total.deviceCount,
    inputs: total.inputs.map(clonePort),
    outputs: total.outputs.map(clonePort),
    inputItems: fallback?.inputItems ?? [],
  };
}

function mergeProductionPlanningTreeRecipeNodes(
  left: ProductionPlanningRecipeNode,
  right: ProductionPlanningRecipeNode,
): ProductionPlanningRecipeNode {
  return {
    id: left.id,
    kind: "recipe",
    recipeId: left.recipeId,
    targetItemId: left.targetItemId,
    durationSeconds: left.durationSeconds || right.durationSeconds,
    cyclesPerMinute: left.cyclesPerMinute + right.cyclesPerMinute,
    deviceCount: left.deviceCount + right.deviceCount,
    inputs: mergeProductionPlanningTreePorts(left.inputs, right.inputs),
    outputs: mergeProductionPlanningTreePorts(left.outputs, right.outputs),
    inputItems: left.inputItems,
  };
}

function mergeProductionPlanningTreePorts(
  left: readonly ProductionPlanningPort[],
  right: readonly ProductionPlanningPort[],
): ProductionPlanningPort[] {
  const result = new Map<string, ProductionPlanningPort>();
  for (const port of [...left, ...right]) {
    const existing = result.get(port.itemId);
    if (existing === undefined) {
      result.set(port.itemId, clonePort(port));
      continue;
    }

    result.set(port.itemId, {
      ...existing,
      perMinute: existing.perMinute + port.perMinute,
    });
  }
  return Array.from(result.values());
}

function compareMutableProductionPlanningTreeRows(
  left: MutableProductionPlanningTreeRow,
  right: MutableProductionPlanningTreeRow,
): number {
  return left.order - right.order;
}

function sortProductionPlanningTreeRowIds(
  rowIds: ReadonlySet<string>,
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
): string[] {
  return Array.from(rowIds).sort((left, right) => {
    const leftRow = rowById.get(left);
    const rightRow = rowById.get(right);
    return (leftRow?.order ?? Number.MAX_SAFE_INTEGER) - (rightRow?.order ?? Number.MAX_SAFE_INTEGER);
  });
}

function sortProductionPlanningTreeItemIds(
  itemIds: ReadonlySet<string>,
  rowById: ReadonlyMap<string, MutableProductionPlanningTreeRow>,
): string[] {
  return Array.from(itemIds).sort((left, right) => {
    const leftRow = rowById.get(buildProductionPlanningTreeItemRowId(left));
    const rightRow = rowById.get(buildProductionPlanningTreeItemRowId(right));
    return (leftRow?.order ?? Number.MAX_SAFE_INTEGER) - (rightRow?.order ?? Number.MAX_SAFE_INTEGER);
  });
}

function uniqueProductionPlanningTreeRowIds(rowIds: readonly string[]): string[] {
  return Array.from(new Set(rowIds));
}

function resolveProductionPlanningTreeRowTitle(
  row: ProductionPlanningTreeRow,
  index: ProductionPlanningIndex,
  t: (key: string) => string,
): string {
  if (row.kind === "item") {
    return resolveProductionPlanningItemName(row.itemId, index, t);
  }

  const isExternal = isProductionPlanningExternalSupplyRecipeId(row.recipeId);
  const recipe = index.recipeById.get(row.recipeId);
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const title = isExternal
    ? t("productionPlanning.externalSupply")
    : machine === null ? row.recipeId : t(machine.nameKey);
  const productName = row.targetItemId.length > 0 ? resolveProductionPlanningItemName(row.targetItemId, index, t) : null;
  return productName === null ? title : `${title} · ${productName}`;
}

function FlowGraph({
  displayMode,
  flowViewport,
  plan,
  index,
  recipeChoices: _recipeChoices,
  onFlowViewportChange,
  onSelectRecipe: _onSelectRecipe,
  t,
}: {
  displayMode: ProductionPlanningDisplayMode;
  flowViewport: PlannerFlowViewportState;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  onFlowViewportChange: (viewport: PlannerFlowViewportState) => void;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  t: (key: string) => string;
}) {
  if (plan.roots.length === 0) {
    return <div className={cm(styles, "production-planning-empty")}>{t("productionPlanning.noRecipes")}</div>;
  }

  return (
    <ProductionFlowGraph
      displayMode={displayMode}
      initialViewport={flowViewport}
      plan={plan}
      index={index}
      onViewportChange={onFlowViewportChange}
      t={t}
    />
  );
}

// AI-REMOVED 2026-05-19:
// Reason: 产线规划的 flow 模式需要升级为真实画布流程图，旧实现只是顺序卡片列表，不满足“真正流程图”的需求。
// Trigger: 用户要求参考 factoriolab 的 Sankey 布局，并用 DOM 实现节点/连线画布。
// Evidence: 旧实现只渲染 production-planning-flow-step 网格卡片，没有节点坐标、边路径、回环或多输入多输出布局能力。
// Replacement: src/app/shell/production-planning/flow/production-flow-graph.tsx
// Risk: Low；tree 模式仍保留原 ItemTreeNode / RecipeCard，flow 模式由新组件接管。
// Human Review: Required
//
// Original code:
// function FlowCard({
//   indexInFlow,
//   children,
// }: {
//   indexInFlow: number;
//   children: ReactNode;
// }) {
//   return (
//     <div className={cm(styles, "production-planning-flow-step")}>
//       <div className={cm(styles, "production-planning-flow-index")}>{indexInFlow + 1}</div>
//       {children}
//     </div>
//   );
// }

function RecipeCard({
  recipeNode,
  index,
  t,
}: {
  recipeNode: ProductionPlanningRecipeNode;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  const recipe = index.recipeById.get(recipeNode.recipeId);
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const isExternal = isProductionPlanningExternalSupplyRecipeId(recipeNode.recipeId);

  const title = isExternal
    ? t("productionPlanning.externalSupply")
    : recipe === undefined
      ? recipeNode.recipeId
      : resolveProductionPlanningRecipeName(recipe, index, t);
  const subtitle = isExternal && recipeNode.targetItemId.length > 0
    ? `${t("productionPlanning.produced")} ${resolveProductionPlanningItemName(recipeNode.targetItemId, index, t)}`
    : machine === null ? recipeNode.recipeId : t(machine.nameKey);
  const iconSrc = isExternal
    ? resolveProductionPlanningExternalSupplyIconSrc()
    : recipe === undefined
      ? "/device-icons/item_port_grinder_1.webp"
      : resolveProductionPlanningEntityIconSrc(recipe.machineId);

  return (
    <article className={cm(styles, "production-planning-recipe-node")}>
      <div className={cm(styles, "production-planning-recipe-header")}>
        <img alt="" src={iconSrc} />
        <div>
          <h4>{title}</h4>
          <span>{subtitle}</span>
        </div>
      </div>
      <div className={cm(styles, "production-planning-recipe-meta")}>
        <Metric icon={<LucideClock3 />} label={t("productionPlanning.duration")} value={`${formatProductionFlow(recipeNode.durationSeconds)}s`} />
        <Metric icon={<LucideFactory />} label={t("productionPlanning.devices")} value={formatProductionDeviceCount(recipeNode.deviceCount)} />
        <Metric icon={<LucideGauge />} label={t("productionPlanning.cycles")} value={`${formatProductionFlow(recipeNode.cyclesPerMinute)}/min`} />
      </div>
      {recipe !== undefined && (
        <div className={cm(styles, "production-planning-recipe-formula")}>
          {recipe.inputs.map((input, i) => (
            <span key={`in-${input.itemId}`} className={cm(styles, "production-planning-recipe-formula-item")}>
              {i > 0 && <span className={cm(styles, "production-planning-recipe-formula-plus")}>+</span>}
              <span className={cm(styles, "production-planning-recipe-formula-icon")}>
                <img alt="" src={resolveProductionPlanningItemIconSrc(input.itemId, index)} />
                <span>{input.amount}</span>
              </span>
            </span>
          ))}
          <span className={cm(styles, "production-planning-recipe-formula-arrow")}>
            <span>▶▶</span>
            <span>{recipeNode.durationSeconds}{t("productionPlanning.second_short")}</span>
          </span>
          {recipe.outputs.map((output) => (
            <span key={`out-${output.itemId}`} className={cm(styles, "production-planning-recipe-formula-item")}>
              <span className={cm(styles, "production-planning-recipe-formula-icon")}>
                <img alt="" src={resolveProductionPlanningItemIconSrc(output.itemId, index)} />
                <span>{output.amount}</span>
              </span>
            </span>
          ))}
        </div>
      )}
      <div className={cm(styles, "production-planning-recipe-ports")}>
        <PortChipList title={t("productionPlanning.inputs")} ports={recipeNode.inputs} index={index} t={t} />
        <PortChipList title={t("productionPlanning.outputs")} ports={recipeNode.outputs} index={index} t={t} />
      </div>
    </article>
  );
}

function resolveProductionPlanningExternalSupplyPerMinute(node: ProductionPlanningItemNode): number {
  return node.supply.manual + node.supply.infinite;
}

function buildProductionPlanningExternalSupplyRecipeId(itemId: string): string {
  return `${EXTERNAL_SUPPLY_RECIPE_ID_PREFIX}${itemId}`;
}

function isProductionPlanningExternalSupplyRecipeId(recipeId: string): boolean {
  return recipeId.startsWith(EXTERNAL_SUPPLY_RECIPE_ID_PREFIX);
}

function createProductionPlanningExternalSupplyRecipeNode(
  node: ProductionPlanningItemNode,
  perMinute: number,
): ProductionPlanningRecipeNode {
  return {
    id: `${EXTERNAL_SUPPLY_RECIPE_ID_PREFIX}${node.id}`,
    kind: "recipe",
    recipeId: buildProductionPlanningExternalSupplyRecipeId(node.itemId),
    targetItemId: node.itemId,
    durationSeconds: 0,
    cyclesPerMinute: 0,
    deviceCount: 0,
    inputs: [],
    outputs: [{ id: `${node.id}-external-supply-out-${node.itemId}`, itemId: node.itemId, perMinute }],
    inputItems: [],
  };
}



function resolveProductionPlanningExternalSupplyIconSrc(): string {
  return `/3d-top-view/sprites/${EXTERNAL_SUPPLY_ENTITY_ID}.webp`;
}

function NodeStatus({
  node,
  t,
}: {
  node: ProductionPlanningItemNode;
  t: (key: string) => string;
}) {
  if (node.unresolvedPerMinute > 0) {
    return (
      <span className={cm(styles, "production-planning-status is-bad")}>
        {node.blockedByCycle ? t("productionPlanning.blockedCycle") : t("productionPlanning.unresolved")}
      </span>
    );
  }

  if (node.isCycleSource) {
    return <span className={cm(styles, "production-planning-status is-cycle")}>{t("productionPlanning.cycleSource")}</span>;
  }

  if (node.isInfiniteSource) {
    return <span className={cm(styles, "production-planning-status is-good")}>{t("productionPlanning.infiniteSource")}</span>;
  }

  if (node.suppliedPerMinute > 0 && node.producedPerMinute <= 0) {
    return <span className={cm(styles, "production-planning-status is-good")}>{t("productionPlanning.supplied")}</span>;
  }

  return null;
}

function RecipeSelect({
  itemId,
  recipes,
  index,
  selectedRecipeId,
  onSelectRecipe,
  t,
}: {
  itemId: string;
  recipes: readonly RecipeDefinition[];
  index: ProductionPlanningIndex;
  selectedRecipeId: string | null;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  t: (key: string) => string;
}) {
  return (
    <label className={cm(styles, "production-planning-recipe-select")}>
      <span>{t("productionPlanning.recipe")}</span>
      <select
        value={selectedRecipeId ?? ""}
        onChange={(event) => onSelectRecipe(itemId, event.currentTarget.value.length === 0 ? null : event.currentTarget.value)}
      >
        <option value="">{t("productionPlanning.autoRecipe")}</option>
        {recipes.map((recipe) => (
          <option key={recipe.id} value={recipe.id}>
            {resolveProductionPlanningRecipeName(recipe, index, t)}
            {isRecipeExcludedFromProductionPlanningAuto(recipe) ? ` · ${t("productionPlanning.manualOnly")}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function ItemIdentity({
  itemId,
  index,
  t,
}: {
  itemId: string;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-item-identity")}>
      <img alt="" src={resolveProductionPlanningItemIconSrc(itemId, index)} />
      <strong>{resolveProductionPlanningItemName(itemId, index, t)}</strong>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <span className={cm(styles, ["production-planning-metric", tone === "good" ? "is-good" : "", tone === "bad" ? "is-bad" : ""].filter(Boolean).join(" "))}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function PortChipList({
  title,
  ports,
  index,
  t,
}: {
  title: string;
  ports: readonly ProductionPlanningPort[];
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-port-chip-list")}>
      <span>{title}</span>
      <div>
        {ports.length === 0 ? (
          <span className={cm(styles, "production-planning-muted")}>{t("productionPlanning.none")}</span>
        ) : ports.map((port) => (
          <span key={`${port.id}-${port.itemId}`} className={cm(styles, "production-planning-port-chip")}>
            <img alt="" src={resolveProductionPlanningItemIconSrc(port.itemId, index)} />
            <span>{resolveProductionPlanningItemName(port.itemId, index, t)}</span>
            <strong>{formatProductionFlow(port.perMinute)}/min</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function createPort(itemId: string, perMinute: number): ProductionPlanningPort {
  return {
    id: createProductionPlanningId("port"),
    itemId,
    perMinute,
  };
}

function clonePort(port: ProductionPlanningPort): ProductionPlanningPort {
  return {
    id: port.id,
    itemId: port.itemId,
    perMinute: port.perMinute,
    ...(port.isInfinite === true ? { isInfinite: true } : {}),
  };
}

function updateRecipeChoices(
  current: Readonly<Record<string, string>>,
  itemId: string,
  recipeId: string | null,
): Record<string, string> {
  const next = { ...current };
  if (recipeId === null) {
    delete next[itemId];
  } else {
    next[itemId] = recipeId;
  }
  return next;
}

function updatePort(
  ports: readonly ProductionPlanningPort[],
  id: string,
  patch: Partial<ProductionPlanningPort>,
): ProductionPlanningPort[] {
  return ports.map((port) => port.id === id ? { ...port, ...patch } : port);
}

function normalizeFlowInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function shouldIgnoreProductionPlanningSwipeStart(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  // 2026-05-20 订正：流程图画布内触控拖拽用于平移/缩放，不应被误判为切屏滑动手势
  if (target.closest("[class*='production-flow-canvas']") !== null) {
    return true;
  }

  return target.closest("button, input, select, textarea, [role='button'], [role='tab']") !== null;
}
