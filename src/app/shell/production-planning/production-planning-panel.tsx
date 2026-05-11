import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { observer } from "mobx-react-lite";
import LucideBox from "~icons/lucide/box";
import LucideBoxes from "~icons/lucide/boxes";
import LucideClock3 from "~icons/lucide/clock-3";
import LucideFactory from "~icons/lucide/factory";
import LucideGauge from "~icons/lucide/gauge";
import LucideInfinity from "~icons/lucide/infinity";
import LucideListTree from "~icons/lucide/list-tree";
import LucideNetwork from "~icons/lucide/network";
import LucidePackagePlus from "~icons/lucide/package-plus";
import LucidePlus from "~icons/lucide/plus";
import LucideTarget from "~icons/lucide/target";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideWorkflow from "~icons/lucide/workflow";

import type { AppHost } from "@/app/host/app-host";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import {
  PRODUCTION_PLANNING_SPECIAL_INFINITE_ITEM_IDS,
  buildProductionPlanningIndex,
  computeProductionPlan,
  createProductionPlanningId,
  flattenProductionPlanningItemNodes,
  flattenProductionPlanningRecipeNodes,
  formatProductionDeviceCount,
  formatProductionFlow,
  isRecipeExcludedFromProductionPlanningAuto,
  resolveProductionPlanningEntityIconSrc,
  resolveProductionPlanningItemIconSrc,
  resolveProductionPlanningItemName,
  resolveProductionPlanningRecipeName,
  type ProductionPlanningDisplayMode,
  type ProductionPlanningIndex,
  type ProductionPlanningItemNode,
  type ProductionPlanningPort,
  type ProductionPlanningRecipeNode,
  type ProductionPlanningRecipeTotal,
  type ProductionPlanningResult,
  type ProductionPlanningViewMode,
} from "@/app/shell/production-planning/production-planning-model";

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
  const [targets, setTargets] = useState<ProductionPlanningPort[]>([]);
  const [supplies, setSupplies] = useState<ProductionPlanningPort[]>([]);
  const [displayMode, setDisplayMode] = useState<ProductionPlanningDisplayMode>("item");
  const [viewMode, setViewMode] = useState<ProductionPlanningViewMode>("tree");
  const [specialInfiniteItemIds, setSpecialInfiniteItemIds] = useState<Set<string>>(() => new Set());
  const [recipeChoices, setRecipeChoices] = useState<Record<string, string>>({});
  const infiniteItemIds = useMemo(() => {
    const result = new Set(index.mineralItemIds);
    for (const itemId of specialInfiniteItemIds) {
      result.add(itemId);
    }
    return result;
  }, [index.mineralItemIds, specialInfiniteItemIds]);
  const recipeChoiceMap = useMemo(() => new Map(Object.entries(recipeChoices)), [recipeChoices]);
  const plan = useMemo(
    () => computeProductionPlan({
      targets,
      supplies,
      infiniteItemIds,
      recipeChoices: recipeChoiceMap,
    }, index),
    [index, infiniteItemIds, recipeChoiceMap, supplies, targets],
  );

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
      setTargets((current) => [...current, createPort(itemId, 60)]);
    });
  };

  const addSupply = () => {
    void requestItemSelection((itemId) => {
      setSupplies((current) => [...current, createPort(itemId, 60)]);
    });
  };

  const updateTarget = (id: string, patch: Partial<ProductionPlanningPort>) => {
    setTargets((current) => updatePort(current, id, patch));
  };

  const updateSupply = (id: string, patch: Partial<ProductionPlanningPort>) => {
    setSupplies((current) => updatePort(current, id, patch));
  };

  const selectRecipe = (itemId: string, recipeId: string | null) => {
    setRecipeChoices((current) => {
      const next = { ...current };
      if (recipeId === null) {
        delete next[itemId];
      } else {
        next[itemId] = recipeId;
      }
      return next;
    });
  };

  const toggleSpecialInfiniteItem = (itemId: string, infinite: boolean) => {
    setSpecialInfiniteItemIds((current) => {
      const next = new Set(current);
      if (infinite) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
  };

  const panelClassName = [
    "production-planning-panel",
    isTouch ? "is-touch" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={panelClassName}>
      <section className="production-planning-config">
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
          onRemove={(id) => setTargets((current) => current.filter((line) => line.id !== id))}
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
          onRemove={(id) => setSupplies((current) => current.filter((line) => line.id !== id))}
          onUpdateRate={(id, perMinute) => updateSupply(id, { perMinute })}
          t={t}
        />
        <SourcePolicyPanel
          index={index}
          infiniteItemIds={infiniteItemIds}
          specialInfiniteItemIds={specialInfiniteItemIds}
          onToggleSpecialInfiniteItem={toggleSpecialInfiniteItem}
          t={t}
        />
      </section>

      <section className="production-planning-workspace">
        <div className="production-planning-toolbar">
          <SegmentedControl<ProductionPlanningDisplayMode>
            label={t("productionPlanning.displayMode")}
            value={displayMode}
            options={[
              { value: "item", label: t("productionPlanning.modeItem"), icon: <LucideBox /> },
              { value: "device", label: t("productionPlanning.modeDevice"), icon: <LucideFactory /> },
            ]}
            onChange={setDisplayMode}
          />
          <SegmentedControl<ProductionPlanningViewMode>
            label={t("productionPlanning.viewMode")}
            value={viewMode}
            options={[
              { value: "tree", label: t("productionPlanning.viewTree"), icon: <LucideListTree /> },
              { value: "flow", label: t("productionPlanning.viewFlow"), icon: <LucideWorkflow /> },
            ]}
            onChange={setViewMode}
          />
        </div>

        <div className="production-planning-main">
          <div className="production-planning-graph">
            {targets.length === 0 ? (
              <div className="production-planning-empty">{t("productionPlanning.noTargets")}</div>
            ) : (
              <PlanGraph
                displayMode={displayMode}
                viewMode={viewMode}
                plan={plan}
                index={index}
                recipeChoices={recipeChoiceMap}
                onSelectRecipe={selectRecipe}
                t={t}
              />
            )}
          </div>
          <SummaryPanel plan={plan} index={index} t={t} />
        </div>
      </section>
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
    <section className="production-planning-config-section">
      <div className="production-planning-section-header">
        <h3>{icon}<span>{title}</span></h3>
        <button type="button" className="production-planning-icon-text-button" onClick={onAdd}>
          <LucidePlus />
          <span>{addLabel}</span>
        </button>
      </div>
      <div className="production-planning-line-list">
        {lines.length === 0 ? (
          <p className="production-planning-muted">{t("productionPlanning.emptyLines")}</p>
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
    <div className="production-planning-line-row">
      <button
        type="button"
        className="production-planning-item-picker-button"
        onClick={onPickItem}
      >
        <img alt="" src={resolveProductionPlanningItemIconSrc(line.itemId, index)} />
        <span>{resolveProductionPlanningItemName(line.itemId, index, t)}</span>
      </button>
      <label className="production-planning-rate-input">
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
        className="production-planning-icon-button"
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
  infiniteItemIds,
  specialInfiniteItemIds,
  onToggleSpecialInfiniteItem,
  t,
}: {
  index: ProductionPlanningIndex;
  infiniteItemIds: ReadonlySet<string>;
  specialInfiniteItemIds: ReadonlySet<string>;
  onToggleSpecialInfiniteItem: (itemId: string, infinite: boolean) => void;
  t: (key: string) => string;
}) {
  return (
    <section className="production-planning-config-section">
      <div className="production-planning-section-header">
        <h3><LucideInfinity /><span>{t("productionPlanning.sourcePolicy")}</span></h3>
      </div>
      <div className="production-planning-source-policy">
        <div className="production-planning-source-pill">
          <LucideBoxes />
          <span>{t("productionPlanning.mineralInfinite")}</span>
          <strong>{index.mineralItemIds.size}</strong>
        </div>
        {PRODUCTION_PLANNING_SPECIAL_INFINITE_ITEM_IDS.map((itemId) => (
          <div key={itemId} className="production-planning-special-source">
            <div className="production-planning-special-source-label">
              <img alt="" src={resolveProductionPlanningItemIconSrc(itemId, index)} />
              <span>{resolveProductionPlanningItemName(itemId, index, t)}</span>
            </div>
            <div className="production-planning-two-option-toggle">
              <button
                type="button"
                className={!specialInfiniteItemIds.has(itemId) ? "is-active" : ""}
                onClick={() => onToggleSpecialInfiniteItem(itemId, false)}
              >
                {t("productionPlanning.fromLine")}
              </button>
              <button
                type="button"
                className={infiniteItemIds.has(itemId) ? "is-active" : ""}
                onClick={() => onToggleSpecialInfiniteItem(itemId, true)}
              >
                {t("productionPlanning.infinite")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
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
    <div className="production-planning-segmented" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : ""}
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
  viewMode,
  plan,
  index,
  recipeChoices,
  onSelectRecipe,
  t,
}: {
  displayMode: ProductionPlanningDisplayMode;
  viewMode: ProductionPlanningViewMode;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  t: (key: string) => string;
}) {
  if (viewMode === "flow") {
    return (
      <FlowGraph
        displayMode={displayMode}
        plan={plan}
        index={index}
        recipeChoices={recipeChoices}
        onSelectRecipe={onSelectRecipe}
        t={t}
      />
    );
  }

  if (displayMode === "device") {
    return (
      <div className="production-planning-tree">
        {plan.roots.map((root) => (
          <DeviceTreeRoot
            key={root.id}
            root={root}
            index={index}
            t={t}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="production-planning-tree">
      {plan.roots.map((root) => (
        <ItemTreeNode
          key={root.id}
          node={root}
          depth={0}
          index={index}
          recipeChoices={recipeChoices}
          onSelectRecipe={onSelectRecipe}
          t={t}
        />
      ))}
    </div>
  );
}

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
    <article className="production-planning-item-node" style={{ "--tree-depth": depth } as CSSProperties}>
      <div className="production-planning-item-node-main">
        <ItemIdentity itemId={node.itemId} index={index} t={t} />
        <div className="production-planning-node-metrics">
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
        <div className="production-planning-node-children">
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
    <section className="production-planning-device-root">
      <div className="production-planning-device-root-target">
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
    <div className="production-planning-device-tree-node" style={{ "--tree-depth": depth } as CSSProperties}>
      <RecipeCard recipeNode={recipeNode} index={index} t={t} />
      <div className="production-planning-node-children">
        {recipeNode.inputItems.map((child) => (
          child.recipeNode === null
            ? <LeafItem key={child.id} node={child} index={index} t={t} />
            : <DeviceRecipeTree key={child.recipeNode.id} recipeNode={child.recipeNode} depth={depth + 1} index={index} t={t} />
        ))}
      </div>
    </div>
  );
}

function FlowGraph({
  displayMode,
  plan,
  index,
  recipeChoices,
  onSelectRecipe,
  t,
}: {
  displayMode: ProductionPlanningDisplayMode;
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  recipeChoices: ReadonlyMap<string, string>;
  onSelectRecipe: (itemId: string, recipeId: string | null) => void;
  t: (key: string) => string;
}) {
  const items = flattenProductionPlanningItemNodes(plan.roots);
  const recipes = flattenProductionPlanningRecipeNodes(plan.roots);
  const entries = displayMode === "item" ? items : recipes;

  if (entries.length === 0) {
    return <div className="production-planning-empty">{t("productionPlanning.noRecipes")}</div>;
  }

  return (
    <div className="production-planning-flow">
      {displayMode === "item"
        ? items.map((node, indexInFlow) => (
          <FlowCard key={node.id} indexInFlow={indexInFlow}>
            <ItemTreeNode
              node={node}
              depth={0}
              index={index}
              recipeChoices={recipeChoices}
              onSelectRecipe={onSelectRecipe}
              t={t}
            />
          </FlowCard>
        ))
        : recipes.map((node, indexInFlow) => (
          <FlowCard key={node.id} indexInFlow={indexInFlow}>
            <RecipeCard recipeNode={node} index={index} t={t} />
          </FlowCard>
        ))}
    </div>
  );
}

function FlowCard({
  indexInFlow,
  children,
}: {
  indexInFlow: number;
  children: ReactNode;
}) {
  return (
    <div className="production-planning-flow-step">
      <div className="production-planning-flow-index">{indexInFlow + 1}</div>
      {children}
    </div>
  );
}

function RecipeCard({
  recipeNode,
  index,
  t,
}: {
  recipeNode: ProductionPlanningRecipeNode | ProductionPlanningRecipeTotal;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  const recipe = index.recipeById.get(recipeNode.recipeId);
  const machine = recipe === undefined ? null : index.entityById.get(recipe.machineId) ?? null;
  const title = recipe === undefined
    ? recipeNode.recipeId
    : resolveProductionPlanningRecipeName(recipe, index, t);

  return (
    <article className="production-planning-recipe-node">
      <div className="production-planning-recipe-header">
        <img
          alt=""
          src={recipe === undefined ? "/device-icons/item_port_grinder_1.webp" : resolveProductionPlanningEntityIconSrc(recipe.machineId)}
        />
        <div>
          <h4>{title}</h4>
          <span>{machine === null ? recipeNode.recipeId : t(machine.nameKey)}</span>
        </div>
      </div>
      <div className="production-planning-recipe-meta">
        <Metric icon={<LucideClock3 />} label={t("productionPlanning.duration")} value={`${formatProductionFlow(recipeNode.durationSeconds)}s`} />
        <Metric icon={<LucideFactory />} label={t("productionPlanning.devices")} value={formatProductionDeviceCount(recipeNode.deviceCount)} />
        <Metric icon={<LucideGauge />} label={t("productionPlanning.cycles")} value={`${formatProductionFlow(recipeNode.cyclesPerMinute)}/min`} />
      </div>
      <div className="production-planning-recipe-ports">
        <PortChipList title={t("productionPlanning.inputs")} ports={recipeNode.inputs} index={index} t={t} />
        <PortChipList title={t("productionPlanning.outputs")} ports={recipeNode.outputs} index={index} t={t} />
      </div>
    </article>
  );
}

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
    <div className="production-planning-leaf-item">
      <ItemIdentity itemId={node.itemId} index={index} t={t} />
      <span>{formatProductionFlow(node.demandPerMinute)}/min</span>
      <NodeStatus node={node} t={t} />
    </div>
  );
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
      <span className="production-planning-status is-bad">
        {node.blockedByCycle ? t("productionPlanning.blockedCycle") : t("productionPlanning.unresolved")}
      </span>
    );
  }

  if (node.isCycleSource) {
    return <span className="production-planning-status is-cycle">{t("productionPlanning.cycleSource")}</span>;
  }

  if (node.isInfiniteSource) {
    return <span className="production-planning-status is-good">{t("productionPlanning.infiniteSource")}</span>;
  }

  if (node.suppliedPerMinute > 0 && node.producedPerMinute <= 0) {
    return <span className="production-planning-status is-good">{t("productionPlanning.supplied")}</span>;
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
    <label className="production-planning-recipe-select">
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
    <div className="production-planning-item-identity">
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
    <span className={["production-planning-metric", tone === "good" ? "is-good" : "", tone === "bad" ? "is-bad" : ""].filter(Boolean).join(" ")}>
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
    <div className="production-planning-port-chip-list">
      <span>{title}</span>
      <div>
        {ports.length === 0 ? (
          <span className="production-planning-muted">{t("productionPlanning.none")}</span>
        ) : ports.map((port) => (
          <span key={`${port.id}-${port.itemId}`} className="production-planning-port-chip">
            <img alt="" src={resolveProductionPlanningItemIconSrc(port.itemId, index)} />
            <span>{resolveProductionPlanningItemName(port.itemId, index, t)}</span>
            <strong>{formatProductionFlow(port.perMinute)}/min</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function SummaryPanel({
  plan,
  index,
  t,
}: {
  plan: ProductionPlanningResult;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}) {
  return (
    <aside className="production-planning-summary">
      <div className="production-planning-summary-cards">
        <SummaryCard icon={<LucideTarget />} label={t("productionPlanning.totalItems")} value={String(plan.itemTotals.length)} />
        <SummaryCard icon={<LucideFactory />} label={t("productionPlanning.recipeCount")} value={String(plan.recipeTotals.length)} />
        <SummaryCard
          icon={<LucideNetwork />}
          label={t("productionPlanning.missingRate")}
          value={`${formatProductionFlow(plan.unresolvedPerMinute)}/min`}
          tone={plan.unresolvedPerMinute > 0 ? "bad" : "good"}
        />
      </div>
      <section className="production-planning-summary-section">
        <h3>{t("productionPlanning.summary")}</h3>
        {plan.itemTotals.length === 0 ? (
          <p className="production-planning-muted">{t("productionPlanning.noSummary")}</p>
        ) : (
          <div className="production-planning-summary-list">
            {plan.itemTotals.slice(0, 14).map((item) => (
              <div key={item.itemId} className="production-planning-summary-row">
                <ItemIdentity itemId={item.itemId} index={index} t={t} />
                <span>{t("productionPlanning.demand")} {formatProductionFlow(item.demandPerMinute)}</span>
                <span>{t("productionPlanning.produced")} {formatProductionFlow(item.producedPerMinute)}</span>
                <strong className={item.unresolvedPerMinute > 0 ? "is-bad" : "is-good"}>
                  {t("productionPlanning.missing")} {formatProductionFlow(item.unresolvedPerMinute)}
                </strong>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="production-planning-summary-section">
        <h3>{t("productionPlanning.recipes")}</h3>
        {plan.recipeTotals.length === 0 ? (
          <p className="production-planning-muted">{t("productionPlanning.noRecipes")}</p>
        ) : (
          <div className="production-planning-recipe-total-list">
            {plan.recipeTotals.map((recipe) => (
              <RecipeCard key={recipe.recipeId} recipeNode={recipe} index={index} t={t} />
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className={["production-planning-summary-card", tone === "good" ? "is-good" : "", tone === "bad" ? "is-bad" : ""].filter(Boolean).join(" ")}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
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
