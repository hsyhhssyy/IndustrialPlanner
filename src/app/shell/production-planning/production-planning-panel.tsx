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
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideWorkflow from "~icons/lucide/workflow";

import type { AppHost } from "@/app/host/app-host";
import type { PlannerFlowViewportState } from "@/shared/storage/planner-storage";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
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
};

type ProductionPlanningTreeRecipeRow = ProductionPlanningTreeRowBase & {
  readonly kind: "recipe";
  readonly recipeId: string;
  readonly recipeNode: ProductionPlanningRecipeNode;
  readonly recipeNodes: readonly ProductionPlanningRecipeNode[];
  readonly total: ProductionPlanningResult["recipeTotals"][number] | null;
  readonly inputItemIds: readonly string[];
  readonly outputItemIds: readonly string[];
};

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
  const infiniteItemIds = useMemo(() => {
    const result = new Set(index.naturalResourceItemIds);
    if (sourceConfig.sewagePolicy === "external-supply") {
      result.add("item_liquid_sewage");
    }
    return result;
  }, [index.naturalResourceItemIds, sourceConfig.sewagePolicy]);
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
                void requestItemSelection((itemId) => updateSupply(id, { itemId }));
              }}
              onRemove={(id) => { store.supplies = store.supplies.filter((line) => line.id !== id); }}
              onUpdateRate={(id, perMinute) => updateSupply(id, { perMinute })}
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
            <div className={cm(styles, "production-planning-graph")}>
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
  t,
}: {
  line: ProductionPlanningPort;
  index: ProductionPlanningIndex;
  onPickItem: () => void;
  onRemove: () => void;
  onUpdateRate: (perMinute: number) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-line-row")}>
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
          type="number"
          min="0"
          step="0.01"
          value={line.perMinute}
          onChange={(event) => onUpdateRate(normalizeFlowInput(event.currentTarget.value))}
        />
      </label>
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

  if (displayMode === "device") {
    return (
      <ProductionPlanningTreeTable
        displayMode={displayMode}
        plan={plan}
        index={index}
        recipeChoices={recipeChoices}
        treeScrollTop={treeScrollTop}
        onSelectRecipe={onSelectRecipe}
        onTreeScrollTopChange={onTreeScrollTopChange}
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
  onTreeScrollTopChange,
  t,
}: {
  displayMode: ProductionPlanningDisplayMode;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  treeScrollTop: number;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  onTreeScrollTopChange: (scrollTop: number) => void;
  t: (key: string) => string;
}) {
  const rows = useMemo(() => buildProductionPlanningTreeRows(plan, displayMode), [displayMode, plan]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const treePaneRef = useRef<HTMLDivElement | null>(null);
  const rowElementRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const selectedRow = (selectedRowId === null ? null : rowById.get(selectedRowId) ?? null) ?? rows[0] ?? null;

  useLayoutEffect(() => {
    const element = treePaneRef.current;
    if (element === null) {
      return;
    }

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.min(treeScrollTop, maxScrollTop);
  }, [rows, treeScrollTop]);

  const selectRow = (rowId: string) => {
    setSelectedRowId(rowId);
    requestAnimationFrame(() => {
      rowElementRefs.current.get(rowId)?.scrollIntoView({ block: "nearest" });
    });
  };

  if (rows.length === 0) {
    return <div className={cm(styles, "production-planning-empty")}>{t("productionPlanning.noRecipes")}</div>;
  }

  return (
    <div className={cm(styles, "production-planning-tree-table-layout")}>
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
            {rows.map((row) => (
              <ProductionPlanningTreeTableRow
                key={row.id}
                row={row}
                index={index}
                selected={selectedRow?.id === row.id}
                onSelect={() => selectRow(row.id)}
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
            recipeChoices={recipeChoices}
            onSelectRow={selectRow}
            onSelectRecipe={onSelectRecipe}
            t={t}
          />
        )}
      </aside>
    </div>
  );
}

function ProductionPlanningTreeTableRow({
  row,
  index,
  selected,
  onSelect,
  setRowElement,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  selected: boolean;
  onSelect: () => void;
  setRowElement: (element: HTMLTableRowElement | null) => void;
  t: (key: string) => string;
}) {
  const className = [
    "production-planning-tree-table-row",
    row.kind === "recipe" ? "is-recipe" : "is-item",
    row.parentIds.length > 1 ? "is-shared" : "",
    selected ? "is-active" : "",
  ].filter(Boolean).join(" ");

  return (
    <tr className={cm(styles, className)} ref={setRowElement}>
      <td>
        <button
          type="button"
          className={cm(styles, "production-planning-tree-table-node-button")}
          style={{ "--tree-depth": row.depth } as CSSProperties}
          aria-pressed={selected}
          onClick={onSelect}
        >
          <span className={cm(styles, "production-planning-tree-table-branch")} aria-hidden="true" />
          {row.kind === "item" ? (
            <ItemIdentity itemId={row.itemId} index={index} t={t} />
          ) : (
            <RecipeIdentity recipeNode={row.recipeNode} index={index} t={t} />
          )}
          {row.parentIds.length > 1 && (
            <span className={cm(styles, "production-planning-tree-table-chip")}>
              {t("productionPlanning.shared")}
            </span>
          )}
        </button>
      </td>
      <td>
        <ProductionPlanningTreeRowRate row={row} index={index} t={t} />
      </td>
    </tr>
  );
}

function ProductionPlanningTreeRowRate({
  row,
  index,
  t,
}: {
  row: ProductionPlanningTreeRow;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  if (row.kind === "item") {
    const flowPerMinute = row.total?.demandPerMinute ?? row.node.demandPerMinute;
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
  recipeChoices,
  onSelectRow,
  onSelectRecipe,
  t,
}: {
  row: ProductionPlanningTreeRow;
  rowById: ReadonlyMap<string, ProductionPlanningTreeRow>;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  onSelectRow: (rowId: string) => void;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  t: (key: string) => string;
}) {
  if (row.kind === "recipe") {
    return (
      <article className={cm(styles, "production-planning-tree-detail-stack")}>
        <RecipeCard recipeNode={row.recipeNode} index={index} t={t} />
        <ProductionPlanningTreeRelations
          groups={[
            {
              label: t("productionPlanning.outputs"),
              rowIds: row.outputItemIds.map((itemId) => buildProductionPlanningTreeItemRowId(itemId)),
            },
            {
              label: t("productionPlanning.inputs"),
              rowIds: row.inputItemIds.map((itemId) => buildProductionPlanningTreeItemRowId(itemId)),
            },
          ]}
          rowById={rowById}
          index={index}
          onSelectRow={onSelectRow}
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
        onSelectRow={onSelectRow}
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
  return (
    <>
      <img
        alt=""
        src={recipe === undefined ? "/device-icons/item_port_grinder_1.webp" : resolveProductionPlanningEntityIconSrc(recipe.machineId)}
      />
      <span>{recipe === undefined ? row.recipeId : resolveProductionPlanningRecipeName(recipe, index, t)}</span>
    </>
  );
}

function RecipeIdentity({
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
  const title = recipe === undefined
    ? recipeNode.recipeId
    : resolveProductionPlanningRecipeName(recipe, index, t);

  return (
    <div className={cm(styles, "production-planning-recipe-identity")}>
      <img
        alt=""
        src={recipe === undefined ? "/device-icons/item_port_grinder_1.webp" : resolveProductionPlanningEntityIconSrc(recipe.machineId)}
      />
      <div>
        <strong>{title}</strong>
        <span>{machine === null ? recipeNode.recipeId : t(machine.nameKey)}</span>
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
};

type MutableProductionPlanningTreeRecipeRow = MutableProductionPlanningTreeRowBase & {
  kind: "recipe";
  recipeId: string;
  recipeNode: ProductionPlanningRecipeNode;
  recipeNodes: ProductionPlanningRecipeNode[];
  total: ProductionPlanningResult["recipeTotals"][number] | null;
  inputItemIds: Set<string>;
  outputItemIds: Set<string>;
};

function buildProductionPlanningTreeRows(
  plan: ProductionPlanningResult,
  displayMode: ProductionPlanningDisplayMode,
): ProductionPlanningTreeRow[] {
  const itemTotals = new Map(plan.itemTotals.map((total) => [total.itemId, total]));
  const recipeTotals = new Map(plan.recipeTotals.map((total) => [total.recipeId, total]));
  const rowById = new Map<string, MutableProductionPlanningTreeRow>();
  const rootRowIds = new Set<string>();
  const expandedItemIds = new Set<string>();
  const expandedRecipeIds = new Set<string>();
  const preferDeviceRecipeOrder = displayMode === "device";
  let nextOrder = 0;

  const ensureItemRow = (
    itemId: string,
    node: ProductionPlanningItemNode | null,
  ): MutableProductionPlanningTreeItemRow => {
    const rowId = buildProductionPlanningTreeItemRowId(itemId);
    const existing = rowById.get(rowId);
    const total = itemTotals.get(itemId) ?? null;
    if (existing !== undefined) {
      if (existing.kind !== "item") {
        throw new Error(`Production planning tree row id collision: ${rowId}`);
      }
      existing.total = total;
      if (node !== null) {
        if (!existing.nodes.some((candidate) => candidate.id === node.id)) {
          existing.nodes.push(node);
        }
        if (existing.node.id.startsWith("total:") || (existing.node.recipeNode === null && node.recipeNode !== null)) {
          existing.node = node;
        }
      }
      return existing;
    }

    const itemRow: MutableProductionPlanningTreeItemRow = {
      id: rowId,
      kind: "item",
      depth: 0,
      order: nextOrder,
      parentIds: new Set(),
      childIds: new Set(),
      itemId,
      node: node ?? createProductionPlanningTreeSyntheticItemNode(itemId, total),
      nodes: node === null ? [] : [node],
      total,
      producerIds: new Set(),
      consumerIds: new Set(),
    };
    nextOrder += 1;
    rowById.set(rowId, itemRow);
    return itemRow;
  };

  const ensureRecipeRow = (
    recipeId: string,
    recipeNode: ProductionPlanningRecipeNode | null,
  ): MutableProductionPlanningTreeRecipeRow => {
    const rowId = buildProductionPlanningTreeRecipeRowId(recipeId);
    const existing = rowById.get(rowId);
    const total = recipeTotals.get(recipeId) ?? null;
    if (existing !== undefined) {
      if (existing.kind !== "recipe") {
        throw new Error(`Production planning tree row id collision: ${rowId}`);
      }
      existing.total = total;
      if (recipeNode !== null && !existing.recipeNodes.some((candidate) => candidate.id === recipeNode.id)) {
        existing.recipeNodes.push(recipeNode);
      }
      if (total !== null) {
        existing.recipeNode = createProductionPlanningTreeSyntheticRecipeNode(recipeId, total, existing.recipeNode);
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
      recipeNode: total === null && recipeNode !== null
        ? recipeNode
        : createProductionPlanningTreeSyntheticRecipeNode(recipeId, total, recipeNode),
      recipeNodes: recipeNode === null ? [] : [recipeNode],
      total,
      inputItemIds: new Set(),
      outputItemIds: new Set(),
    };
    nextOrder += 1;
    rowById.set(rowId, recipeRow);
    return recipeRow;
  };

  const visitItemNode = (
    node: ProductionPlanningItemNode,
    parentRecipeRowId: string | null,
  ): MutableProductionPlanningTreeItemRow => {
    const itemRow = ensureItemRow(node.itemId, node);

    if (parentRecipeRowId !== null) {
      const parentRecipeRow = rowById.get(parentRecipeRowId);
      if (parentRecipeRow?.kind === "recipe") {
        parentRecipeRow.inputItemIds.add(node.itemId);
      }
      itemRow.consumerIds.add(parentRecipeRowId);
      addProductionPlanningTreeEdge(rowById, parentRecipeRowId, itemRow.id);
    }

    if (node.recipeNode === null) {
      return itemRow;
    }

    const recipeRow = ensureRecipeRow(node.recipeNode.recipeId, node.recipeNode);
    itemRow.producerIds.add(recipeRow.id);
    recipeRow.outputItemIds.add(node.itemId);
    addProductionPlanningTreeEdge(rowById, itemRow.id, recipeRow.id);

    if (expandedItemIds.has(node.itemId)) {
      return itemRow;
    }
    expandedItemIds.add(node.itemId);
    visitRecipeNode(node.recipeNode);

    return itemRow;
  };

  const visitRecipeNode = (recipeNode: ProductionPlanningRecipeNode): MutableProductionPlanningTreeRecipeRow => {
    const recipeRow = ensureRecipeRow(recipeNode.recipeId, recipeNode);

    for (const output of recipeNode.outputs) {
      const outputItemRow = ensureItemRow(output.itemId, null);
      recipeRow.outputItemIds.add(output.itemId);
      outputItemRow.producerIds.add(recipeRow.id);
    }

    if (expandedRecipeIds.has(recipeRow.id)) {
      return recipeRow;
    }
    expandedRecipeIds.add(recipeRow.id);

    const inputItems = preferDeviceRecipeOrder
      ? [...recipeNode.inputItems].sort((left, right) => {
        const leftHasRecipe = left.recipeNode === null ? 1 : 0;
        const rightHasRecipe = right.recipeNode === null ? 1 : 0;
        return leftHasRecipe - rightHasRecipe;
      })
      : recipeNode.inputItems;

    for (const child of inputItems) {
      visitItemNode(child, recipeRow.id);
    }

    return recipeRow;
  };

  for (const root of plan.roots) {
    const rootRow = visitItemNode(root, null);
    rootRowIds.add(rootRow.id);
  }

  for (const total of plan.itemTotals) {
    ensureItemRow(total.itemId, null);
  }

  for (const total of plan.recipeTotals) {
    const recipeRow = ensureRecipeRow(total.recipeId, null);
    for (const input of total.inputs) {
      const inputItemRow = ensureItemRow(input.itemId, null);
      recipeRow.inputItemIds.add(input.itemId);
      inputItemRow.consumerIds.add(recipeRow.id);
      addProductionPlanningTreeEdge(rowById, recipeRow.id, inputItemRow.id);
    }
    for (const output of total.outputs) {
      const outputItemRow = ensureItemRow(output.itemId, null);
      recipeRow.outputItemIds.add(output.itemId);
      outputItemRow.producerIds.add(recipeRow.id);
    }
    if (recipeRow.parentIds.size === 0 && recipeRow.outputItemIds.size === 0) {
      rootRowIds.add(recipeRow.id);
    }
  }

  const orderedRows = Array.from(rowById.values()).sort(compareMutableProductionPlanningTreeRows);
  for (const row of orderedRows) {
    if (row.parentIds.size !== 1) {
      rootRowIds.add(row.id);
    }
  }

  return finalizeProductionPlanningTreeRows(rowById, rootRowIds);
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
  return kind === "pipe" ? 120 : 30;
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
    };
  }

  return {
    id: row.id,
    kind: "recipe",
    depth,
    parentIds,
    childIds,
    recipeId: row.recipeId,
    recipeNode: row.recipeNode,
    recipeNodes: row.recipeNodes,
    total: row.total,
    inputItemIds: sortProductionPlanningTreeItemIds(row.inputItemIds, rowById),
    outputItemIds: sortProductionPlanningTreeItemIds(row.outputItemIds, rowById),
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

function buildProductionPlanningTreeRecipeRowId(recipeId: string): string {
  return `recipe:${recipeId}`;
}

function createProductionPlanningTreeSyntheticItemNode(
  itemId: string,
  total: ProductionPlanningResult["itemTotals"][number] | null,
): ProductionPlanningItemNode {
  return {
    id: `total:${itemId}`,
    kind: "item",
    itemId,
    demandPerMinute: total?.demandPerMinute ?? 0,
    suppliedPerMinute: total?.suppliedPerMinute ?? 0,
    producedPerMinute: total?.producedPerMinute ?? 0,
    unresolvedPerMinute: total?.unresolvedPerMinute ?? 0,
    supply: {
      manual: 0,
      surplus: 0,
      infinite: 0,
      cycle: 0,
    },
    recipeNode: null,
    isInfiniteSource: false,
    isCycleSource: false,
    blockedByCycle: false,
  };
}

function createProductionPlanningTreeSyntheticRecipeNode(
  recipeId: string,
  total: ProductionPlanningResult["recipeTotals"][number] | null,
  fallback: ProductionPlanningRecipeNode | null,
): ProductionPlanningRecipeNode {
  if (total === null) {
    return fallback ?? {
      id: `total:${recipeId}`,
      kind: "recipe",
      recipeId,
      targetItemId: "",
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
    targetItemId: fallback?.targetItemId ?? total.outputs[0]?.itemId ?? total.inputs[0]?.itemId ?? "",
    durationSeconds: total.durationSeconds,
    cyclesPerMinute: total.cyclesPerMinute,
    deviceCount: total.deviceCount,
    inputs: total.inputs.map(clonePort),
    outputs: total.outputs.map(clonePort),
    inputItems: fallback?.inputItems ?? [],
  };
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

  const recipe = index.recipeById.get(row.recipeId);
  return recipe === undefined ? row.recipeId : resolveProductionPlanningRecipeName(recipe, index, t);
}

/*
AI-REMOVED 2026-05-21:
Reason: 树表需要吸收 EndfieldLab 的共享产物逻辑；旧实现直接按递归实例追加行，相同物品/配方会在多父级场景重复出现，无法表达共享节点和跳转。
Trigger: 用户要求“先改一版，吸取 endfieldlab 的共享产物逻辑”。
Evidence: EndfieldLab 对多 parents 的 step 不继续作为单一子节点缩进，而是在详情/流程中保留多关联；当前替代实现使用 buildProductionPlanningTreeRows 内的规范化 rowById、parentIds、producerIds、consumerIds。
Replacement: buildProductionPlanningTreeRows / finalizeProductionPlanningTreeRows
Risk: Medium；这是展示层归并，求解核心仍保持原有按需求递归计算。
Human Review: Required

Original code:
function buildProductionPlanningTreeRows(
  plan: ProductionPlanningResult,
  displayMode: ProductionPlanningDisplayMode,
): ProductionPlanningTreeRow[] {
  const rows: ProductionPlanningTreeRow[] = [];

  for (const root of plan.roots) {
    if (displayMode === "device") {
      pushDeviceTreeRows(root, rows);
    } else {
      pushItemTreeRows(root, 0, rows);
    }
  }

  return rows;
}

function pushItemTreeRows(
  node: ProductionPlanningItemNode,
  depth: number,
  rows: ProductionPlanningTreeRow[],
): void {
  rows.push({
    id: `item:${node.id}`,
    kind: "item",
    depth,
    node,
  });

  if (node.recipeNode === null) {
    return;
  }

  rows.push({
    id: `recipe:${node.recipeNode.id}`,
    kind: "recipe",
    depth: depth + 1,
    recipeNode: node.recipeNode,
  });

  for (const child of node.recipeNode.inputItems) {
    pushItemTreeRows(child, depth + 2, rows);
  }
}

function pushDeviceTreeRows(
  root: ProductionPlanningItemNode,
  rows: ProductionPlanningTreeRow[],
): void {
  rows.push({
    id: `target:${root.id}`,
    kind: "item",
    depth: 0,
    node: root,
  });

  if (root.recipeNode !== null) {
    pushDeviceRecipeTreeRows(root.recipeNode, 1, rows);
  }
}

function pushDeviceRecipeTreeRows(
  recipeNode: ProductionPlanningRecipeNode,
  depth: number,
  rows: ProductionPlanningTreeRow[],
): void {
  rows.push({
    id: `recipe:${recipeNode.id}`,
    kind: "recipe",
    depth,
    recipeNode,
  });

  for (const child of recipeNode.inputItems) {
    if (child.recipeNode === null) {
      rows.push({
        id: `item:${child.id}`,
        kind: "item",
        depth: depth + 1,
        node: child,
      });
    } else {
      pushDeviceRecipeTreeRows(child.recipeNode, depth + 1, rows);
    }
  }
}
*/

/*
AI-REMOVED 2026-05-21:
Reason: 树状图已改为树表 + 详情面板，旧递归卡片树会重新制造深层缩进挤占内容的问题。
Trigger: 用户要求先改成树表 + 详情面板。
Evidence: ProductionPlanningTreeTable 现在统一承载 item/device 树状视图，Playwright 验证复杂目标“精选荞愈胶囊”在物品/设备模式下均正常显示。
Replacement: ProductionPlanningTreeTable / buildProductionPlanningTreeRows
Risk: Low；流程图路径不受影响，旧卡片细节由右侧详情面板复用 RecipeCard / ItemIdentity / NodeStatus。
Human Review: Required

Original code:
function ItemTreeNode({
  node,
  depth,
  index,
  recipeChoices,
  onSelectRecipe,
  t,
}: {
  node: ProductionPlanningItemNode;
  depth: number;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  t: (key: string) => string;
}) {
  const recipes = index.recipesByOutputItem.get(node.itemId) ?? [];

  return (
    <article className={cm(styles, "production-planning-item-node")} style={{ "--tree-depth": depth } as CSSProperties}>
      <div className={cm(styles, "production-planning-item-node-main")}>
        <ItemIdentity itemId={node.itemId} index={index} t={t} />
        <div className={cm(styles, "production-planning-node-metrics")}>
          <Metric label={t("productionPlanning.demand")} value={formatProductionFlow(node.demandPerMinute)} />
          <Metric label={t("productionPlanning.supply")} value={formatProductionFlow(node.suppliedPerMinute)} tone={node.suppliedPerMinute > 0 ? "good" : undefined} />
          <Metric label={t("productionPlanning.produced")} value={formatProductionFlow(node.producedPerMinute)} />
          <Metric label={t("productionPlanning.missing")} value={formatProductionFlow(node.unresolvedPerMinute)} tone={node.unresolvedPerMinute > 0 ? "bad" : undefined} />
        </div>
        <NodeStatus node={node} t={t} />
      </div>
      {recipes.length > 0 && (
        <RecipeSelect
          itemId={node.itemId}
          recipes={recipes}
          index={index}
          selectedRecipeId={recipeChoices.get(node.itemId) ?? null}
          onSelectRecipe={onSelectRecipe}
          t={t}
        />
      )}
      {node.recipeNode !== null && (
        <div className={cm(styles, "production-planning-node-children")}>
          <RecipeCard recipeNode={node.recipeNode} index={index} t={t} />
          {node.recipeNode.inputItems.map((child) => (
            <ItemTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              index={index}
              recipeChoices={recipeChoices}
              onSelectRecipe={onSelectRecipe}
              t={t}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function DeviceTreeRoot({
  root,
  index,
  t,
}: {
  root: ProductionPlanningItemNode;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  return (
    <section className={cm(styles, "production-planning-device-root")}>
      <div className={cm(styles, "production-planning-device-root-target")}>
        <LucideTarget />
        <ItemIdentity itemId={root.itemId} index={index} t={t} />
        <span>{formatProductionFlow(root.demandPerMinute)}/min</span>
      </div>
      {root.recipeNode === null ? (
        <LeafItem node={root} index={index} t={t} />
      ) : (
        <DeviceRecipeTree recipeNode={root.recipeNode} depth={0} index={index} t={t} />
      )}
    </section>
  );
}

function DeviceRecipeTree({
  recipeNode,
  depth,
  index,
  t,
}: {
  recipeNode: ProductionPlanningRecipeNode;
  depth: number;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-device-tree-node")} style={{ "--tree-depth": depth } as CSSProperties}>
      <RecipeCard recipeNode={recipeNode} index={index} t={t} />
      <div className={cm(styles, "production-planning-node-children")}>
        {recipeNode.inputItems.map((child) => (
          child.recipeNode === null
            ? <LeafItem key={child.id} node={child} index={index} t={t} />
            : <DeviceRecipeTree key={child.recipeNode.id} recipeNode={child.recipeNode} depth={depth + 1} index={index} t={t} />
        ))}
      </div>
    </div>
  );
}
*/

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
  const title = recipe === undefined
    ? recipeNode.recipeId
    : resolveProductionPlanningRecipeName(recipe, index, t);

  return (
    <article className={cm(styles, "production-planning-recipe-node")}>
      <div className={cm(styles, "production-planning-recipe-header")}>
        <img
          alt=""
          src={recipe === undefined ? "/device-icons/item_port_grinder_1.webp" : resolveProductionPlanningEntityIconSrc(recipe.machineId)}
        />
        <div>
          <h4>{title}</h4>
          <span>{machine === null ? recipeNode.recipeId : t(machine.nameKey)}</span>
        </div>
      </div>
      <div className={cm(styles, "production-planning-recipe-meta")}>
        <Metric icon={<LucideClock3 />} label={t("productionPlanning.duration")} value={`${formatProductionFlow(recipeNode.durationSeconds)}s`} />
        <Metric icon={<LucideFactory />} label={t("productionPlanning.devices")} value={formatProductionDeviceCount(recipeNode.deviceCount)} />
        <Metric icon={<LucideGauge />} label={t("productionPlanning.cycles")} value={`${formatProductionFlow(recipeNode.cyclesPerMinute)}/min`} />
      </div>
      <div className={cm(styles, "production-planning-recipe-ports")}>
        <PortChipList title={t("productionPlanning.inputs")} ports={recipeNode.inputs} index={index} t={t} />
        <PortChipList title={t("productionPlanning.outputs")} ports={recipeNode.outputs} index={index} t={t} />
      </div>
    </article>
  );
}

/*
AI-REMOVED 2026-05-21:
Reason: 旧 DeviceRecipeTree 已归档，LeafItem 仅服务旧递归设备树，当前树表行直接使用 item row 表达叶子物品。
Trigger: 用户要求先改成树表 + 详情面板。
Evidence: pushDeviceRecipeTreeRows 直接生成 leaf item 的 ProductionPlanningTreeItemRow；Playwright 设备模式验证已覆盖叶子物品显示。
Replacement: pushDeviceRecipeTreeRows / ProductionPlanningTreeTableRow
Risk: Low
Human Review: Required

Original code:
function LeafItem({
  node,
  index,
  t,
}: {
  node: ProductionPlanningItemNode;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "production-planning-leaf-item")}>
      <ItemIdentity itemId={node.itemId} index={index} t={t} />
      <span>{formatProductionFlow(node.demandPerMinute)}/min</span>
      <NodeStatus node={node} t={t} />
    </div>
  );
}
*/

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
