import { useEffect, useState, type ReactNode } from "react";
import { runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import LucideArrowLeft from "~icons/lucide/arrow-left";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideClipboardList from "~icons/lucide/clipboard-list";
import LucideEdit3 from "~icons/lucide/edit-3";
import LucideLayers3 from "~icons/lucide/layers-3";
import LucidePlus from "~icons/lucide/plus";
import LucideSave from "~icons/lucide/save";
import LucideSearch from "~icons/lucide/search";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import type {
  ModuleBalancingCanvasReadWrite,
  ModuleBalancingCustomModuleReadWrite,
  ModuleBalancingIOPortReadWrite,
  ModuleBalancingStageReadWrite,
} from "@/app/state/state-impl";
import {
  createDefaultModuleBalancingCanvas,
} from "@/app/state/state-impl";
import type {
  ModuleBalancingCustomModule,
  ModuleBalancingIOPort,
  ModuleBalancingModule,
} from "@/domain/app/types/app-types";
import {
  buildModuleBalancingIndex,
  computeModuleBalancing,
  computeStageModuleTotals,
  createModuleBalancingId,
  formatDurationMinutes,
  formatFlow,
  formatSignedFlow,
  resolveAnyIconSrc,
  resolveItemIconSrc,
  resolveItemName,
  resolveModule,
  resolveModuleIconSrc,
  resolveModuleInputs,
  resolveModuleOutputs,
  type ModuleBalancingIndex,
  type ModuleBalancingItemBalance,
  type ModuleBalancingWarehouseForecast,
} from "@/app/shell/module-balancing/module-balancing-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { NumberInput } from "@/app/shell/shared/number-input";

const MODULE_DRAG_TYPE = "application/x-industrial-planner-module-balancing-module";
const ENTRY_DRAG_TYPE = "application/x-industrial-planner-module-balancing-entry";

const CUSTOM_MODULE_COLORS = [
  "#4f8cff",
  "#16a34a",
  "#dc2626",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#64748b",
  "#be185d",
] as const;

type MobilePanelTab = "module-library" | "canvas-input" | "stage-detail";

interface QuantityDraft {
  mode: "add" | "edit";
  stageId: string;
  moduleId: string;
  entryIndex: number | null;
  quantity: string;
}

interface CustomModuleFormState {
  id: string | null;
  name: string;
  color: string;
  iconId: string;
  inputs: ModuleBalancingIOPort[];
  outputs: ModuleBalancingIOPort[];
}

interface PendingPortTarget {
  kind: "global" | "custom-input" | "custom-output";
}

export const ModuleBalancingPanel = observer(function ModuleBalancingPanel({
  appHost,
  isTouch,
}: {
  appHost: AppHost;
  isTouch: boolean;
}) {
  const t = appHost.actions.translate;
  const balancingState = appHost.internalState.workbench.toolbox.moduleBalancing;
  const activeCanvas = balancingState.canvases.find((canvas) => canvas.id === balancingState.activeCanvasId)
    ?? balancingState.canvases[0]
    ?? null;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobilePanelTab>("stage-detail");
  const [expandedBalanceIds, setExpandedBalanceIds] = useState<Set<string>>(() => new Set());
  const [quantityDraft, setQuantityDraft] = useState<QuantityDraft | null>(null);
  const [customModuleForm, setCustomModuleForm] = useState<CustomModuleFormState | null>(null);

  const index = buildModuleBalancingIndex(appHost.workspace.registry, balancingState);
  const computation = activeCanvas === null ? null : computeModuleBalancing(activeCanvas, index);
  const selectedStage = activeCanvas?.stages.find((stage) => stage.id === selectedStageId)
    ?? activeCanvas?.stages[0]
    ?? null;

  useEffect(() => {
    if (activeCanvas === null) {
      return;
    }

    if (activeCanvas.stages.length === 0) {
      setSelectedStageId(null);
      return;
    }

    if (selectedStageId === null || !activeCanvas.stages.some((stage) => stage.id === selectedStageId)) {
      setSelectedStageId(activeCanvas.stages[0]?.id ?? null);
    }
  }, [activeCanvas, selectedStageId]);

  const openAddModuleDraft = (stageId: string, moduleId: string) => {
    setQuantityDraft({
      mode: "add",
      stageId,
      moduleId,
      entryIndex: null,
      quantity: "1.00",
    });
  };

  const openEditEntryDraft = (stageId: string, moduleId: string, entryIndex: number, quantity: number) => {
    setQuantityDraft({
      mode: "edit",
      stageId,
      moduleId,
      entryIndex,
      quantity: quantity.toFixed(2),
    });
  };

  const addStage = () => {
    if (activeCanvas === null) {
      return;
    }

    const stageId = createModuleBalancingId("stage");
    runInAction(() => {
      activeCanvas.stages.push({
        id: stageId,
        name: `${t("moduleBalancing.stage")} ${activeCanvas.stages.length + 1}`,
        entries: [],
      });
    });
    setSelectedStageId(stageId);
    setMobileTab("stage-detail");
  };

  const openNewCustomModuleForm = () => {
    setCustomModuleForm({
      id: null,
      name: "",
      color: CUSTOM_MODULE_COLORS[0],
      iconId: index.allItems[0]?.id ?? index.allEntities[0]?.id ?? "item_port_grinder_1",
      inputs: [],
      outputs: [],
    });
  };

  const openEditCustomModuleForm = (customModule: ModuleBalancingCustomModule) => {
    setCustomModuleForm({
      id: customModule.id,
      name: customModule.name,
      color: customModule.color,
      iconId: customModule.iconId,
      inputs: customModule.inputs.map(clonePort),
      outputs: customModule.outputs.map(clonePort),
    });
  };

  const openStageAsCustomModuleForm = (stage: ModuleBalancingStageReadWrite) => {
    const stageTotals = computeStageModuleTotals(stage, index);
    const inputs = stageTotals
      .filter((balance) => balance.totalInput > 0)
      .map((balance) => ({ itemId: balance.itemId, perMinute: balance.totalInput }));
    const outputs = stageTotals
      .filter((balance) => balance.totalOutput > 0)
      .map((balance) => ({ itemId: balance.itemId, perMinute: balance.totalOutput }));

    setCustomModuleForm({
      id: null,
      name: stage.name,
      color: CUSTOM_MODULE_COLORS[0],
      iconId: outputs[0]?.itemId ?? inputs[0]?.itemId ?? index.allItems[0]?.id ?? "item_port_grinder_1",
      inputs,
      outputs,
    });
    setMobileTab("module-library");
  };

  const closeCustomModuleForm = () => {
    setCustomModuleForm(null);
  };

  const saveCustomModule = (draft: CustomModuleFormState) => {
    const normalizedName = draft.name.trim();
    const outputs = draft.outputs.filter((port) => port.itemId.length > 0 && port.perMinute > 0);
    if (normalizedName.length === 0 || outputs.length === 0) {
      return;
    }

    const nextModule: ModuleBalancingCustomModuleReadWrite = {
      id: draft.id ?? createModuleBalancingId("custom-module"),
      name: normalizedName,
      color: draft.color,
      iconId: draft.iconId,
      inputs: draft.inputs.filter((port) => port.itemId.length > 0 && port.perMinute > 0).map(clonePort),
      outputs: outputs.map(clonePort),
      sourceType: "custom",
    };

    runInAction(() => {
      const existingIndex = balancingState.customModules.findIndex((module) => module.id === nextModule.id);
      if (existingIndex >= 0) {
        balancingState.customModules.splice(existingIndex, 1, nextModule);
      } else {
        balancingState.customModules.push(nextModule);
      }
    });
    closeCustomModuleForm();
  };

  const handleConfirmQuantity = () => {
    if (activeCanvas === null || quantityDraft === null) {
      return;
    }

    const quantity = normalizeQuantity(quantityDraft.quantity);
    if (quantity === null) {
      return;
    }

    runInAction(() => {
      const stage = activeCanvas.stages.find((item) => item.id === quantityDraft.stageId);
      if (stage === undefined) {
        return;
      }

      if (quantityDraft.mode === "add") {
        stage.entries.push({
          moduleId: quantityDraft.moduleId,
          quantity,
        });
        return;
      }

      if (quantityDraft.entryIndex === null) {
        return;
      }

      const entry = stage.entries[quantityDraft.entryIndex];
      if (entry !== undefined) {
        entry.quantity = quantity;
      }
    });
    setQuantityDraft(null);
  };

  const deleteQuantityDraftEntry = () => {
    if (activeCanvas === null || quantityDraft?.mode !== "edit" || quantityDraft.entryIndex === null) {
      return;
    }

    runInAction(() => {
      const stage = activeCanvas.stages.find((item) => item.id === quantityDraft.stageId);
      stage?.entries.splice(quantityDraft.entryIndex ?? 0, 1);
    });
    setQuantityDraft(null);
  };

  const addPort = (target: PendingPortTarget, itemId: string) => {
    if (activeCanvas === null) {
      return;
    }

    if (target.kind === "global") {
      runInAction(() => {
        activeCanvas.globalInputs.push({ itemId, perMinute: 60 });
      });
      return;
    }

    setCustomModuleForm((draft) => {
      if (draft === null) {
        return draft;
      }

      const nextPort = { itemId, perMinute: 60 };
      return target.kind === "custom-input"
        ? { ...draft, inputs: [...draft.inputs, nextPort] }
        : { ...draft, outputs: [...draft.outputs, nextPort] };
    });
  };

  const requestPortSelection = async (target: PendingPortTarget) => {
    const itemId = await appHost.encyclopediaPicker.pickItem({
      title: t("encyclopediaPicker.title.item"),
    });

    if (itemId === null) {
      return;
    }

    addPort(target, itemId);
  };

  const renderTopToolbar = () => {
    if (activeCanvas === null) {
      return null;
    }

    return (
      <div className={cm(styles, "module-balancing-toolbar")}>
        <label className={cm(styles, "module-balancing-field is-select")}>
          <span>{t("moduleBalancing.canvas")}</span>
          <select
            value={activeCanvas.id}
            onChange={(event) => {
              const nextCanvasId = event.currentTarget.value;
              runInAction(() => {
                balancingState.activeCanvasId = nextCanvasId;
              });
              setSelectedStageId(null);
            }}
          >
            {balancingState.canvases.map((canvas) => (
              <option key={canvas.id} value={canvas.id}>{canvas.name}</option>
            ))}
          </select>
        </label>
        <label className={cm(styles, "module-balancing-field is-name")}>
          <span>{t("moduleBalancing.canvasPlaceholder")}</span>
          <input
            value={activeCanvas.name}
            onChange={(event) => {
              const nextName = event.currentTarget.value;
              runInAction(() => {
                activeCanvas.name = nextName;
              });
            }}
          />
        </label>
        <button
          className={cm(styles, "module-balancing-icon-text-button")}
          type="button"
          onClick={() => {
            const nextCanvas = createDefaultModuleBalancingCanvas();
            nextCanvas.id = createModuleBalancingId("canvas");
            nextCanvas.name = `${t("moduleBalancing.canvas")} ${balancingState.canvases.length + 1}`;
            nextCanvas.stages[0] = {
              id: createModuleBalancingId("stage"),
              name: `${t("moduleBalancing.stage")} 1`,
              entries: [],
            };
            runInAction(() => {
              balancingState.canvases.push(nextCanvas);
              balancingState.activeCanvasId = nextCanvas.id;
            });
            setSelectedStageId(nextCanvas.stages[0]?.id ?? null);
          }}
        >
          <LucidePlus aria-hidden="true" />
          <span>{t("moduleBalancing.newCanvas")}</span>
        </button>
        <button
          aria-label={t("moduleBalancing.deleteCanvas")}
          className={cm(styles, "module-balancing-icon-button")}
          disabled={balancingState.canvases.length <= 1}
          title={t("moduleBalancing.deleteCanvas")}
          type="button"
          onClick={() => {
            runInAction(() => {
              const indexToDelete = balancingState.canvases.findIndex((canvas) => canvas.id === activeCanvas.id);
              if (indexToDelete < 0 || balancingState.canvases.length <= 1) {
                return;
              }
              balancingState.canvases.splice(indexToDelete, 1);
              balancingState.activeCanvasId = balancingState.canvases[Math.max(0, indexToDelete - 1)]?.id ?? null;
            });
            setSelectedStageId(null);
          }}
        >
          <LucideTrash2 aria-hidden="true" />
        </button>
        <label className={cm(styles, "module-balancing-field is-capacity")}>
          <span>{t("moduleBalancing.warehouseCapacity")}</span>
          <input
            min="0"
            placeholder={t("moduleBalancing.warehouseCapacityHint")}
            step="1"
            type="number"
            value={activeCanvas.warehouseCapacity ?? ""}
            onChange={(event) => {
              const rawValue = event.currentTarget.value;
              runInAction(() => {
                activeCanvas.warehouseCapacity = rawValue === "" ? null : Math.max(0, Number(rawValue));
              });
            }}
          />
        </label>
      </div>
    );
  };

  if (activeCanvas === null || computation === null) {
    return (
      <div className={cm(styles, "toolbox-dialog-content module-balancing-panel")}>
        <div className={cm(styles, "toolbox-dialog-placeholder")}>
          <h3>{t("toolboxDialog.tab.moduleBalancing")}</h3>
          <p>{t("toolboxDialog.empty")}</p>
        </div>
      </div>
    );
  }

  const stageBalanceByStageId = new Map(computation.stageBalances.map((balance) => [balance.stageId, balance]));
  const content = isTouch ? (
    <div className={cm(styles, "module-balancing-mobile-layout")}>
      {renderTopToolbar()}
      <StageNavigation
        activeCanvas={activeCanvas}
        onAddStage={addStage}
        onSelectInput={() => setMobileTab("canvas-input")}
        onSelectStage={(stageId) => {
          setSelectedStageId(stageId);
          setMobileTab("stage-detail");
        }}
        selectedStageId={selectedStage?.id ?? null}
        t={t}
      />
      <main className={cm(styles, "module-balancing-mobile-main")}>
        {mobileTab === "module-library" ? (
          <ModuleLibrary
            activeCanvas={activeCanvas}
            customModuleForm={customModuleForm}
            index={index}
            isTouch={isTouch}
            onAddModule={(moduleId) => {
              if (selectedStage === null) {
                addStage();
                return;
              }
              openAddModuleDraft(selectedStage.id, moduleId);
            }}
            onCancelCustomModule={closeCustomModuleForm}
            onCreateCustomModule={openNewCustomModuleForm}
            onDeleteCustomModule={(moduleId) => {
              runInAction(() => {
                balancingState.customModules = balancingState.customModules.filter((module) => module.id !== moduleId);
                for (const canvas of balancingState.canvases) {
                  for (const stage of canvas.stages) {
                    stage.entries = stage.entries.filter((entry) => entry.moduleId !== moduleId);
                  }
                }
              });
            }}
            onEditCustomModule={openEditCustomModuleForm}
            onOpenPortPicker={(target) => {
              void requestPortSelection(target);
            }}
            onSaveCustomModule={saveCustomModule}
            onUpdateCustomModuleForm={setCustomModuleForm}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            t={t}
          />
        ) : null}
        {mobileTab === "canvas-input" ? (
          <CanvasInputPanel
            canvas={activeCanvas}
            index={index}
            onOpenPortPicker={() => {
              void requestPortSelection({ kind: "global" });
            }}
            t={t}
          />
        ) : null}
        {mobileTab === "stage-detail" ? (
          <StageDetailPanel
            canvas={activeCanvas}
            computationSummary={computation.summaryBalances}
            expandedBalanceIds={expandedBalanceIds}
            index={index}
            onAddModule={() => setMobileTab("module-library")}
            onAddStage={addStage}
            onClearStage={(stage) => runInAction(() => { stage.entries = []; })}
            onEditEntry={openEditEntryDraft}
            onOpenStageAsModule={openStageAsCustomModuleForm}
            onRenameStage={(stage, name) => runInAction(() => { stage.name = name; })}
            onToggleBalance={(stageId) => setExpandedBalanceIds(toggleSetValue(expandedBalanceIds, stageId))}
            selectedStage={selectedStage}
            stageBalance={selectedStage === null ? null : stageBalanceByStageId.get(selectedStage.id)?.balances ?? []}
            t={t}
            warehouseForecasts={computation.warehouseForecasts}
          />
        ) : null}
      </main>
      <nav className={cm(styles, "module-balancing-bottom-tabs")} aria-label={t("toolboxDialog.tab.moduleBalancing")}> 
        <MobileTabButton active={mobileTab === "module-library"} onClick={() => setMobileTab("module-library")}> 
          <LucideLayers3 aria-hidden="true" />
          <span>{t("moduleBalancing.moduleLibrary")}</span>
        </MobileTabButton>
        <MobileTabButton active={mobileTab === "canvas-input"} onClick={() => setMobileTab("canvas-input")}> 
          <LucideClipboardList aria-hidden="true" />
          <span>{t("moduleBalancing.canvasInput")}</span>
        </MobileTabButton>
        <MobileTabButton active={mobileTab === "stage-detail"} onClick={() => setMobileTab("stage-detail")}> 
          <LucideChevronDown aria-hidden="true" />
          <span>{t("moduleBalancing.stageDetail")}</span>
        </MobileTabButton>
      </nav>
    </div>
  ) : (
    <div className={cm(styles, "module-balancing-desktop-layout")}>
      {renderTopToolbar()}
      <aside className={cm(styles, "module-balancing-library-pane")}>
        <ModuleLibrary
          activeCanvas={activeCanvas}
          customModuleForm={customModuleForm}
          index={index}
          isTouch={isTouch}
          onAddModule={(moduleId) => {
            if (selectedStage === null) {
              addStage();
              return;
            }
            openAddModuleDraft(selectedStage.id, moduleId);
          }}
          onCancelCustomModule={closeCustomModuleForm}
          onCreateCustomModule={openNewCustomModuleForm}
          onDeleteCustomModule={(moduleId) => {
            runInAction(() => {
              balancingState.customModules = balancingState.customModules.filter((module) => module.id !== moduleId);
              for (const canvas of balancingState.canvases) {
                for (const stage of canvas.stages) {
                  stage.entries = stage.entries.filter((entry) => entry.moduleId !== moduleId);
                }
              }
            });
          }}
          onEditCustomModule={openEditCustomModuleForm}
          onOpenPortPicker={(target) => {
            void requestPortSelection(target);
          }}
          onSaveCustomModule={saveCustomModule}
          onUpdateCustomModuleForm={setCustomModuleForm}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          t={t}
        />
      </aside>
      <main className={cm(styles, "module-balancing-canvas-pane")}>
        <CanvasInputPanel
          canvas={activeCanvas}
          index={index}
          onOpenPortPicker={() => {
            void requestPortSelection({ kind: "global" });
          }}
          t={t}
        />
        <div className={cm(styles, "module-balancing-stage-list")}>
          {activeCanvas.stages.map((stage) => (
            <section
              className={cm(styles, "module-balancing-stage")}
              key={stage.id}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(MODULE_DRAG_TYPE)) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                const moduleId = event.dataTransfer.getData(MODULE_DRAG_TYPE);
                if (moduleId.length === 0) {
                  return;
                }
                event.preventDefault();
                openAddModuleDraft(stage.id, moduleId);
              }}
            >
              <StageHeader
                onClear={() => runInAction(() => { stage.entries = []; })}
                onSaveAsModule={() => openStageAsCustomModuleForm(stage)}
                onUpdateName={(name) => runInAction(() => { stage.name = name; })}
                stage={stage}
                t={t}
              />
              <StageEntryGrid
                index={index}
                isTouch={isTouch}
                onAddModule={() => openAddModuleDraft(stage.id, index.systemModules[0]?.id ?? "")}
                onEditEntry={(moduleId, entryIndex, quantity) => openEditEntryDraft(stage.id, moduleId, entryIndex, quantity)}
                onMoveEntry={(fromIndex, toIndex) => moveStageEntry(stage, fromIndex, toIndex)}
                onOpenLibrary={() => setMobileTab("module-library")}
                stage={stage}
                t={t}
              />
              <BalanceStrip
                balances={stageBalanceByStageId.get(stage.id)?.balances ?? []}
                expanded={expandedBalanceIds.has(stage.id)}
                index={index}
                onToggle={() => setExpandedBalanceIds(toggleSetValue(expandedBalanceIds, stage.id))}
                t={t}
              />
            </section>
          ))}
        </div>
        <button className={cm(styles, "module-balancing-add-stage")} type="button" onClick={addStage}>
          <LucidePlus aria-hidden="true" />
          <span>{t("moduleBalancing.newStage")}</span>
        </button>
      </main>
      <aside className={cm(styles, "module-balancing-summary-pane")}>
        <SummaryPanel
          balances={computation.summaryBalances}
          index={index}
          t={t}
          warehouseForecasts={computation.warehouseForecasts}
        />
      </aside>
    </div>
  );

  return (
    <div className={cm(styles, `toolbox-dialog-content module-balancing-panel${isTouch ? " is-touch" : ""}`)}>
      {content}
      {quantityDraft !== null ? (
        <QuantityEditor
          draft={quantityDraft}
          index={index}
          onCancel={() => setQuantityDraft(null)}
          onConfirm={handleConfirmQuantity}
          onDelete={deleteQuantityDraftEntry}
          onUpdate={setQuantityDraft}
          t={t}
        />
      ) : null}
    </div>
  );
});

function ModuleLibrary({
  activeCanvas,
  customModuleForm,
  index,
  isTouch,
  onAddModule,
  onCancelCustomModule,
  onCreateCustomModule,
  onDeleteCustomModule,
  onEditCustomModule,
  onOpenPortPicker,
  onSaveCustomModule,
  onUpdateCustomModuleForm,
  searchQuery,
  setSearchQuery,
  t,
}: {
  activeCanvas: ModuleBalancingCanvasReadWrite;
  customModuleForm: CustomModuleFormState | null;
  index: ModuleBalancingIndex;
  isTouch: boolean;
  onAddModule: (moduleId: string) => void;
  onCancelCustomModule: () => void;
  onCreateCustomModule: () => void;
  onDeleteCustomModule: (moduleId: string) => void;
  onEditCustomModule: (module: ModuleBalancingCustomModule) => void;
  onOpenPortPicker: (target: PendingPortTarget) => void;
  onSaveCustomModule: (draft: CustomModuleFormState) => void;
  onUpdateCustomModuleForm: (draft: CustomModuleFormState | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  t: (key: string) => string;
}) {
  if (customModuleForm !== null) {
    return (
      <CustomModuleForm
        draft={customModuleForm}
        index={index}
        onCancel={onCancelCustomModule}
        onOpenPortPicker={onOpenPortPicker}
        onSave={() => onSaveCustomModule(customModuleForm)}
        onUpdate={onUpdateCustomModuleForm}
        t={t}
      />
    );
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const systemModules = index.systemModules.filter((module) => matchesModuleQuery(module, normalizedQuery, index, t));
  const customModules = Array.from(index.customModuleById.values())
    .filter((module) => matchesModuleQuery(module, normalizedQuery, index, t));

  return (
    <div className={cm(styles, "module-balancing-library")}>
      <div className={cm(styles, "module-balancing-search")}>
        <LucideSearch aria-hidden="true" />
        <input
          placeholder={t("moduleBalancing.searchModules")}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
        />
      </div>
      <ModuleSection
        count={systemModules.length}
        index={index}
        isTouch={isTouch}
        modules={systemModules}
        onAddModule={onAddModule}
        t={t}
        title={t("moduleBalancing.systemModules")}
      />
      <ModuleSection
        count={customModules.length}
        index={index}
        isTouch={isTouch}
        modules={customModules}
        onAddModule={onAddModule}
        onDeleteCustomModule={onDeleteCustomModule}
        onEditCustomModule={onEditCustomModule}
        t={t}
        title={t("moduleBalancing.customModules")}
      />
      <button className={cm(styles, "module-balancing-new-module-button")} type="button" onClick={onCreateCustomModule}>
        <LucidePlus aria-hidden="true" />
        <span>{t("moduleBalancing.newModule")}</span>
      </button>
      {activeCanvas.stages.length === 0 ? (
        <p className={cm(styles, "module-balancing-muted")}>{t("moduleBalancing.noStages")}</p>
      ) : null}
    </div>
  );
}

function ModuleSection({
  count,
  index,
  isTouch,
  modules,
  onAddModule,
  onDeleteCustomModule,
  onEditCustomModule,
  t,
  title,
}: {
  count: number;
  index: ModuleBalancingIndex;
  isTouch: boolean;
  modules: ModuleBalancingModule[];
  onAddModule: (moduleId: string) => void;
  onDeleteCustomModule?: (moduleId: string) => void;
  onEditCustomModule?: (module: ModuleBalancingCustomModule) => void;
  t: (key: string) => string;
  title: string;
}) {
  return (
    <section className={cm(styles, "module-balancing-library-section")}>
      <h3>{title} <span>({count})</span></h3>
      <div className={cm(styles, "module-balancing-module-list")}>
        {modules.map((module) => (
          <ModuleCard
            index={index}
            isTouch={isTouch}
            key={module.id}
            module={module}
            onAdd={() => onAddModule(module.id)}
            onDeleteCustomModule={onDeleteCustomModule}
            onEditCustomModule={onEditCustomModule}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function ModuleCard({
  index,
  isTouch,
  module,
  onAdd,
  onDeleteCustomModule,
  onEditCustomModule,
  t,
}: {
  index: ModuleBalancingIndex;
  isTouch: boolean;
  module: ModuleBalancingModule;
  onAdd: () => void;
  onDeleteCustomModule?: (moduleId: string) => void;
  onEditCustomModule?: (module: ModuleBalancingCustomModule) => void;
  t: (key: string) => string;
}) {
  const inputs = resolveModuleInputs(module, index);
  const outputs = resolveModuleOutputs(module, index);
  const title = resolveModuleTitle(module, index, t);
  const subtitle = module.sourceType === "custom"
    ? formatPortList(outputs, index, t)
    : `${formatPortList(inputs, index, t)} -> ${formatPortList(outputs, index, t)}`;

  return (
    <button
      className={cm(styles, "module-balancing-module-card")}
      draggable={!isTouch}
      title={formatModuleTooltip(module, index, t)}
      type="button"
      onClick={onAdd}
      onDragStart={(event) => {
        event.dataTransfer.setData(MODULE_DRAG_TYPE, module.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <img alt="" className={cm(styles, "module-balancing-module-icon")} src={resolveModuleIconSrc(module, index)} />
      <span className={cm(styles, "module-balancing-module-card-copy")}>
        <span className={cm(styles, "module-balancing-module-title")}>{title}</span>
        <span className={cm(styles, "module-balancing-module-subtitle")}>{subtitle}</span>
      </span>
      {outputs[0] !== undefined ? (
        <span className={cm(styles, "module-balancing-module-rate")}>{formatFlow(outputs[0].perMinute)}/min</span>
      ) : null}
      {module.sourceType === "custom" ? (
        <span className={cm(styles, "module-balancing-module-actions")} onClick={(event) => event.stopPropagation()}>
          <button
            aria-label={t("moduleBalancing.editModule")}
            className={cm(styles, "module-balancing-mini-icon-button")}
            title={t("moduleBalancing.editModule")}
            type="button"
            onClick={() => onEditCustomModule?.(module)}
          >
            <LucideEdit3 aria-hidden="true" />
          </button>
          <button
            aria-label={t("moduleBalancing.deleteModule")}
            className={cm(styles, "module-balancing-mini-icon-button")}
            title={t("moduleBalancing.deleteModule")}
            type="button"
            onClick={() => onDeleteCustomModule?.(module.id)}
          >
            <LucideTrash2 aria-hidden="true" />
          </button>
        </span>
      ) : null}
    </button>
  );
}

function CanvasInputPanel({
  canvas,
  index,
  onOpenPortPicker,
  t,
}: {
  canvas: ModuleBalancingCanvasReadWrite;
  index: ModuleBalancingIndex;
  onOpenPortPicker: () => void;
  t: (key: string) => string;
}) {
  return (
    <section className={cm(styles, "module-balancing-input-panel")}>
      <header className={cm(styles, "module-balancing-section-header")}>
        <h3>{t("moduleBalancing.systemInput")}</h3>
        <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onOpenPortPicker}>
          <LucidePlus aria-hidden="true" />
          <span>{t("moduleBalancing.addInput")}</span>
        </button>
      </header>
      <PortListEditor
        index={index}
        onChange={(ports) => runInAction(() => { canvas.globalInputs = ports; })}
        ports={canvas.globalInputs}
        t={t}
      />
    </section>
  );
}

function StageNavigation({
  activeCanvas,
  onAddStage,
  onSelectInput,
  onSelectStage,
  selectedStageId,
  t,
}: {
  activeCanvas: ModuleBalancingCanvasReadWrite;
  onAddStage: () => void;
  onSelectInput: () => void;
  onSelectStage: (stageId: string) => void;
  selectedStageId: string | null;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "module-balancing-stage-nav")}>
      <button className={cm(styles, "module-balancing-stage-nav-button is-input")} type="button" onClick={onSelectInput}>◆ {t("moduleBalancing.systemInput")}</button>
      {activeCanvas.stages.map((stage) => (
        <button
          className={cm(styles, `module-balancing-stage-nav-button${stage.id === selectedStageId ? " is-active" : ""}`)}
          key={stage.id}
          type="button"
          onClick={() => onSelectStage(stage.id)}
        >
          {stage.name}
        </button>
      ))}
      <button className={cm(styles, "module-balancing-stage-nav-button")} type="button" onClick={onAddStage}>+ {t("moduleBalancing.stage")}</button>
    </div>
  );
}

function StageDetailPanel({
  canvas,
  computationSummary,
  expandedBalanceIds,
  index,
  onAddModule,
  onAddStage,
  onClearStage,
  onEditEntry,
  onOpenStageAsModule,
  onRenameStage,
  onToggleBalance,
  selectedStage,
  stageBalance,
  t,
  warehouseForecasts,
}: {
  canvas: ModuleBalancingCanvasReadWrite;
  computationSummary: ModuleBalancingItemBalance[];
  expandedBalanceIds: Set<string>;
  index: ModuleBalancingIndex;
  onAddModule: () => void;
  onAddStage: () => void;
  onClearStage: (stage: ModuleBalancingStageReadWrite) => void;
  onEditEntry: (stageId: string, moduleId: string, entryIndex: number, quantity: number) => void;
  onOpenStageAsModule: (stage: ModuleBalancingStageReadWrite) => void;
  onRenameStage: (stage: ModuleBalancingStageReadWrite, name: string) => void;
  onToggleBalance: (stageId: string) => void;
  selectedStage: ModuleBalancingStageReadWrite | null;
  stageBalance: ModuleBalancingItemBalance[] | null;
  t: (key: string) => string;
  warehouseForecasts: ModuleBalancingWarehouseForecast[];
}) {
  if (selectedStage === null) {
    return (
      <section className={cm(styles, "module-balancing-stage-detail")}>
        <p className={cm(styles, "module-balancing-muted")}>{t("moduleBalancing.noStages")}</p>
        <button className={cm(styles, "module-balancing-add-stage")} type="button" onClick={onAddStage}>
          <LucidePlus aria-hidden="true" />
          <span>{t("moduleBalancing.newStage")}</span>
        </button>
      </section>
    );
  }

  return (
    <section className={cm(styles, "module-balancing-stage-detail")}>
      <StageHeader
        onClear={() => onClearStage(selectedStage)}
        onSaveAsModule={() => onOpenStageAsModule(selectedStage)}
        onUpdateName={(name) => onRenameStage(selectedStage, name)}
        stage={selectedStage}
        t={t}
      />
      <StageEntryGrid
        index={index}
        isTouch
        onAddModule={onAddModule}
        onEditEntry={(moduleId, entryIndex, quantity) => onEditEntry(selectedStage.id, moduleId, entryIndex, quantity)}
        onMoveEntry={(fromIndex, toIndex) => moveStageEntry(selectedStage, fromIndex, toIndex)}
        onOpenLibrary={onAddModule}
        stage={selectedStage}
        t={t}
      />
      <BalanceStrip
        balances={stageBalance ?? []}
        expanded={expandedBalanceIds.has(selectedStage.id)}
        index={index}
        onToggle={() => onToggleBalance(selectedStage.id)}
        t={t}
      />
      <SummaryPanel
        balances={computationSummary}
        canvas={canvas}
        index={index}
        t={t}
        warehouseForecasts={warehouseForecasts}
      />
    </section>
  );
}

function StageHeader({
  onClear,
  onSaveAsModule,
  onUpdateName,
  stage,
  t,
}: {
  onClear: () => void;
  onSaveAsModule: () => void;
  onUpdateName: (name: string) => void;
  stage: ModuleBalancingStageReadWrite;
  t: (key: string) => string;
}) {
  return (
    <header className={cm(styles, "module-balancing-stage-header")}>
      <label className={cm(styles, "module-balancing-stage-name")}>
        <span>{t("moduleBalancing.stage")}</span>
        <input value={stage.name} onChange={(event) => onUpdateName(event.currentTarget.value)} />
      </label>
      <div className={cm(styles, "module-balancing-stage-actions")}>
        <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onClear}>
          <LucideX aria-hidden="true" />
          <span>{t("moduleBalancing.clearStage")}</span>
        </button>
        <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onSaveAsModule}>
          <LucideSave aria-hidden="true" />
          <span>{t("moduleBalancing.saveAsModule")}</span>
        </button>
      </div>
    </header>
  );
}

function StageEntryGrid({
  index,
  isTouch,
  onAddModule,
  onEditEntry,
  onMoveEntry,
  onOpenLibrary,
  stage,
  t,
}: {
  index: ModuleBalancingIndex;
  isTouch: boolean;
  onAddModule: () => void;
  onEditEntry: (moduleId: string, entryIndex: number, quantity: number) => void;
  onMoveEntry: (fromIndex: number, toIndex: number) => void;
  onOpenLibrary: () => void;
  stage: ModuleBalancingStageReadWrite;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "module-balancing-stage-entry-grid")}>
      {stage.entries.map((entry, entryIndex) => {
        const module = resolveModule(entry.moduleId, index);
        if (module === null) {
          return null;
        }

        return (
          <button
            className={cm(styles, "module-balancing-stage-entry")}
            draggable={!isTouch}
            key={`${entry.moduleId}-${entryIndex}`}
            title={formatModuleTooltip(module, index, t)}
            type="button"
            onClick={() => onEditEntry(entry.moduleId, entryIndex, entry.quantity)}
            onDragStart={(event) => {
              event.dataTransfer.setData(ENTRY_DRAG_TYPE, String(entryIndex));
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              const rawFromIndex = event.dataTransfer.getData(ENTRY_DRAG_TYPE);
              if (rawFromIndex.length === 0) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onMoveEntry(Number(rawFromIndex), entryIndex);
            }}
          >
            <img alt="" src={resolveModuleIconSrc(module, index)} />
            <span>{resolveModuleTitle(module, index, t)}</span>
            <strong>x{formatFlow(entry.quantity)}</strong>
          </button>
        );
      })}
      <button className={cm(styles, "module-balancing-stage-add-entry")} type="button" onClick={isTouch ? onOpenLibrary : onAddModule}>
        <LucidePlus aria-hidden="true" />
        <span>{t("moduleBalancing.addToStage")}</span>
      </button>
    </div>
  );
}

function BalanceStrip({
  balances,
  expanded,
  index,
  onToggle,
  t,
}: {
  balances: ModuleBalancingItemBalance[];
  expanded: boolean;
  index: ModuleBalancingIndex;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  const nonZeroBalances = balances.filter((balance) => Math.abs(balance.netDelta) >= 0.005);
  const visibleBalances = expanded ? balances : nonZeroBalances.slice(0, 3);
  const hiddenCount = Math.max(0, nonZeroBalances.length - visibleBalances.length);

  return (
    <div className={cm(styles, `module-balancing-balance-strip${expanded ? " is-expanded" : ""}`)}>
      <div className={cm(styles, "module-balancing-balance-strip-header")}>
        <span>{t("moduleBalancing.surplus")}/{t("moduleBalancing.deficit")}</span>
        <button className={cm(styles, "module-balancing-link-button")} type="button" onClick={onToggle}>
          {expanded ? t("moduleBalancing.collapseDetails") : t("moduleBalancing.expandDetails")}
        </button>
      </div>
      {visibleBalances.length === 0 ? (
        <span className={cm(styles, "module-balancing-muted")}>{t("moduleBalancing.balanced")}</span>
      ) : (
        <div className={cm(styles, expanded ? "module-balancing-balance-detail-list" : "module-balancing-balance-chip-row")}>
          {visibleBalances.map((balance) => expanded ? (
            <div className={cm(styles, "module-balancing-balance-detail")} key={balance.itemId}>
              <img alt="" src={resolveItemIconSrc(balance.itemId, index)} />
              <span>{resolveItemName(balance.itemId, index, t)}</span>
              <span>{t("moduleBalancing.outputItems")} {formatFlow(balance.totalOutput)}</span>
              <span>{t("moduleBalancing.inputItems")} {formatFlow(balance.totalInput)}</span>
              <strong className={cm(styles, resolveBalanceClassName(balance.netDelta))}>{formatSignedFlow(balance.netDelta)}/min</strong>
            </div>
          ) : (
            <span className={cm(styles, `module-balancing-balance-chip ${resolveBalanceClassName(balance.netDelta)}`)} key={balance.itemId} title={resolveItemName(balance.itemId, index, t)}>
              <img alt="" src={resolveItemIconSrc(balance.itemId, index)} />
              <span>{formatSignedFlow(balance.netDelta)}</span>
            </span>
          ))}
          {!expanded && hiddenCount > 0 ? (
            <button className={cm(styles, "module-balancing-link-button")} type="button" onClick={onToggle}>
              {t("moduleBalancing.nItemsMore").replace("{n}", String(hiddenCount))}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SummaryPanel({
  balances,
  canvas,
  index,
  t,
  warehouseForecasts,
}: {
  balances: ModuleBalancingItemBalance[];
  canvas?: ModuleBalancingCanvasReadWrite;
  index: ModuleBalancingIndex;
  t: (key: string) => string;
  warehouseForecasts: ModuleBalancingWarehouseForecast[];
}) {
  const meaningfulForecasts = warehouseForecasts.filter((forecast) => Math.abs(forecast.netDeltaPerMin) >= 0.005);

  return (
    <section className={cm(styles, "module-balancing-summary")}>
      <header className={cm(styles, "module-balancing-section-header")}>
        <h3>{t("moduleBalancing.summary")}</h3>
        {canvas !== undefined ? <span>{canvas.name}</span> : null}
      </header>
      <div className={cm(styles, "module-balancing-summary-list")}>
        {balances.length === 0 ? (
          <p className={cm(styles, "module-balancing-muted")}>{t("moduleBalancing.noSummary")}</p>
        ) : balances.map((balance) => (
          <div className={cm(styles, "module-balancing-summary-row")} key={balance.itemId}>
            <img alt="" src={resolveItemIconSrc(balance.itemId, index)} />
            <span>{resolveItemName(balance.itemId, index, t)}</span>
            <span>{t("moduleBalancing.outputItems")} {formatFlow(balance.totalOutput)}</span>
            <span>{t("moduleBalancing.inputItems")} {formatFlow(balance.totalInput)}</span>
            <strong className={cm(styles, resolveBalanceClassName(balance.netDelta))}>{formatSignedFlow(balance.netDelta)}</strong>
          </div>
        ))}
      </div>
      {warehouseForecasts.length > 0 ? (
        <div className={cm(styles, "module-balancing-warehouse-list")}>
          <h4>{t("moduleBalancing.warehouseAnalysis")}</h4>
          {meaningfulForecasts.length === 0 ? (
            <p className={cm(styles, "module-balancing-muted")}>{t("moduleBalancing.balanced")}</p>
          ) : meaningfulForecasts.map((forecast) => (
            <div className={cm(styles, "module-balancing-warehouse-row")} key={forecast.itemId}>
              <img alt="" src={resolveItemIconSrc(forecast.itemId, index)} />
              <span>{resolveItemName(forecast.itemId, index, t)}</span>
              {forecast.timeToFillMinutes !== null ? (
                <strong className={cm(styles, "is-surplus")}>{formatDurationMinutes(forecast.timeToFillMinutes)} {t("moduleBalancing.after")} {t("moduleBalancing.overflowTime")}</strong>
              ) : null}
              {forecast.timeToEmptyMinutes !== null ? (
                <strong className={cm(styles, "is-deficit")}>{formatDurationMinutes(forecast.timeToEmptyMinutes)} {t("moduleBalancing.after")} {t("moduleBalancing.exhaustTime")}</strong>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CustomModuleForm({
  draft,
  index,
  onCancel,
  onOpenPortPicker,
  onSave,
  onUpdate,
  t,
}: {
  draft: CustomModuleFormState;
  index: ModuleBalancingIndex;
  onCancel: () => void;
  onOpenPortPicker: (target: PendingPortTarget) => void;
  onSave: () => void;
  onUpdate: (draft: CustomModuleFormState | null) => void;
  t: (key: string) => string;
}) {
  const canSave = draft.name.trim().length > 0 && draft.outputs.some((port) => port.itemId.length > 0 && port.perMinute > 0);

  return (
    <section className={cm(styles, "module-balancing-custom-form")}>
      <header className={cm(styles, "module-balancing-form-header")}>
        <button className={cm(styles, "module-balancing-icon-button")} type="button" onClick={onCancel} aria-label={t("action.close")}>
          <LucideArrowLeft aria-hidden="true" />
        </button>
        <h3>{draft.id === null ? t("moduleBalancing.newModule") : t("moduleBalancing.editModule")}</h3>
      </header>
      <label className={cm(styles, "module-balancing-form-field")}>
        <span>{t("moduleBalancing.moduleName")}</span>
        <input value={draft.name} onChange={(event) => onUpdate({ ...draft, name: event.currentTarget.value })} />
      </label>
      <div className={cm(styles, "module-balancing-form-field")}>
        <span>{t("moduleBalancing.moduleColor")}</span>
        <div className={cm(styles, "module-balancing-color-row")}>
          {CUSTOM_MODULE_COLORS.map((color) => (
            <button
              aria-label={color}
              className={cm(styles, `module-balancing-color-swatch${draft.color === color ? " is-active" : ""}`)}
              key={color}
              style={{ backgroundColor: color }}
              type="button"
              onClick={() => onUpdate({ ...draft, color })}
            />
          ))}
        </div>
      </div>
      <label className={cm(styles, "module-balancing-form-field")}>
        <span>{t("moduleBalancing.moduleIcon")}</span>
        <select value={draft.iconId} onChange={(event) => onUpdate({ ...draft, iconId: event.currentTarget.value })}>
          <optgroup label={t("encyclopedia.category.items")}>
            {index.allItems.map((item) => (
              <option key={item.id} value={item.id}>{t(item.nameKey)}</option>
            ))}
          </optgroup>
          <optgroup label={t("encyclopedia.category.entities")}>
            {index.allEntities.map((entity) => (
              <option key={entity.id} value={entity.id}>{t(entity.nameKey)}</option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className={cm(styles, "module-balancing-custom-icon-preview")}>
        <img alt="" src={resolveAnyIconSrc(draft.iconId, index)} />
      </div>
      <section className={cm(styles, "module-balancing-form-ports")}>
        <header className={cm(styles, "module-balancing-section-header")}>
          <h4>{t("moduleBalancing.inputItems")}</h4>
          <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={() => onOpenPortPicker({ kind: "custom-input" })}>
            <LucidePlus aria-hidden="true" />
            <span>{t("moduleBalancing.addInputItem")}</span>
          </button>
        </header>
        <PortListEditor
          index={index}
          onChange={(ports) => onUpdate({ ...draft, inputs: ports })}
          ports={draft.inputs}
          t={t}
        />
      </section>
      <section className={cm(styles, "module-balancing-form-ports")}>
        <header className={cm(styles, "module-balancing-section-header")}>
          <h4>{t("moduleBalancing.outputItems")}</h4>
          <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={() => onOpenPortPicker({ kind: "custom-output" })}>
            <LucidePlus aria-hidden="true" />
            <span>{t("moduleBalancing.addOutputItem")}</span>
          </button>
        </header>
        <PortListEditor
          index={index}
          onChange={(ports) => onUpdate({ ...draft, outputs: ports })}
          ports={draft.outputs}
          t={t}
        />
      </section>
      <footer className={cm(styles, "module-balancing-form-actions")}>
        <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onCancel}>
          <LucideX aria-hidden="true" />
          <span>{t("action.close")}</span>
        </button>
        <button className={cm(styles, "module-balancing-primary-button")} disabled={!canSave} type="button" onClick={onSave}>
          <LucideSave aria-hidden="true" />
          <span>{t("moduleBalancing.saveModule")}</span>
        </button>
      </footer>
    </section>
  );
}

function PortListEditor({
  index,
  onChange,
  ports,
  t,
}: {
  index: ModuleBalancingIndex;
  onChange: (ports: ModuleBalancingIOPortReadWrite[]) => void;
  ports: readonly ModuleBalancingIOPort[];
  t: (key: string) => string;
}) {
  if (ports.length === 0) {
    return <p className={cm(styles, "module-balancing-muted")}>{t("moduleBalancing.emptyPorts")}</p>;
  }

  return (
    <div className={cm(styles, "module-balancing-port-list")}>
      {ports.map((port, portIndex) => (
        <div className={cm(styles, "module-balancing-port-row")} key={`${port.itemId}-${portIndex}`}>
          <img alt="" src={resolveItemIconSrc(port.itemId, index)} />
          <select
            value={port.itemId}
            onChange={(event) => {
              const nextPorts = ports.map(clonePort);
              const target = nextPorts[portIndex];
              if (target !== undefined) {
                target.itemId = event.currentTarget.value;
              }
              onChange(nextPorts);
            }}
          >
            {index.allItems.map((item) => (
              <option key={item.id} value={item.id}>{t(item.nameKey)}</option>
            ))}
          </select>
          <NumberInput
            min={0}
            value={port.perMinute}
            onCommit={(next) => {
              const nextPorts = ports.map(clonePort);
              const target = nextPorts[portIndex];
              if (target !== undefined) {
                target.perMinute = Math.max(0, next);
              }
              onChange(nextPorts);
            }}
          />
          <span>/min</span>
          <button
            aria-label={t("moduleBalancing.removeInput")}
            className={cm(styles, "module-balancing-mini-icon-button")}
            title={t("moduleBalancing.removeInput")}
            type="button"
            onClick={() => onChange(ports.filter((_, index) => index !== portIndex).map(clonePort))}
          >
            <LucideX aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function QuantityEditor({
  draft,
  index,
  onCancel,
  onConfirm,
  onDelete,
  onUpdate,
  t,
}: {
  draft: QuantityDraft;
  index: ModuleBalancingIndex;
  onCancel: () => void;
  onConfirm: () => void;
  onDelete: () => void;
  onUpdate: (draft: QuantityDraft) => void;
  t: (key: string) => string;
}) {
  const module = resolveModule(draft.moduleId, index);
  const quantity = normalizeQuantity(draft.quantity) ?? 0;

  if (module === null) {
    return null;
  }

  const stepQuantity = (delta: number) => {
    const nextQuantity = Math.max(0.01, Math.round((quantity + delta) * 100) / 100);
    onUpdate({ ...draft, quantity: nextQuantity.toFixed(2) });
  };

  return (
    <div className={cm(styles, "module-balancing-editor-backdrop")} onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onCancel();
      }
    }}>
      <section className={cm(styles, "module-balancing-quantity-editor")} role="dialog" aria-modal="true">
        <header className={cm(styles, "module-balancing-form-header")}>
          <h3>{draft.mode === "add" ? t("moduleBalancing.addToStage") : t("moduleBalancing.editQuantity")}</h3>
          <button className={cm(styles, "module-balancing-icon-button")} type="button" onClick={onCancel} aria-label={t("action.close")}>
            <LucideX aria-hidden="true" />
          </button>
        </header>
        <div className={cm(styles, "module-balancing-quantity-module")}>
          <img alt="" src={resolveModuleIconSrc(module, index)} />
          <div>
            <strong>{resolveModuleTitle(module, index, t)}</strong>
            <span>{formatModuleTooltip(module, index, t)}</span>
          </div>
        </div>
        <label className={cm(styles, "module-balancing-form-field")}>
          <span>{t("moduleBalancing.quantity")}</span>
          <NumberInput min={0.01} value={draft.quantity} onRawChange={(raw) => onUpdate({ ...draft, quantity: raw })} />
        </label>
        <div className={cm(styles, "module-balancing-step-row")}>
          {[-1, -0.1, 0.1, 1, 10].map((delta) => (
            <button key={delta} type="button" onClick={() => stepQuantity(delta)}>{delta > 0 ? `+${delta}` : delta}</button>
          ))}
        </div>
        <footer className={cm(styles, "module-balancing-form-actions")}>
          {draft.mode === "edit" ? (
            <button className={cm(styles, "module-balancing-danger-button")} type="button" onClick={onDelete}>
              <LucideTrash2 aria-hidden="true" />
              <span>{t("moduleBalancing.deleteFromStage")}</span>
            </button>
          ) : null}
          <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onCancel}>
            <LucideX aria-hidden="true" />
            <span>{t("action.close")}</span>
          </button>
          <button className={cm(styles, "module-balancing-primary-button")} disabled={normalizeQuantity(draft.quantity) === null} type="button" onClick={onConfirm}>
            <LucideSave aria-hidden="true" />
            <span>{draft.mode === "add" ? t("moduleBalancing.confirmAdd") : t("moduleBalancing.confirmEdit")}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function MobileTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={cm(styles, `module-balancing-bottom-tab${active ? " is-active" : ""}`)} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function resolveModuleTitle(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
  t: (key: string) => string,
): string {
  if (module.sourceType === "custom") {
    return module.name;
  }

  const outputs = resolveModuleOutputs(module, index);
  if (outputs.length > 0) {
    return formatPortList(outputs, index, t, false);
  }

  const recipe = index.recipeById.get(module.recipeId);
  return recipe === undefined ? module.recipeId : t(recipe.nameKey);
}

function formatPortList(
  ports: readonly ModuleBalancingIOPort[],
  index: ModuleBalancingIndex,
  t: (key: string) => string,
  withAmount = true,
): string {
  if (ports.length === 0) {
    return t("moduleBalancing.none");
  }

  return ports.map((port) => {
    const name = resolveItemName(port.itemId, index, t);
    return withAmount ? `${name} ${formatFlow(port.perMinute)}/min` : name;
  }).join(" + ");
}

function formatModuleTooltip(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
  t: (key: string) => string,
): string {
  const inputs = resolveModuleInputs(module, index);
  const outputs = resolveModuleOutputs(module, index);
  return `${t("moduleBalancing.inputItems")}: ${formatPortList(inputs, index, t)}\n${t("moduleBalancing.outputItems")}: ${formatPortList(outputs, index, t)}`;
}

function matchesModuleQuery(
  module: ModuleBalancingModule,
  normalizedQuery: string,
  index: ModuleBalancingIndex,
  t: (key: string) => string,
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }

  const searchable = [
    resolveModuleTitle(module, index, t),
    formatModuleTooltip(module, index, t),
    module.id,
  ].join(" ").toLowerCase();

  return searchable.includes(normalizedQuery);
}

function resolveBalanceClassName(netDelta: number): string {
  if (netDelta > 0.005) {
    return "is-surplus";
  }

  if (netDelta < -0.005) {
    return "is-deficit";
  }

  return "is-balanced";
}

function normalizeQuantity(value: string): number | null {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return Math.round(quantity * 100) / 100;
}

function moveStageEntry(stage: ModuleBalancingStageReadWrite, fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
    return;
  }

  runInAction(() => {
    const [entry] = stage.entries.splice(fromIndex, 1);
    if (entry !== undefined) {
      stage.entries.splice(toIndex, 0, entry);
    }
  });
}

function toggleSetValue(source: Set<string>, value: string): Set<string> {
  const next = new Set(source);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function clonePort(port: ModuleBalancingIOPort): ModuleBalancingIOPortReadWrite {
  return {
    itemId: port.itemId,
    perMinute: port.perMinute,
  };
}