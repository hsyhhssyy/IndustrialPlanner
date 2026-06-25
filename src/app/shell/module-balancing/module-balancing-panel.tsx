import { useEffect, useState } from "react";
import { runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import LucideArrowLeft from "~icons/lucide/arrow-left";
import LucideEdit3 from "~icons/lucide/edit-3";
import LucideLayers3 from "~icons/lucide/layers-3";
import LucidePlus from "~icons/lucide/plus";
import LucideSave from "~icons/lucide/save";
import LucideSearch from "~icons/lucide/search";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { ActivityIconStrip } from "@/app/shell/shared/activity-icon-strip";
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
  ModuleBalancingSystemRecipeModule,
} from "@/app/toolbox-types";
import {
  buildModuleBalancingIndex,
  canvasContainsInactiveActivityContent,
  computeModuleBalancing,
  computeStageModuleTotals,
  createModuleBalancingId,
  formatDurationMinutes,
  formatFlow,
  formatSignedFlow,
  moduleContainsInactiveActivityContent,
  resolveCanvasActivityIds,
  resolveAnyIconSrc,
  resolveItemIconSrc,
  resolveItemName,
  resolveModule,
  resolveModuleActivityIds,
  resolveModuleIconSrc,
  resolveModuleInputs,
  resolveModuleOutputs,
  type ModuleBalancingDispatchTicketSummary,
  type ModuleBalancingIndex,
  type ModuleBalancingItemBalance,
  type ModuleBalancingWarehouseForecast,
} from "@/app/shell/module-balancing/module-balancing-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { NumberInput } from "@/app/shell/shared/number-input";
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";

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

type ModuleBalancingPage =
  | { kind: "canvas" }
  | { kind: "input" }
  | { kind: "stage"; stageId: string }
  | { kind: "summary" };

type ModuleLibraryTab = "recipes" | "modules";

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
  notes: string;
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
  const showAllActivityContent = appHost.internalState.settings.toolboxShowAllActivityContent;
  const activeActivityIds = resolveEffectiveActivityIds({
    selectedActivityIds: appHost.internalState.settings.selectedActivityIds,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<ModuleBalancingPage>({ kind: "canvas" });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState<ModuleLibraryTab>("recipes");
  const [newCanvasDialogOpen, setNewCanvasDialogOpen] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState("");
  const [expandedBalanceIds, setExpandedBalanceIds] = useState<Set<string>>(() => new Set());
  const [quantityDraft, setQuantityDraft] = useState<QuantityDraft | null>(null);
  const [customModuleForm, setCustomModuleForm] = useState<CustomModuleFormState | null>(null);

  const index = buildModuleBalancingIndex(appHost.workspace.registry, balancingState, {
    includeInactiveActivityContent: showAllActivityContent,
    activeActivityIds,
  });
  const visibleCanvases = showAllActivityContent
    ? balancingState.canvases
    : balancingState.canvases.filter((canvas) =>
      !canvasContainsInactiveActivityContent(canvas, index, activeActivityIds),
    );
  const activeCanvas = visibleCanvases.find((canvas) => canvas.id === balancingState.activeCanvasId)
    ?? visibleCanvases[0]
    ?? null;
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
    setActivePage({ kind: "stage", stageId });
  };

  const openNewCustomModuleForm = () => {
    setCustomModuleForm({
      id: null,
      name: "",
      color: CUSTOM_MODULE_COLORS[0],
      iconId: index.allItems[0]?.id ?? index.allEntities[0]?.id ?? "item_port_grinder_1",
      notes: "",
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
      notes: customModule.notes,
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
      notes: "",
      inputs,
      outputs,
    });
  };

  const closeCustomModuleForm = () => {
    setCustomModuleForm(null);
  };

  const saveCustomModule = (draft: CustomModuleFormState) => {
    const normalizedName = draft.name.trim();
    const inputs = draft.inputs.filter((port) => port.itemId.length > 0 && port.perMinute > 0);
    const outputs = draft.outputs.filter((port) => port.itemId.length > 0 && port.perMinute > 0);
    if (normalizedName.length === 0 || (inputs.length === 0 && outputs.length === 0)) {
      return;
    }

    const nextModule: ModuleBalancingCustomModuleReadWrite = {
      id: draft.id ?? createModuleBalancingId("custom-module"),
      name: normalizedName,
      color: draft.color,
      iconId: draft.iconId,
      notes: draft.notes,
      inputs: inputs.map(clonePort),
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
      includeInactiveActivityItems: showAllActivityContent,
      title: t("encyclopediaPicker.title.item"),
    });

    if (itemId === null) {
      return;
    }

    addPort(target, itemId);
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
  const deleteCustomModule = (moduleId: string) => {
    runInAction(() => {
      balancingState.customModules = balancingState.customModules.filter((module) => module.id !== moduleId);
      for (const canvas of balancingState.canvases) {
        for (const stage of canvas.stages) {
          stage.entries = stage.entries.filter((entry) => entry.moduleId !== moduleId);
        }
      }
    });
  };
  const addModuleToSelectedStage = (moduleId: string) => {
    if (selectedStage === null) {
      addStage();
      return;
    }
    openAddModuleDraft(selectedStage.id, moduleId);
  };
  const createCanvas = () => {
    const normalizedName = newCanvasName.trim();
    const nextCanvas = createDefaultModuleBalancingCanvas();
    nextCanvas.id = createModuleBalancingId("canvas");
    nextCanvas.name = normalizedName || `${t("moduleBalancing.canvas")} ${balancingState.canvases.length + 1}`;
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
    setActivePage({ kind: "canvas" });
    setNewCanvasName("");
    setNewCanvasDialogOpen(false);
  };

  const content = (
    <div className={cm(styles, "module-balancing-wizard")}>
      <WizardNavigation
        activeCanvas={activeCanvas}
        activePage={activePage}
        onAddStage={addStage}
        onOpenLibrary={() => setLibraryOpen(true)}
        onSelectPage={(page) => {
          setActivePage(page);
          if (page.kind === "stage") {
            setSelectedStageId(page.stageId);
          }
        }}
        t={t}
      />
      <main className={cm(styles, "module-balancing-page")}>
        {activePage.kind === "canvas" ? (
          <CanvasSettingsPanel
            activeCanvas={activeCanvas}
            activityIds={showAllActivityContent ? resolveCanvasActivityIds(activeCanvas, index) : []}
            canDelete={visibleCanvases.length > 1}
            onCreateCanvas={() => {
              setNewCanvasName("");
              setNewCanvasDialogOpen(true);
            }}
            onDeleteCanvas={() => {
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
            onSelectCanvas={(canvasId) => {
              runInAction(() => { balancingState.activeCanvasId = canvasId; });
              setSelectedStageId(null);
            }}
            t={t}
            visibleCanvases={visibleCanvases}
          />
        ) : null}
        {activePage.kind === "input" ? (
          <CanvasInputPanel
            canvas={activeCanvas}
            index={index}
            onOpenPortPicker={() => { void requestPortSelection({ kind: "global" }); }}
            onRequestPickItem={(portIndex) => {
              void (async () => {
                const itemId = await appHost.encyclopediaPicker.pickItem({
                  includeInactiveActivityItems: showAllActivityContent,
                  title: t("encyclopediaPicker.title.item"),
                });
                if (itemId === null) return;
                runInAction(() => {
                  const port = activeCanvas.globalInputs[portIndex];
                  if (port) port.itemId = itemId;
                });
              })();
            }}
            t={t}
          />
        ) : null}
        {activePage.kind === "stage" ? (
          <StageDetailPanel
            expandedBalanceIds={expandedBalanceIds}
            index={index}
            onAddModule={() => setLibraryOpen(true)}
            onAddStage={addStage}
            onClearStage={(stage) => runInAction(() => { stage.entries = []; })}
            onEditEntry={openEditEntryDraft}
            onOpenStageAsModule={openStageAsCustomModuleForm}
            onRenameStage={(stage, name) => runInAction(() => { stage.name = name; })}
            onToggleBalance={(stageId) => setExpandedBalanceIds(toggleSetValue(expandedBalanceIds, stageId))}
            selectedStage={activeCanvas.stages.find((stage) => stage.id === activePage.stageId) ?? null}
            showActivityIcons={showAllActivityContent}
            stageBalance={stageBalanceByStageId.get(activePage.stageId)?.balances ?? []}
            t={t}
          />
        ) : null}
        {activePage.kind === "summary" ? (
          <SummaryPanel
            balances={computation.summaryBalances}
            canvas={activeCanvas}
            dispatchTicketSummaries={computation.dispatchTicketSummaries}
            index={index}
            t={t}
            warehouseForecasts={computation.warehouseForecasts}
          />
        ) : null}
      </main>
    </div>
  );

  return (
    <div className={cm(styles, `toolbox-dialog-content module-balancing-panel${isTouch ? " is-touch" : ""}`)}>
      {content}
      {libraryOpen ? (
        <div className={cm(styles, "module-balancing-drawer-layer")} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setLibraryOpen(false);
          }
        }}>
          <aside className={cm(styles, "module-balancing-drawer")}>
            <header className={cm(styles, "module-balancing-drawer-header")}>
              <h3>{t("moduleBalancing.moduleLibrary")}</h3>
              <div className={cm(styles, "module-balancing-library-tabs")}>
                <button className={cm(styles, libraryTab === "recipes" ? "is-active" : "")} type="button" onClick={() => setLibraryTab("recipes")}>{t("moduleBalancing.recipes")}</button>
                <button className={cm(styles, libraryTab === "modules" ? "is-active" : "")} type="button" onClick={() => setLibraryTab("modules")}>{t("moduleBalancing.modules")}</button>
              </div>
              <button className={cm(styles, "module-balancing-icon-button")} type="button" onClick={() => setLibraryOpen(false)} aria-label={t("action.close")}>
                <LucideX aria-hidden="true" />
              </button>
            </header>
            <ModuleLibrary
              activeCanvas={activeCanvas}
              activeActivityIds={activeActivityIds}
              index={index}
              isTouch={isTouch}
              libraryTab={libraryTab}
              onAddModule={addModuleToSelectedStage}
              onCreateCustomModule={openNewCustomModuleForm}
              onDeleteCustomModule={deleteCustomModule}
              onEditCustomModule={openEditCustomModuleForm}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              showActivityIcons={showAllActivityContent}
              t={t}
            />
          </aside>
        </div>
      ) : null}
      {newCanvasDialogOpen ? (
        <div className={cm(styles, "module-balancing-editor-backdrop")} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setNewCanvasDialogOpen(false);
          }
        }}>
          <section className={cm(styles, "module-balancing-quantity-editor")} role="dialog" aria-modal="true">
            <header className={cm(styles, "module-balancing-form-header")}>
              <h3>{t("moduleBalancing.newCanvas")}</h3>
              <button className={cm(styles, "module-balancing-icon-button")} type="button" onClick={() => setNewCanvasDialogOpen(false)} aria-label={t("action.close")}>
                <LucideX aria-hidden="true" />
              </button>
            </header>
            <label className={cm(styles, "module-balancing-form-field")}>
              <span>{t("moduleBalancing.canvasPlaceholder")}</span>
              <input autoFocus value={newCanvasName} onChange={(event) => setNewCanvasName(event.currentTarget.value)} onKeyDown={(event) => {
                if (event.key === "Enter") {
                  createCanvas();
                }
              }} />
            </label>
            <footer className={cm(styles, "module-balancing-form-actions")}>
              <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={() => setNewCanvasDialogOpen(false)}>{t("action.close")}</button>
              <button className={cm(styles, "module-balancing-primary-button")} type="button" onClick={createCanvas}>
                <LucidePlus aria-hidden="true" />
                <span>{t("moduleBalancing.newCanvas")}</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {customModuleForm !== null ? (
        <div className={cm(styles, "module-balancing-editor-backdrop")} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeCustomModuleForm();
          }
        }}>
          <CustomModuleForm
            draft={customModuleForm}
            index={index}
            onCancel={closeCustomModuleForm}
            onOpenPortPicker={(target) => { void requestPortSelection(target); }}
            onPickIcon={() => {
              void (async () => {
                const itemId = await appHost.encyclopediaPicker.pickItem({
                  includeInactiveActivityItems: showAllActivityContent,
                  title: t("moduleBalancing.moduleIcon"),
                });
                if (itemId === null) return;
                setCustomModuleForm((draft) => {
                  if (!draft) return draft;
                  return { ...draft, iconId: itemId };
                });
              })();
            }}
            onRequestPickItem={(kind, portIndex) => {
              void (async () => {
                const itemId = await appHost.encyclopediaPicker.pickItem({
                  includeInactiveActivityItems: showAllActivityContent,
                  title: t("encyclopediaPicker.title.item"),
                });
                if (itemId === null) return;
                setCustomModuleForm((draft) => {
                  if (!draft) return draft;
                  const key = kind === 'input' ? 'inputs' as const : 'outputs' as const;
                  const ports = draft[key].map(clonePort);
                  const target = ports[portIndex];
                  if (target) target.itemId = itemId;
                  return { ...draft, [key]: ports };
                });
              })();
            }}
            onSave={() => saveCustomModule(customModuleForm)}
            onUpdate={setCustomModuleForm}
            t={t}
          />
        </div>
      ) : null}
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
  activeActivityIds,
  index,
  isTouch,
  libraryTab,
  onAddModule,
  onCreateCustomModule,
  onDeleteCustomModule,
  onEditCustomModule,
  searchQuery,
  setSearchQuery,
  showActivityIcons,
  t,
}: {
  activeCanvas: ModuleBalancingCanvasReadWrite;
  activeActivityIds: readonly string[];
  index: ModuleBalancingIndex;
  isTouch: boolean;
  libraryTab: ModuleLibraryTab;
  onAddModule: (moduleId: string) => void;
  onCreateCustomModule: () => void;
  onDeleteCustomModule: (moduleId: string) => void;
  onEditCustomModule: (module: ModuleBalancingCustomModule) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  showActivityIcons: boolean;
  t: (key: string) => string;
}) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const systemModules = index.systemModules.filter((module) => matchesModuleQuery(module, normalizedQuery, index, t));
  const customModules = Array.from(index.customModuleById.values())
    .filter((module) =>
      showActivityIcons
      || !moduleContainsInactiveActivityContent(module, index, activeActivityIds),
    )
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
      {libraryTab === "recipes" ? (
        <ModuleSection
          count={systemModules.length}
          index={index}
          isTouch={isTouch}
          modules={systemModules}
          onAddModule={onAddModule}
          showActivityIcons={showActivityIcons}
          t={t}
          title={t("moduleBalancing.systemModules")}
        />
      ) : (
        <>
          <ModuleSection
            count={customModules.length}
            index={index}
            isTouch={isTouch}
            modules={customModules}
            onAddModule={onAddModule}
            onDeleteCustomModule={onDeleteCustomModule}
            onEditCustomModule={onEditCustomModule}
            showActivityIcons={showActivityIcons}
            t={t}
            title={t("moduleBalancing.customModules")}
          />
          <button className={cm(styles, "module-balancing-new-module-button")} type="button" onClick={onCreateCustomModule}>
            <LucidePlus aria-hidden="true" />
            <span>{t("moduleBalancing.newModule")}</span>
          </button>
        </>
      )}
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
  showActivityIcons,
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
  showActivityIcons: boolean;
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
            showActivityIcons={showActivityIcons}
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
  showActivityIcons,
  t,
}: {
  index: ModuleBalancingIndex;
  isTouch: boolean;
  module: ModuleBalancingModule;
  onAdd: () => void;
  onDeleteCustomModule?: (moduleId: string) => void;
  onEditCustomModule?: (module: ModuleBalancingCustomModule) => void;
  showActivityIcons: boolean;
  t: (key: string) => string;
}) {
  const outputs = resolveModuleOutputs(module, index);
  const title = resolveModuleTitle(module, index, t);
  const activityIds = showActivityIcons ? resolveModuleActivityIds(module, index) : [];
  const subtitle = module.sourceType === "custom"
    ? formatPortList(outputs, index, t)
    : undefined;
  const isSystemRecipe = module.sourceType === "system-recipe";
  const moduleColor = module.sourceType === "custom" ? module.color : undefined;

  return (
    <div
      className={cm(styles, "module-balancing-module-card")}
      draggable={!isTouch}
      style={moduleColor !== undefined ? { borderLeftColor: moduleColor } : undefined}
      role="button"
      tabIndex={0}
      title={formatModuleTooltip(module, index, t)}
      onClick={onAdd}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onAdd();
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(MODULE_DRAG_TYPE, module.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <img alt="" className={cm(styles, "module-balancing-module-icon")} src={resolveModuleIconSrc(module, index)} />
      <span className={cm(styles, "module-balancing-module-card-copy")}>
        <span className={cm(styles, "module-balancing-module-title-row")}>
          <span className={cm(styles, "module-balancing-module-title")}>{title}</span>
          <ActivityIconStrip activityIds={activityIds} />
        </span>
        {isSystemRecipe ? (
          <RecipeDisplay recipeId={(module as ModuleBalancingSystemRecipeModule).recipeId} index={index} t={t} />
        ) : subtitle !== undefined ? (
          <span className={cm(styles, "module-balancing-module-subtitle")}>{subtitle}</span>
        ) : null}
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
    </div>
  );
}

function CanvasInputPanel({
  canvas,
  index,
  onOpenPortPicker,
  onRequestPickItem,
  t,
}: {
  canvas: ModuleBalancingCanvasReadWrite;
  index: ModuleBalancingIndex;
  onOpenPortPicker: () => void;
  onRequestPickItem: (portIndex: number) => void;
  t: (key: string) => string;
}) {
  return (
    <section className={cm(styles, "module-balancing-input-panel")}>
      <header className={cm(styles, "module-balancing-section-header")}>
        <div className={cm(styles, "module-balancing-section-title")}>
          <h3>{t("moduleBalancing.systemInput")}</h3>
          <span>{canvas.globalInputs.length}</span>
        </div>
        <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onOpenPortPicker}>
          <LucidePlus aria-hidden="true" />
          <span>{t("moduleBalancing.addInput")}</span>
        </button>
      </header>
      <PortListEditor
        index={index}
        onChange={(ports) => runInAction(() => { canvas.globalInputs = ports; })}
        onRequestPickItem={onRequestPickItem}
        ports={canvas.globalInputs}
        t={t}
      />
    </section>
  );
}

function WizardNavigation({
  activeCanvas,
  activePage,
  onAddStage,
  onOpenLibrary,
  onSelectPage,
  t,
}: {
  activeCanvas: ModuleBalancingCanvasReadWrite;
  activePage: ModuleBalancingPage;
  onAddStage: () => void;
  onOpenLibrary: () => void;
  onSelectPage: (page: ModuleBalancingPage) => void;
  t: (key: string) => string;
}) {
  return (
    <nav className={cm(styles, "module-balancing-wizard-nav")} aria-label={t("toolboxDialog.tab.moduleBalancing")}>
      <button className={cm(styles, "module-balancing-library-button")} type="button" onClick={onOpenLibrary}>
        <LucideLayers3 aria-hidden="true" />
        <span>{t("moduleBalancing.moduleLibrary")}</span>
      </button>
      <div className={cm(styles, "module-balancing-wizard-tabs")}>
        <button
          className={cm(styles, `module-balancing-wizard-tab${activePage.kind === "canvas" ? " is-active" : ""}`)}
          type="button"
          onClick={() => onSelectPage({ kind: "canvas" })}
        >
          {t("moduleBalancing.canvas")}
        </button>
        <button
          className={cm(styles, `module-balancing-wizard-tab${activePage.kind === "input" ? " is-active" : ""}`)}
          type="button"
          onClick={() => onSelectPage({ kind: "input" })}
        >
          {t("moduleBalancing.systemInput")}
        </button>
        {activeCanvas.stages.map((stage) => (
          <button
            className={cm(styles, `module-balancing-wizard-tab${activePage.kind === "stage" && activePage.stageId === stage.id ? " is-active" : ""}`)}
            key={stage.id}
            type="button"
            onClick={() => onSelectPage({ kind: "stage", stageId: stage.id })}
          >
            {stage.name}
          </button>
        ))}
        <button
          className={cm(styles, `module-balancing-wizard-tab${activePage.kind === "summary" ? " is-active" : ""}`)}
          type="button"
          onClick={() => onSelectPage({ kind: "summary" })}
        >
          {t("moduleBalancing.summary")}
        </button>
        <button
          aria-label={t("moduleBalancing.newStage")}
          className={cm(styles, "module-balancing-wizard-add")}
          title={t("moduleBalancing.newStage")}
          type="button"
          onClick={onAddStage}
        >
          <LucidePlus aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

function CanvasSettingsPanel({
  activeCanvas,
  activityIds,
  canDelete,
  onCreateCanvas,
  onDeleteCanvas,
  onSelectCanvas,
  t,
  visibleCanvases,
}: {
  activeCanvas: ModuleBalancingCanvasReadWrite;
  activityIds: readonly string[];
  canDelete: boolean;
  onCreateCanvas: () => void;
  onDeleteCanvas: () => void;
  onSelectCanvas: (canvasId: string) => void;
  t: (key: string) => string;
  visibleCanvases: readonly ModuleBalancingCanvasReadWrite[];
}) {
  return (
    <section className={cm(styles, "module-balancing-canvas-settings")}>
      <header className={cm(styles, "module-balancing-section-header")}>
        <div className={cm(styles, "module-balancing-section-title")}>
          <h3>{t("moduleBalancing.canvas")}</h3>
          <span>{activeCanvas.name}</span>
        </div>
        <div className={cm(styles, "module-balancing-canvas-header-meta")}>
          <ActivityIconStrip activityIds={activityIds} />
          <span>{activeCanvas.stages.length} {t("moduleBalancing.stage")}</span>
        </div>
      </header>
      <div className={cm(styles, "module-balancing-canvas-form")}>
        <label className={cm(styles, "module-balancing-form-field")}>
          <span>{t("moduleBalancing.canvas")}</span>
          <select value={activeCanvas.id} onChange={(event) => onSelectCanvas(event.currentTarget.value)}>
            {visibleCanvases.map((canvas) => (
              <option key={canvas.id} value={canvas.id}>{canvas.name}</option>
            ))}
          </select>
        </label>
        <label className={cm(styles, "module-balancing-form-field")}>
          <span>{t("moduleBalancing.canvasPlaceholder")}</span>
          <input value={activeCanvas.name} onChange={(event) => {
            const name = event.currentTarget.value;
            runInAction(() => { activeCanvas.name = name; });
          }} />
        </label>
        <label className={cm(styles, "module-balancing-form-field")}>
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
      <footer className={cm(styles, "module-balancing-form-actions")}>
        <button className={cm(styles, "module-balancing-danger-button")} disabled={!canDelete} type="button" onClick={onDeleteCanvas}>
          <LucideTrash2 aria-hidden="true" />
          <span>{t("moduleBalancing.deleteCanvas")}</span>
        </button>
        <button className={cm(styles, "module-balancing-primary-button")} type="button" onClick={onCreateCanvas}>
          <LucidePlus aria-hidden="true" />
          <span>{t("moduleBalancing.newCanvas")}</span>
        </button>
      </footer>
    </section>
  );
}

function StageDetailPanel({
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
  showActivityIcons,
  stageBalance,
  t,
}: {
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
  showActivityIcons: boolean;
  stageBalance: ModuleBalancingItemBalance[] | null;
  t: (key: string) => string;
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
        showActivityIcons={showActivityIcons}
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
        <span>{t("moduleBalancing.stage")} · {stage.entries.length}</span>
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
  showActivityIcons,
  stage,
  t,
}: {
  index: ModuleBalancingIndex;
  isTouch: boolean;
  onAddModule: () => void;
  onEditEntry: (moduleId: string, entryIndex: number, quantity: number) => void;
  onMoveEntry: (fromIndex: number, toIndex: number) => void;
  onOpenLibrary: () => void;
  showActivityIcons: boolean;
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
        const activityIds = showActivityIcons ? resolveModuleActivityIds(module, index) : [];
        const inputs = resolveModuleInputs(module, index);
        const outputs = resolveModuleOutputs(module, index);

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
            <span className={cm(styles, "module-balancing-stage-entry-title")}>
              <span>{resolveModuleTitle(module, index, t)}</span>
              <ActivityIconStrip activityIds={activityIds} />
            </span>
            <span className={cm(styles, "module-balancing-stage-entry-flow")}>
              {formatPortList(inputs, index, t)} → {formatPortList(outputs, index, t)}
            </span>
            <strong className={cm(styles, "module-balancing-stage-entry-quantity")}>× {formatFlow(entry.quantity)}</strong>
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
  dispatchTicketSummaries,
  index,
  t,
  warehouseForecasts,
}: {
  balances: ModuleBalancingItemBalance[];
  canvas?: ModuleBalancingCanvasReadWrite;
  dispatchTicketSummaries: ModuleBalancingDispatchTicketSummary[];
  index: ModuleBalancingIndex;
  t: (key: string) => string;
  warehouseForecasts: ModuleBalancingWarehouseForecast[];
}) {
  const meaningfulForecasts = warehouseForecasts.filter((forecast) => Math.abs(forecast.netDeltaPerMin) >= 0.005);
  const dispatchTotal = dispatchTicketSummaries.reduce((sum, item) => sum + item.dispatchPerMin, 0);

  return (
    <section className={cm(styles, "module-balancing-summary")}>
      <header className={cm(styles, "module-balancing-section-header")}>
        <div className={cm(styles, "module-balancing-section-title")}>
          <h3>{t("moduleBalancing.summary")}</h3>
          {canvas !== undefined ? <span>{canvas.name}</span> : null}
        </div>
        <span className={cm(styles, "module-balancing-summary-count")}>{balances.length}</span>
      </header>
      <div className={cm(styles, "module-balancing-summary-list")}>
        {balances.length === 0 ? (
          <p className={cm(styles, "module-balancing-muted")}>{t("moduleBalancing.noSummary")}</p>
        ) : balances.map((balance) => (
          <div className={cm(styles, "module-balancing-summary-row")} key={balance.itemId}>
            <img alt="" src={resolveItemIconSrc(balance.itemId, index)} />
            <strong className={cm(styles, "module-balancing-summary-item-name")}>{resolveItemName(balance.itemId, index, t)}</strong>
            <span className={cm(styles, "module-balancing-summary-metric")}>{t("moduleBalancing.outputItems")} <strong>{formatFlow(balance.totalOutput)}</strong></span>
            <span className={cm(styles, "module-balancing-summary-metric")}>{t("moduleBalancing.inputItems")} <strong>{formatFlow(balance.totalInput)}</strong></span>
            <strong className={cm(styles, `module-balancing-summary-net ${resolveBalanceClassName(balance.netDelta)}`)}>{formatSignedFlow(balance.netDelta)}/min</strong>
          </div>
        ))}
      </div>
      {dispatchTicketSummaries.length > 0 ? (
        <div className={cm(styles, "module-balancing-dispatch-list")}>
          <h4>{t("moduleBalancing.dispatchTicketTitle")}</h4>
          {dispatchTicketSummaries.map((summary) => (
            <div className={cm(styles, "module-balancing-warehouse-row")} key={summary.itemId}>
              <img alt="" src={resolveItemIconSrc(summary.itemId, index)} />
              <span>{resolveItemName(summary.itemId, index, t)}</span>
              <strong>{formatFlow(summary.dispatchPerMin)} {t("moduleBalancing.dispatchTicketUnit")}/min</strong>
            </div>
          ))}
          <div className={cm(styles, "module-balancing-dispatch-total")}>
            <strong>{t("moduleBalancing.dispatchTicketTotal")}</strong>
            <strong>{formatFlow(dispatchTotal)} {t("moduleBalancing.dispatchTicketUnit")}/min</strong>
          </div>
        </div>
      ) : null}
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
  onPickIcon,
  onRequestPickItem,
  onSave,
  onUpdate,
  t,
}: {
  draft: CustomModuleFormState;
  index: ModuleBalancingIndex;
  onCancel: () => void;
  onOpenPortPicker: (target: PendingPortTarget) => void;
  onPickIcon: () => void;
  onRequestPickItem: (kind: 'input' | 'output', portIndex: number) => void;
  onSave: () => void;
  onUpdate: (draft: CustomModuleFormState | null) => void;
  t: (key: string) => string;
}) {
  const canSave = draft.name.trim().length > 0 && (
    draft.inputs.some((port) => port.itemId.length > 0 && port.perMinute > 0)
    || draft.outputs.some((port) => port.itemId.length > 0 && port.perMinute > 0)
  );

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
        <span>{t("moduleBalancing.moduleIcon")}</span>
        <div className={cm(styles, "module-balancing-icon-color-row")}>
          <button className={cm(styles, "module-balancing-icon-picker")} type="button" onClick={onPickIcon}>
            <img alt="" src={resolveAnyIconSrc(draft.iconId, index)} />
          </button>
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
          onRequestPickItem={(portIndex) => onRequestPickItem('input', portIndex)}
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
          onRequestPickItem={(portIndex) => onRequestPickItem('output', portIndex)}
          ports={draft.outputs}
          t={t}
        />
      </section>
      <label className={cm(styles, "module-balancing-form-field", "module-balancing-form-notes")}>
        <span>{t("moduleBalancing.moduleNotes")}</span>
        <textarea
          maxLength={200}
          rows={3}
          value={draft.notes}
          onChange={(event) => onUpdate({ ...draft, notes: event.currentTarget.value })}
          placeholder={t("moduleBalancing.moduleNotesPlaceholder")}
        />
      </label>
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
  onRequestPickItem,
  ports,
  t,
}: {
  index: ModuleBalancingIndex;
  onChange: (ports: ModuleBalancingIOPortReadWrite[]) => void;
  onRequestPickItem: (portIndex: number) => void;
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
          <button
            type="button"
            className={cm(styles, "module-balancing-port-item-pick")}
            onClick={() => onRequestPickItem(portIndex)}
          >
            {resolveItemName(port.itemId, index, t)}
          </button>
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

  // 无产出配方：优先用输入物品名作为标题，而非 recipe.nameKey（后者 i18n 可能缺失导致显示 ID）
  const inputs = resolveModuleInputs(module, index);
  if (inputs.length > 0) {
    return formatPortList(inputs, index, t, false);
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
