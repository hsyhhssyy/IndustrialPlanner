import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import LucideArrowLeft from "~icons/lucide/arrow-left";
import LucideCheck from "~icons/lucide/check";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideChevronRight from "~icons/lucide/chevron-right";
import LucideDownload from "~icons/lucide/download";
import LucideEdit3 from "~icons/lucide/edit-3";
import LucideFolder from "~icons/lucide/folder";
import LucideFolderInput from "~icons/lucide/folder-input";
import LucideFolderPlus from "~icons/lucide/folder-plus";
import LucideLayers3 from "~icons/lucide/layers-3";
import LucidePackagePlus from "~icons/lucide/package-plus";
import LucidePlus from "~icons/lucide/plus";
import LucideSave from "~icons/lucide/save";
import LucideSearch from "~icons/lucide/search";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideUpload from "~icons/lucide/upload";
import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { ActivityIconStrip } from "@/app/shell/shared/activity-icon-strip";
import type {
  ModuleBalancingCanvasReadWrite,
  ModuleBalancingCustomModuleReadWrite,
  ModuleBalancingFolderReadWrite,
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
  ModuleBalancingRecommendedModule,
  // AI-REMOVED 2026-07-27:
  // Reason: ModuleCard 不再直接访问系统配方 recipeId，标题和图标统一由 module-balancing-model 解析。
  // Trigger: 系统配方卡改为设备头图和“产物 · 设备”文本。
  // Evidence: resolveModuleDisplayTitle 与 resolveModuleIconSrc 已覆盖显示所需数据。
  // Replacement: ModuleBalancingModule
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // ModuleBalancingSystemRecipeModule,
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
  matchesModuleSearchQuery,
  moduleContainsInactiveActivityContent,
  resolveCanvasActivityIds,
  resolveAnyIconSrc,
  resolveItemIconSrc,
  resolveItemName,
  resolveModule,
  resolveModuleActivityIds,
  resolveModuleDisplayTitle,
  resolveModuleIconSrc,
  resolveModuleInputs,
  resolveModuleOutputs,
  resolveInfiniteSystemInputItemIds,
  type ModuleBalancingDispatchTicketGroup,
  type ModuleBalancingIndex,
  type ModuleBalancingItemBalance,
  type ModuleBalancingWarehouseForecast,
} from "@/app/shell/module-balancing/module-balancing-model";
import {
  buildCanvasExportData,
  buildCanvasImportPlan,
  downloadCanvasExportJson,
  parseCanvasImportData,
  applyCanvasImport,
  type CanvasImportPlan,
} from "@/app/shell/module-balancing/canvas-io";
import {
  readRecommendedCanvasLibrary,
  type RecommendedCanvasRecord,
} from "@/app/shell/module-balancing/recommended-canvas-library";
import { readRecommendedModuleLibrary } from "@/app/shell/module-balancing/recommended-module-library";
import {
  applyVersionResourcePreset,
  readVersionResourceLibrary,
  type VersionResourcePreset,
} from "@/app/shell/module-balancing/version-resource-library";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { NumberInput } from "@/app/shell/shared/number-input";
import { OverlayStackLayer, useOverlayStackLayer } from "@/app/shell/shared/overlay-stack";
// AI-REMOVED 2026-07-27:
// Reason: 系统配方卡改为设备图标与“产出物品 · 设备名称”单行头部，不再渲染完整配方公式。
// Trigger: 用户要求调整系统配方模块外观。
// Evidence: ModuleCard 的系统配方分支现由 resolveModuleDisplayTitle 提供头部文本。
// Replacement: src/app/shell/module-balancing/module-balancing-model.ts:resolveModuleDisplayTitle
// Risk: Low
// Human Review: Required
//
// Original code:
// import { RecipeDisplay } from "@/app/shell/shared/recipe-display";
// AI-CORRECTION 2026-07-27: 用户澄清设备图标与“产物 · 设备”文本仅规范头部，系统配方卡仍需保留下方的配方展示控件。
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";

const MODULE_DRAG_TYPE = "application/x-industrial-planner-module-balancing-module";
const CUSTOM_MODULE_FOLDER_DRAG_TYPE = "application/x-industrial-planner-module-balancing-custom-module";
const CANVAS_FOLDER_DRAG_TYPE = "application/x-industrial-planner-module-balancing-canvas";
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

// AI-REMOVED 2026-07-27:
// Reason: 模块库由互斥 tab 改为系统配方、推荐模块、自定义模块三个可独立展开的区块。
// Trigger: 用户要求将 tab 切换改为展开/收起形式。
// Evidence: ModuleLibrarySectionId 与 ModuleSection 共同管理三个区块的展开状态。
// Replacement: ModuleLibrarySectionId
// Risk: Low
// Human Review: Required
//
// Original code:
// type ModuleLibraryTab = "recipes" | "modules";
type ModuleLibrarySectionId = "system" | "recommended" | "custom";

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
  folderId: string | null;
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
  const [libraryOpen, setLibraryOpen] = useState(!isTouch);
  const [libraryHighlight, setLibraryHighlight] = useState(false);
  // AI-REMOVED 2026-07-27:
  // Reason: 模块库不再使用互斥 tab，三个板块改为独立展开/收起。
  // Trigger: 用户要求 tab 样式切换改为展开收起形式。
  // Evidence: 展开状态已下沉至 ModuleLibrary 的 expandedSections。
  // Replacement: ModuleLibrary.expandedSections
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const [libraryTab, setLibraryTab] = useState<ModuleLibraryTab>("recipes");
  const [newCanvasDialogOpen, setNewCanvasDialogOpen] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState("");
  const [canvasLibraryDialogOpen, setCanvasLibraryDialogOpen] = useState(false);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [recommendedCanvases, setRecommendedCanvases] = useState<RecommendedCanvasRecord[]>([]);
  const [recommendedCanvasLoadFailed, setRecommendedCanvasLoadFailed] = useState(false);
  const [recommendedModules, setRecommendedModules] = useState<ModuleBalancingRecommendedModule[]>([]);
  const [versionResources, setVersionResources] = useState<VersionResourcePreset[]>([]);
  const [versionResourceDialogOpen, setVersionResourceDialogOpen] = useState(false);
  const [versionResourceLoadFailed, setVersionResourceLoadFailed] = useState(false);
  const [expandedBalanceIds, setExpandedBalanceIds] = useState<Set<string>>(() => new Set());
  const [quantityDraft, setQuantityDraft] = useState<QuantityDraft | null>(null);
  const [customModuleForm, setCustomModuleForm] = useState<CustomModuleFormState | null>(null);
  const libraryLayer = useOverlayStackLayer({
    layerId: "module-balancing:library",
    visible: libraryOpen,
  });

  useEffect(() => {
    let active = true;
    // AI-REMOVED 2026-07-27:
    // Reason: effect 首次执行时状态已默认为 false，同步 setState 会造成一次无意义的级联渲染。
    // Trigger: 推荐画布静态资源加载接入 React effect。
    // Evidence: recommendedCanvasLoadFailed 的 useState 初始值已是 false。
    // Replacement: Promise rejection 分支仅在真实加载失败时写入 true。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // setRecommendedCanvasLoadFailed(false);
    void readRecommendedCanvasLibrary()
      .then((library) => {
        if (active) {
          setRecommendedCanvases([...library.canvases]);
        }
      })
      .catch(() => {
        if (active) {
          setRecommendedCanvasLoadFailed(true);
        }
      });
    void readRecommendedModuleLibrary()
      .then((library) => {
        if (active && library.modules.length > 0) {
          setRecommendedModules([...library.modules]);
        }
      })
      .catch(() => undefined);
    void readVersionResourceLibrary()
      .then((library) => {
        if (active) {
          setVersionResources([...library.resources]);
        }
      })
      .catch(() => {
        if (active) {
          setVersionResourceLoadFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const index = buildModuleBalancingIndex(appHost.workspace.registry, balancingState, {
    includeInactiveActivityContent: showAllActivityContent,
    activeActivityIds,
    recommendedModules,
  });
  const naturalResourcesCustomFilter = useMemo(() => {
    const itemIds = appHost.workspace.registry.itemDefinitions
      .filter((item) => item.tags.includes("自然资源"))
      .map((item) => item.id);
    if (itemIds.length === 0) return [];
    return [{ i18nKey: "pickerCustomFilter.naturalResources", itemIds }];
  }, [appHost.workspace.registry.itemDefinitions]);
  const visibleCanvases = showAllActivityContent
    ? balancingState.canvases
    : balancingState.canvases.filter((canvas) =>
      !canvasContainsInactiveActivityContent(canvas, index, activeActivityIds),
    );
  const visibleRecommendedCanvases = showAllActivityContent
    ? recommendedCanvases
    : recommendedCanvases.filter((canvas) =>
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

    const stageId = createModuleBalancingId();
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

  const deleteStage = (stageId: string) => {
    if (activeCanvas === null) {
      return;
    }

    const nextStageId = runInAction((): string | null | undefined => {
      const stageIndex = activeCanvas.stages.findIndex((stage) => stage.id === stageId);
      const stage = activeCanvas.stages[stageIndex];
      if (stage === undefined || stage.entries.length > 0) {
        return undefined;
      }

      activeCanvas.stages.splice(stageIndex, 1);
      return activeCanvas.stages[Math.max(0, stageIndex - 1)]?.id ?? null;
    });
    if (nextStageId === undefined) {
      return;
    }

    setExpandedBalanceIds((current) => {
      if (!current.has(stageId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(stageId);
      return next;
    });
    setQuantityDraft((current) => current?.stageId === stageId ? null : current);
    setSelectedStageId(nextStageId);
    setActivePage(nextStageId === null
      ? { kind: "canvas" }
      : { kind: "stage", stageId: nextStageId });
  };

  const openNewCustomModuleForm = () => {
    setCustomModuleForm({
      id: null,
      name: "",
      color: CUSTOM_MODULE_COLORS[0],
      iconId: index.allItems[0]?.id ?? index.allEntities[0]?.id ?? "grinder_1",
      notes: "",
      folderId: null,
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
      folderId: customModule.folderId ?? null,
      inputs: customModule.inputs.map(clonePort),
      outputs: customModule.outputs.map(clonePort),
    });
  };

  const openStageAsCustomModuleForm = (stage: ModuleBalancingStageReadWrite) => {
    if (activeCanvas === null) {
      return;
    }

    const stageTotals = computeStageModuleTotals(
      stage,
      index,
      resolveInfiniteSystemInputItemIds(activeCanvas),
    );
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
      iconId: outputs[0]?.itemId ?? inputs[0]?.itemId ?? index.allItems[0]?.id ?? "grinder_1",
      notes: "",
      folderId: null,
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
      id: draft.id ?? createModuleBalancingId(),
      name: normalizedName,
      color: draft.color,
      iconId: draft.iconId,
      notes: draft.notes,
      folderId: draft.folderId,
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

  const applyVersionResource = (preset: VersionResourcePreset) => {
    if (activeCanvas === null) {
      return;
    }

    runInAction(() => {
      activeCanvas.globalInputs = applyVersionResourcePreset(
        activeCanvas.globalInputs,
        preset,
      ).map(clonePort);
    });
    setVersionResourceDialogOpen(false);
  };

  const requestPortSelection = async (target: PendingPortTarget) => {
    const itemId = await appHost.encyclopediaPicker.pickItem({
      customFilters: naturalResourcesCustomFilter,
      includeInactiveActivityItems: showAllActivityContent,
      title: t("encyclopediaPicker.title.item"),
    });

    if (itemId === null) {
      return;
    }

    addPort(target, itemId);
  };

  const createCanvas = () => {
    const normalizedName = newCanvasName.trim();
    const nextCanvas = createDefaultModuleBalancingCanvas();
    nextCanvas.id = createModuleBalancingId();
    nextCanvas.name = normalizedName || `${t("moduleBalancing.canvas")} ${balancingState.canvases.length + 1}`;
    nextCanvas.stages[0] = {
      id: createModuleBalancingId(),
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

  const createFolder = () => {
    const normalizedName = newFolderName.trim();
    const folder: ModuleBalancingFolderReadWrite = {
      id: createModuleBalancingId(),
      name: normalizedName || `${t("moduleBalancing.newFolder")} ${balancingState.folders.length + 1}`,
    };
    runInAction(() => {
      balancingState.folders.push(folder);
    });
    setNewFolderName("");
    setNewFolderDialogOpen(false);
  };

  const selectCanvas = (canvasId: string) => {
    runInAction(() => {
      balancingState.activeCanvasId = canvasId;
    });
    setSelectedStageId(null);
    setActivePage({ kind: "canvas" });
    setCanvasLibraryDialogOpen(false);
  };

  const deleteCanvas = (canvasId: string) => {
    runInAction(() => {
      const indexToDelete = balancingState.canvases.findIndex((canvas) => canvas.id === canvasId);
      if (indexToDelete < 0 || balancingState.canvases.length <= 1) {
        return;
      }

      const deletingActiveCanvas = balancingState.activeCanvasId === canvasId;
      balancingState.canvases.splice(indexToDelete, 1);
      if (deletingActiveCanvas) {
        balancingState.activeCanvasId = balancingState.canvases[
          Math.max(0, indexToDelete - 1)
        ]?.id ?? null;
      }
    });
    setSelectedStageId(null);
    setActivePage({ kind: "canvas" });
  };

  const handleExportCanvas = () => {
    if (activeCanvas === null) {
      return;
    }

    const exportData = buildCanvasExportData(activeCanvas, balancingState.customModules);
    downloadCanvasExportJson(exportData, activeCanvas.name);
  };

  const [importPlan, setImportPlan] = useState<CanvasImportPlan | null>(null);

  const handleImportCanvas = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = JSON.parse(reader.result as string);
      const data = parseCanvasImportData(raw);
      if (data === null) {
        return;
      }

      const plan = buildCanvasImportPlan(data, balancingState.customModules);
      const hasConflicts = plan.moduleActions.some((action) => action.kind === "conflict");
      if (hasConflicts) {
        setImportPlan(plan);
        return;
      }

      // 无冲突，直接导入
      const moduleIdMapping = plan.moduleIdMapping;
      runInAction(() => {
        const newCanvasId = applyCanvasImport(
          data,
          new Map(moduleIdMapping),
          balancingState.customModules,
          balancingState.canvases,
        );
        balancingState.activeCanvasId = newCanvasId;
      });
      setSelectedStageId(null);
      setActivePage({ kind: "canvas" });
    };
    reader.onerror = () => {
      // 文件读取失败，静默忽略
    };
    reader.readAsText(file);
  };

  const confirmImportWithConflicts = () => {
    if (importPlan === null) {
      return;
    }

    const resolvedMapping = new Map(importPlan.moduleIdMapping);
    for (const action of importPlan.moduleActions) {
      if (action.kind === "conflict") {
        resolvedMapping.set(action.importId, action.importId);
        // 覆盖本地模块
        runInAction(() => {
          const localIndex = balancingState.customModules.findIndex(
            (m) => m.id === action.importId,
          );
          if (localIndex >= 0) {
            balancingState.customModules[localIndex] = {
              ...action.importModule,
              folderId: balancingState.customModules[localIndex]!.folderId,
              inputs: action.importModule.inputs.map((p) => ({ ...p })),
              outputs: action.importModule.outputs.map((p) => ({ ...p })),
            };
          }
        });
      }
    }

    runInAction(() => {
      const newCanvasId = applyCanvasImport(
        {
          version: 1,
          canvas: {
            name: importPlan.canvasData.name,
            folderId: importPlan.canvasData.folderId,
            globalInputs: importPlan.canvasData.globalInputs,
            stages: importPlan.canvasData.stages.map((s) => ({
              id: createModuleBalancingId(),
              name: s.name,
              entries: s.entries.map((e) => ({ moduleId: e.moduleId, quantity: e.quantity })),
            })),
            warehouseCapacity: importPlan.canvasData.warehouseCapacity,
          },
          modules: importPlan.moduleActions
            .filter((a): a is { kind: "create"; module: ModuleBalancingCustomModule } => a.kind === "create")
            .map((a) => a.module),
        },
        resolvedMapping,
        balancingState.customModules,
        balancingState.canvases,
      );
      balancingState.activeCanvasId = newCanvasId;
    });
    setSelectedStageId(null);
    setActivePage({ kind: "canvas" });
    setImportPlan(null);
  };

  const cancelImport = () => {
    setImportPlan(null);
  };

  const createCanvasFolder = (): string => {
    const folderId = createModuleBalancingId();
    const folder: ModuleBalancingFolderReadWrite = {
      id: folderId,
      name: `${t("moduleBalancing.newFolder")} ${balancingState.canvasFolders.length + 1}`,
    };
    runInAction(() => {
      balancingState.canvasFolders.push(folder);
    });
    return folderId;
  };

  const renameCanvasFolder = (folderId: string, name: string) => {
    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      return;
    }

    runInAction(() => {
      const folder = balancingState.canvasFolders.find((entry) => entry.id === folderId);
      if (folder !== undefined) {
        folder.name = normalizedName;
      }
    });
  };

  const deleteCanvasFolder = (folderId: string) => {
    runInAction(() => {
      for (const canvas of balancingState.canvases) {
        if (canvas.folderId === folderId) {
          canvas.folderId = null;
        }
      }
      balancingState.canvasFolders = balancingState.canvasFolders.filter((folder) => folder.id !== folderId);
    });
  };

  const moveCanvasToFolder = (canvasId: string, folderId: string | null) => {
    runInAction(() => {
      const canvas = balancingState.canvases.find((entry) => entry.id === canvasId);
      const safeFolderId = folderId !== null
        && balancingState.canvasFolders.some((folder) => folder.id === folderId)
        ? folderId
        : null;
      if (canvas !== undefined) {
        canvas.folderId = safeFolderId;
      }
    });
  };

  const renameCanvas = (canvasId: string, name: string) => {
    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      return;
    }

    runInAction(() => {
      const canvas = balancingState.canvases.find((entry) => entry.id === canvasId);
      if (canvas !== undefined) {
        canvas.name = normalizedName;
      }
    });
  };

  const loadRecommendedCanvas = (recommendedCanvas: RecommendedCanvasRecord) => {
    const nextCanvas: ModuleBalancingCanvasReadWrite = {
      id: createModuleBalancingId(),
      name: recommendedCanvas.name,
      folderId: null,
      globalInputs: recommendedCanvas.globalInputs.map(clonePort),
      stages: recommendedCanvas.stages.map((stage) => ({
        id: createModuleBalancingId(),
        name: stage.name,
        entries: stage.entries.map((entry) => ({ ...entry })),
      })),
      warehouseCapacity: recommendedCanvas.warehouseCapacity,
    };
    runInAction(() => {
      balancingState.canvases.push(nextCanvas);
      balancingState.activeCanvasId = nextCanvas.id;
    });
    setSelectedStageId(nextCanvas.stages[0]?.id ?? null);
    setActivePage({ kind: "canvas" });
    setCanvasLibraryDialogOpen(false);
  };

  const canvasLibraryDialog = canvasLibraryDialogOpen ? (
    <CanvasLibraryDialog
      activeCanvasId={balancingState.activeCanvasId}
      canDeleteCanvas={balancingState.canvases.length > 1}
      canvasFolders={balancingState.canvasFolders}
      canvases={visibleCanvases}
      onClose={() => setCanvasLibraryDialogOpen(false)}
      onCreateFolder={createCanvasFolder}
      onDeleteCanvas={deleteCanvas}
      onDeleteFolder={deleteCanvasFolder}
      onLoadRecommendedCanvas={loadRecommendedCanvas}
      onMoveCanvas={moveCanvasToFolder}
      onRenameCanvas={renameCanvas}
      onRenameFolder={renameCanvasFolder}
      onSelectCanvas={selectCanvas}
      recommendedCanvasLoadFailed={recommendedCanvasLoadFailed}
      recommendedCanvases={visibleRecommendedCanvases}
      t={t}
    />
  ) : null;

  if (activeCanvas === null || computation === null) {
    return (
      <div className={cm(styles, "toolbox-dialog-content module-balancing-panel")}>
        <div className={cm(styles, "module-balancing-filtered-empty")}>
          <h3>{t("toolboxDialog.tab.moduleBalancing")}</h3>
          <p>{t("moduleBalancing.filteredCanvasesEmpty")}</p>
          <div className={cm(styles, "module-balancing-filtered-empty-actions")}>
            <button
              className={cm(styles, "module-balancing-icon-text-button")}
              type="button"
              onClick={() => setCanvasLibraryDialogOpen(true)}
            >
              <LucideDownload aria-hidden="true" />
              <span>{t("moduleBalancing.loadOtherCanvas")}</span>
            </button>
            <button className={cm(styles, "module-balancing-primary-button")} type="button" onClick={createCanvas}>
              <LucidePlus aria-hidden="true" />
              <span>{t("moduleBalancing.newCanvas")}</span>
            </button>
            <button
              className={cm(styles, "module-balancing-icon-text-button")}
              type="button"
              onClick={() => {
                runInAction(() => {
                  appHost.internalState.settings.toolboxShowAllActivityContent = true;
                });
              }}
            >
              <span>{t("settingsField.other-toolbox-show-all-activity-content")}</span>
            </button>
          </div>
        </div>
        {canvasLibraryDialog}
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
  const moveCustomModuleToFolder = (moduleId: string, folderId: string | null) => {
    runInAction(() => {
      const customModule = balancingState.customModules.find((module) => module.id === moduleId);
      if (customModule !== undefined) {
        customModule.folderId = folderId;
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

  const content = (
    <div className={cm(styles, "module-balancing-wizard")}>
      <WizardNavigation
        activeCanvas={activeCanvas}
        activePage={activePage}
        isTouch={isTouch}
        libraryOpen={libraryOpen}
        onAddStage={addStage}
        onToggleLibrary={() => setLibraryOpen((prev) => !prev)}
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
            canDelete={balancingState.canvases.length > 1}
            onCreateCanvas={() => {
              setNewCanvasName("");
              setNewCanvasDialogOpen(true);
            }}
            onDeleteCanvas={() => deleteCanvas(activeCanvas.id)}
            onExportCanvas={handleExportCanvas}
            onImportCanvas={handleImportCanvas}
            onOpenCanvasLibrary={() => setCanvasLibraryDialogOpen(true)}
            t={t}
          />
        ) : null}
        {activePage.kind === "input" ? (
          <CanvasInputPanel
            canvas={activeCanvas}
            index={index}
            onOpenPortPicker={() => { void requestPortSelection({ kind: "global" }); }}
            onOpenVersionResources={() => setVersionResourceDialogOpen(true)}
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
            isTouch={isTouch}
            onAddModule={() => {
              if (libraryOpen) {
                // 已展开 → 触发高亮闪烁引导用户点击模块库
                setLibraryHighlight(true);
                setTimeout(() => setLibraryHighlight(false), 2500);
              } else {
                setLibraryOpen(true);
              }
            }}
            onAddStage={addStage}
            onClearStage={(stage) => runInAction(() => { stage.entries = []; })}
            onDeleteStage={(stage) => deleteStage(stage.id)}
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
            dispatchTicketGroups={computation.dispatchTicketGroups}
            index={index}
            t={t}
            warehouseForecasts={computation.warehouseForecasts}
          />
        ) : null}
      </main>
    </div>
  );

  const libraryPanelContent = (
    <>
      <header className={cm(styles, "module-balancing-drawer-header")}>
        <h3>{t("moduleBalancing.moduleLibrary")}</h3>
        {/* AI-REMOVED 2026-07-27:
            Reason: recipes/modules 互斥 tab 被三个独立展开区块替代。
            Trigger: 用户要求模块库由 tab 切换改为展开收起形式。
            Evidence: ModuleLibrary 内固定渲染三个 ModuleSection。
            Replacement: ModuleLibrary
            Risk: Low
            Human Review: Required

            Original code:
            <div className={cm(styles, "module-balancing-library-tabs")}>
              <button className={cm(styles, libraryTab === "recipes" ? "is-active" : "")} type="button" onClick={() => setLibraryTab("recipes")}>{t("moduleBalancing.recipes")}</button>
              <button className={cm(styles, libraryTab === "modules" ? "is-active" : "")} type="button" onClick={() => setLibraryTab("modules")}>{t("moduleBalancing.modules")}</button>
            </div>
        */}
        <button className={cm(styles, "module-balancing-icon-button")} type="button" onClick={() => setLibraryOpen(false)} aria-label={t("action.close")}>
          <LucideX aria-hidden="true" />
        </button>
      </header>
      <ModuleLibrary
        activeCanvas={activeCanvas}
        activeActivityIds={activeActivityIds}
        highlight={libraryHighlight}
        index={index}
        isTouch={isTouch}
        folders={balancingState.folders}
        onAddModule={addModuleToSelectedStage}
        onCreateCustomModule={openNewCustomModuleForm}
        onCreateFolder={() => {
          setNewFolderName("");
          setNewFolderDialogOpen(true);
        }}
        onDeleteCustomModule={deleteCustomModule}
        onEditCustomModule={openEditCustomModuleForm}
        onMoveCustomModule={moveCustomModuleToFolder}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showActivityIcons={showAllActivityContent}
        t={t}
      />
    </>
  );

  return (
    <div className={cm(styles, `toolbox-dialog-content module-balancing-panel${isTouch ? " is-touch" : ""}`)}>
      {isTouch ? (
        <>
          {content}
          {libraryOpen ? (
            <div className={cm(styles, "module-balancing-drawer-layer")} onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setLibraryOpen(false);
              }
            }} style={{ zIndex: libraryLayer.zIndex }}>
              <aside className={cm(styles, "module-balancing-drawer")}>
                {libraryPanelContent}
              </aside>
            </div>
          ) : null}
        </>
      ) : (
        <div className={cm(styles, `module-balancing-desktop-layout${libraryOpen ? " has-library" : ""}`)}>
          {libraryOpen ? (
            <aside className={cm(styles, "module-balancing-library-panel")}>
              {libraryPanelContent}
            </aside>
          ) : null}
          {content}
        </div>
      )}
      {newCanvasDialogOpen ? (
        <OverlayStackLayer layerId="module-balancing:new-canvas" visible>
          {({ zIndex }) => (
            <div className={cm(styles, "module-balancing-editor-backdrop")} onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setNewCanvasDialogOpen(false);
              }
            }} style={{ zIndex }}>
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
          )}
        </OverlayStackLayer>
      ) : null}
      {canvasLibraryDialog}
      {importPlan !== null ? (() => {
        const conflictActions = importPlan.moduleActions.filter(
          (a): a is { kind: "conflict"; importId: string; importName: string; localName: string; importModule: ModuleBalancingCustomModule } => a.kind === "conflict",
        );
        const firstConflict = conflictActions[0];
        return (
          <OverlayStackLayer layerId="module-balancing:import-conflict" visible>
            {({ zIndex }) => (
              <div className={cm(styles, "module-balancing-editor-backdrop")} onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  cancelImport();
                }
              }} style={{ zIndex }}>
                <section className={cm(styles, "module-balancing-quantity-editor")} role="dialog" aria-modal="true">
                  <header className={cm(styles, "module-balancing-form-header")}>
                    <h3>{t("moduleBalancing.importCanvasConflict")}</h3>
                    <button className={cm(styles, "module-balancing-icon-button")} type="button" onClick={cancelImport} aria-label={t("action.close")}>
                      <LucideX aria-hidden="true" />
                    </button>
                  </header>
                  {conflictActions.length === 1 && firstConflict !== undefined ? (
                    <p style={{ margin: "12px 0" }}>
                      {t("moduleBalancing.importCanvasConflictMessage").replace("{importName}", firstConflict.importName)}
                    </p>
                  ) : (
                    <div style={{ margin: "12px 0" }}>
                      <p>{t("moduleBalancing.importCanvasConflict")}：</p>
                      <ul>
                        {conflictActions.map((action) => (
                          <li key={action.importId}>
                            {t("moduleBalancing.importCanvasConflictMessage").replace("{importName}", action.importName)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <footer className={cm(styles, "module-balancing-form-actions")}>
                    <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={cancelImport}>
                      {t("action.cancel")}
                    </button>
                    <button className={cm(styles, "module-balancing-primary-button")} type="button" onClick={confirmImportWithConflicts}>
                      {t("action.confirm")}
                    </button>
                  </footer>
                </section>
              </div>
            )}
          </OverlayStackLayer>
        );
      })() : null}
      {newFolderDialogOpen ? (
        <OverlayStackLayer layerId="module-balancing:new-folder" visible>
          {({ zIndex }) => (
            <div className={cm(styles, "module-balancing-editor-backdrop")} onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setNewFolderDialogOpen(false);
              }
            }} style={{ zIndex }}>
              <section className={cm(styles, "module-balancing-quantity-editor")} role="dialog" aria-modal="true">
                <header className={cm(styles, "module-balancing-form-header")}>
                  <h3>{t("moduleBalancing.newFolder")}</h3>
                  <button className={cm(styles, "module-balancing-icon-button")} type="button" onClick={() => setNewFolderDialogOpen(false)} aria-label={t("action.close")}>
                    <LucideX aria-hidden="true" />
                  </button>
                </header>
                <label className={cm(styles, "module-balancing-form-field")}>
                  <span>{t("moduleBalancing.folderName")}</span>
                  <input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.currentTarget.value)} onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      createFolder();
                    }
                  }} />
                </label>
                <footer className={cm(styles, "module-balancing-form-actions")}>
                  <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={() => setNewFolderDialogOpen(false)}>{t("action.close")}</button>
                  <button className={cm(styles, "module-balancing-primary-button")} type="button" onClick={createFolder}>
                    <LucideFolderPlus aria-hidden="true" />
                    <span>{t("moduleBalancing.newFolder")}</span>
                  </button>
                </footer>
              </section>
            </div>
          )}
        </OverlayStackLayer>
      ) : null}
      {customModuleForm !== null ? (
        <OverlayStackLayer layerId={`module-balancing:custom-module:${customModuleForm.id}`} visible>
          {({ zIndex }) => (
            <div className={cm(styles, "module-balancing-editor-backdrop")} onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeCustomModuleForm();
              }
            }} style={{ zIndex }}>
          <CustomModuleForm
            draft={customModuleForm}
            folders={balancingState.folders}
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
          )}
        </OverlayStackLayer>
      ) : null}
      {versionResourceDialogOpen ? (
        <VersionResourceDialog
          index={index}
          loadFailed={versionResourceLoadFailed}
          onCancel={() => setVersionResourceDialogOpen(false)}
          onSelect={applyVersionResource}
          presets={versionResources}
          t={t}
        />
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
  folders,
  highlight,
  index,
  isTouch,
  onAddModule,
  onCreateCustomModule,
  onCreateFolder,
  onDeleteCustomModule,
  onEditCustomModule,
  onMoveCustomModule,
  searchQuery,
  setSearchQuery,
  showActivityIcons,
  t,
}: {
  activeCanvas: ModuleBalancingCanvasReadWrite;
  activeActivityIds: readonly string[];
  folders: readonly ModuleBalancingFolderReadWrite[];
  highlight: boolean;
  index: ModuleBalancingIndex;
  isTouch: boolean;
  onAddModule: (moduleId: string) => void;
  onCreateCustomModule: () => void;
  onCreateFolder: () => void;
  onDeleteCustomModule: (moduleId: string) => void;
  onEditCustomModule: (module: ModuleBalancingCustomModule) => void;
  onMoveCustomModule: (moduleId: string, folderId: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  showActivityIcons: boolean;
  t: (key: string) => string;
}) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const [expandedSections, setExpandedSections] = useState<Record<ModuleLibrarySectionId, boolean>>({
    system: true,
    recommended: true,
    custom: true,
  });
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const activeDragModuleIdRef = useRef<string | null>(null);
  const systemModules = index.systemModules.filter((module) => matchesModuleQuery(module, normalizedQuery, index, t));
  const recommendedModules = Array.from(index.recommendedModuleById.values())
    .filter((module) =>
      showActivityIcons
      || !moduleContainsInactiveActivityContent(module, index, activeActivityIds),
    )
    .filter((module) => matchesModuleQuery(module, normalizedQuery, index, t));
  const customModules = Array.from(index.customModuleById.values())
    .filter((module) =>
      showActivityIcons
      || !moduleContainsInactiveActivityContent(module, index, activeActivityIds),
    )
    .filter((module) => matchesModuleQuery(module, normalizedQuery, index, t));
  const folderIdSet = new Set(folders.map((folder) => folder.id));
  const rootModules = customModules.filter((module) =>
    module.folderId === null
    || module.folderId === undefined
    || !folderIdSet.has(module.folderId),
  );

  // AI-REMOVED 2026-07-27:
  // Reason: 同步 effect 内直接 setState 会产生级联渲染并违反 react-hooks/set-state-in-effect。
  // Trigger: ESLint 在模块库搜索自动展开逻辑中发现同步状态更新。
  // Evidence: 搜索输入事件本身已是展开板块的直接触发源，可在同一事件中完成状态更新。
  // Replacement: 下方搜索框 onChange
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // useEffect(() => {
  //   if (!isSearching) {
  //     return;
  //   }
  //
  //   setExpandedSections({
  //     system: true,
  //     recommended: true,
  //     custom: true,
  //   });
  // }, [isSearching]);

  const toggleSection = (sectionId: ModuleLibrarySectionId) => {
    setExpandedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };
  const handleFolderDrop = (event: DragEvent<HTMLElement>, folderId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const transferredModuleId = event.dataTransfer.getData(CUSTOM_MODULE_FOLDER_DRAG_TYPE);
    const moduleId = transferredModuleId || activeDragModuleIdRef.current;
    if (moduleId === null || moduleId.length === 0) {
      return;
    }

    onMoveCustomModule(moduleId, folderId);
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
    activeDragModuleIdRef.current = null;
    setDropTargetFolderId(null);
  };
  const handleCustomModuleDragStart = (moduleId: string) => {
    activeDragModuleIdRef.current = moduleId;
  };
  const handleCustomModuleDragEnd = () => {
    activeDragModuleIdRef.current = null;
    setDropTargetFolderId(null);
  };

  return (
    <div className={cm(styles, `module-balancing-library${highlight ? " is-highlight" : ""}`)}>
      <div className={cm(styles, "module-balancing-search")}>
        <LucideSearch aria-hidden="true" />
        <input
          placeholder={t("moduleBalancing.searchModules")}
          value={searchQuery}
          onChange={(event) => {
            const nextQuery = event.currentTarget.value;
            if (nextQuery.trim().length > 0) {
              setExpandedSections({
                system: true,
                recommended: true,
                custom: true,
              });
            }
            setSearchQuery(nextQuery);
          }}
        />
      </div>
      <ModuleSection
        count={systemModules.length}
        expanded={expandedSections.system}
        onToggle={() => toggleSection("system")}
        t={t}
        title={t("moduleBalancing.systemModules")}
      >
        <ModuleList
          index={index}
          isTouch={isTouch}
          modules={systemModules}
          onAddModule={onAddModule}
          showActivityIcons={showActivityIcons}
          t={t}
        />
      </ModuleSection>
      <ModuleSection
        count={recommendedModules.length}
        expanded={expandedSections.recommended}
        onToggle={() => toggleSection("recommended")}
        t={t}
        title={t("moduleBalancing.recommendedModules")}
      >
        <ModuleList
          index={index}
          isTouch={isTouch}
          modules={recommendedModules}
          onAddModule={onAddModule}
          showActivityIcons={showActivityIcons}
          t={t}
        />
      </ModuleSection>
      <ModuleSection
        count={customModules.length}
        expanded={expandedSections.custom}
        onToggle={() => toggleSection("custom")}
        t={t}
        title={t("moduleBalancing.customModules")}
      >
        {isSearching ? (
          <ModuleList
            index={index}
            isTouch={isTouch}
            modules={customModules}
            onAddModule={onAddModule}
            onCustomModuleDragEnd={handleCustomModuleDragEnd}
            onCustomModuleDragStart={handleCustomModuleDragStart}
            onDeleteCustomModule={onDeleteCustomModule}
            onEditCustomModule={onEditCustomModule}
            showActivityIcons={showActivityIcons}
            t={t}
          />
        ) : (
          <>
            <ModuleList
              index={index}
              isTouch={isTouch}
              modules={rootModules}
              onAddModule={onAddModule}
              onCustomModuleDragEnd={handleCustomModuleDragEnd}
              onCustomModuleDragStart={handleCustomModuleDragStart}
              onDeleteCustomModule={onDeleteCustomModule}
              onEditCustomModule={onEditCustomModule}
              showActivityIcons={showActivityIcons}
              t={t}
            />
            {folders.map((folder) => {
              const folderModules = customModules.filter((module) => module.folderId === folder.id);
              const expanded = !collapsedFolderIds.has(folder.id);
              return (
                <section className={cm(styles, "module-balancing-folder")} key={folder.id}>
                  <header
                    className={cm(
                      styles,
                      "module-balancing-folder-header",
                      dropTargetFolderId === folder.id && "is-drop-target",
                    )}
                    onDragEnter={(event) => {
                      if (
                        event.dataTransfer.types.includes(CUSTOM_MODULE_FOLDER_DRAG_TYPE)
                        || activeDragModuleIdRef.current !== null
                      ) {
                        setDropTargetFolderId(folder.id);
                      }
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDropTargetFolderId((current) => current === folder.id ? null : current);
                      }
                    }}
                    onDragOver={(event) => {
                      if (
                        event.dataTransfer.types.includes(CUSTOM_MODULE_FOLDER_DRAG_TYPE)
                        || activeDragModuleIdRef.current !== null
                      ) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropTargetFolderId(folder.id);
                      }
                    }}
                    onDrop={(event) => handleFolderDrop(event, folder.id)}
                  >
                    <span className={cm(styles, "module-balancing-folder-name")}>
                      <LucideFolder aria-hidden="true" />
                      <span>{folder.name}</span>
                      <small>({folderModules.length})</small>
                    </span>
                    <button
                      aria-expanded={expanded}
                      className={cm(styles, "module-balancing-section-toggle")}
                      type="button"
                      onClick={() => setCollapsedFolderIds(toggleSetValue(collapsedFolderIds, folder.id))}
                    >
                      {expanded ? <LucideChevronDown aria-hidden="true" /> : <LucideChevronRight aria-hidden="true" />}
                      <span>{expanded ? t("moduleBalancing.collapseSection") : t("moduleBalancing.expandSection")}</span>
                    </button>
                  </header>
                  {expanded ? (
                    <ModuleList
                      index={index}
                      isTouch={isTouch}
                      modules={folderModules}
                      onAddModule={onAddModule}
                      onCustomModuleDragEnd={handleCustomModuleDragEnd}
                      onCustomModuleDragStart={handleCustomModuleDragStart}
                      onDeleteCustomModule={onDeleteCustomModule}
                      onEditCustomModule={onEditCustomModule}
                      showActivityIcons={showActivityIcons}
                      t={t}
                    />
                  ) : null}
                </section>
              );
            })}
          </>
        )}
        <div className={cm(styles, "module-balancing-library-create-actions")}>
          <button className={cm(styles, "module-balancing-new-module-button")} type="button" onClick={onCreateCustomModule}>
            <LucidePlus aria-hidden="true" />
            <span>{t("moduleBalancing.newModule")}</span>
          </button>
          <button className={cm(styles, "module-balancing-new-module-button")} type="button" onClick={onCreateFolder}>
            <LucideFolderPlus aria-hidden="true" />
            <span>{t("moduleBalancing.newFolder")}</span>
          </button>
        </div>
      </ModuleSection>
      {activeCanvas.stages.length === 0 ? (
        <p className={cm(styles, "module-balancing-muted")}>{t("moduleBalancing.noStages")}</p>
      ) : null}
    </div>
  );
}

function ModuleSection({
  children,
  count,
  expanded,
  onToggle,
  t,
  title,
}: {
  children: ReactNode;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  t: (key: string) => string;
  title: string;
}) {
  return (
    <section className={cm(styles, "module-balancing-library-section")}>
      <header className={cm(styles, "module-balancing-library-section-header")}>
        <h3>{title} <span>({count})</span></h3>
        <button
          aria-expanded={expanded}
          className={cm(styles, "module-balancing-section-toggle")}
          type="button"
          onClick={onToggle}
        >
          {expanded ? <LucideChevronDown aria-hidden="true" /> : <LucideChevronRight aria-hidden="true" />}
          <span>{expanded ? t("moduleBalancing.collapseSection") : t("moduleBalancing.expandSection")}</span>
        </button>
      </header>
      {expanded ? children : null}
    </section>
  );
}

function ModuleList({
  index,
  isTouch,
  modules,
  onAddModule,
  onCustomModuleDragEnd,
  onCustomModuleDragStart,
  onDeleteCustomModule,
  onEditCustomModule,
  showActivityIcons,
  t,
}: {
  index: ModuleBalancingIndex;
  isTouch: boolean;
  modules: readonly ModuleBalancingModule[];
  onAddModule: (moduleId: string) => void;
  onCustomModuleDragEnd?: () => void;
  onCustomModuleDragStart?: (moduleId: string) => void;
  onDeleteCustomModule?: (moduleId: string) => void;
  onEditCustomModule?: (module: ModuleBalancingCustomModule) => void;
  showActivityIcons: boolean;
  t: (key: string) => string;
}) {
  if (modules.length === 0) {
    return null;
  }

  return (
    <div className={cm(styles, "module-balancing-module-list")}>
      {modules.map((module) => (
        <ModuleCard
          index={index}
          isTouch={isTouch}
          key={module.id}
          module={module}
          onAdd={() => onAddModule(module.id)}
          onCustomModuleDragEnd={onCustomModuleDragEnd}
          onCustomModuleDragStart={onCustomModuleDragStart}
          onDeleteCustomModule={onDeleteCustomModule}
          onEditCustomModule={onEditCustomModule}
          showActivityIcons={showActivityIcons}
          t={t}
        />
      ))}
    </div>
  );
}

function ModuleCard({
  index,
  isTouch,
  module,
  onAdd,
  onCustomModuleDragEnd,
  onCustomModuleDragStart,
  onDeleteCustomModule,
  onEditCustomModule,
  showActivityIcons,
  t,
}: {
  index: ModuleBalancingIndex;
  isTouch: boolean;
  module: ModuleBalancingModule;
  onAdd: () => void;
  onCustomModuleDragEnd?: () => void;
  onCustomModuleDragStart?: (moduleId: string) => void;
  onDeleteCustomModule?: (moduleId: string) => void;
  onEditCustomModule?: (module: ModuleBalancingCustomModule) => void;
  showActivityIcons: boolean;
  t: (key: string) => string;
}) {
  const outputs = resolveModuleOutputs(module, index);
  const title = resolveModuleTitle(module, index, t);
  const activityIds = showActivityIcons ? resolveModuleActivityIds(module, index) : [];
  const subtitle = module.sourceType !== "system-recipe"
    ? formatPortList(outputs, index, t)
    : undefined;
  const hasModuleActions = module.sourceType === "custom";
  const moduleColor = module.sourceType !== "system-recipe" ? module.color : undefined;

  return (
    <div
      className={cm(styles, "module-balancing-module-card", hasModuleActions && "has-module-actions")}
      draggable={module.sourceType === "custom" || !isTouch}
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
        event.stopPropagation();
        event.dataTransfer.setData(MODULE_DRAG_TYPE, module.id);
        if (module.sourceType === "custom") {
          event.dataTransfer.setData(CUSTOM_MODULE_FOLDER_DRAG_TYPE, module.id);
          event.dataTransfer.effectAllowed = "copyMove";
          onCustomModuleDragStart?.(module.id);
        } else {
          event.dataTransfer.effectAllowed = "copy";
        }
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        if (module.sourceType === "custom") {
          onCustomModuleDragEnd?.();
        }
      }}
    >
      <img alt="" className={cm(styles, "module-balancing-module-icon")} src={resolveModuleIconSrc(module, index)} />
      <span className={cm(styles, "module-balancing-module-card-copy")}>
        <span className={cm(styles, "module-balancing-module-title-row")}>
          <span className={cm(styles, "module-balancing-module-title")}>{title}</span>
          <ActivityIconStrip activityIds={activityIds} />
        </span>
        {/* AI-REMOVED 2026-07-27:
            Reason: 系统配方卡头部改为设备图标与产物/设备文本，完整配方公式会与新头部重复。
            Trigger: 用户要求系统配方模块外观改版。
            Evidence: resolveModuleDisplayTitle 生成“产物 · 设备”文本，resolveModuleIconSrc 返回设备图标。
            Replacement: 当前 ModuleCard 标题行
            Risk: Low
            Human Review: Required

            Original code:
            {isSystemRecipe ? (
              <RecipeDisplay recipeId={(module as ModuleBalancingSystemRecipeModule).recipeId} index={index} isTouch={isTouch} t={t} variant="moduleLibrary" />
            ) : null}
        */}
        {/* AI-CORRECTION 2026-07-27: 用户澄清新外观只约束头部，原有 RecipeDisplay 需要继续显示在头部下方。 */}
        {module.sourceType === "system-recipe" ? (
          <RecipeDisplay recipeId={module.recipeId} index={index} isTouch={isTouch} t={t} variant="moduleLibrary" />
        ) : null}
        {subtitle !== undefined ? (
          <span className={cm(styles, "module-balancing-module-subtitle")}>{subtitle}</span>
        ) : null}
      </span>
      {outputs[0] !== undefined ? (
        <span className={cm(styles, "module-balancing-module-rate")}>{formatFlow(outputs[0].perMinute)}/min</span>
      ) : null}
      {hasModuleActions ? (
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
  onOpenVersionResources,
  onRequestPickItem,
  t,
}: {
  canvas: ModuleBalancingCanvasReadWrite;
  index: ModuleBalancingIndex;
  onOpenPortPicker: () => void;
  onOpenVersionResources: () => void;
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
        <div className={cm(styles, "module-balancing-input-actions")}>
          <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onOpenVersionResources}>
            <LucidePackagePlus aria-hidden="true" />
            <span>{t("moduleBalancing.addVersionResources")}</span>
          </button>
          <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onOpenPortPicker}>
            <LucidePlus aria-hidden="true" />
            <span>{t("moduleBalancing.addInput")}</span>
          </button>
        </div>
      </header>
      <PortListEditor
        allowInfinite
        index={index}
        onChange={(ports) => runInAction(() => { canvas.globalInputs = ports; })}
        onRequestPickItem={onRequestPickItem}
        ports={canvas.globalInputs}
        t={t}
      />
    </section>
  );
}

function VersionResourceDialog({
  index,
  loadFailed,
  onCancel,
  onSelect,
  presets,
  t,
}: {
  index: ModuleBalancingIndex;
  loadFailed: boolean;
  onCancel: () => void;
  onSelect: (preset: VersionResourcePreset) => void;
  presets: readonly VersionResourcePreset[];
  t: (key: string) => string;
}) {
  return (
    <OverlayStackLayer layerId="module-balancing:version-resources" visible>
      {({ zIndex }) => (
        <div
          className={cm(styles, "module-balancing-editor-backdrop")}
          style={{ zIndex }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onCancel();
            }
          }}
        >
          <section
            aria-modal="true"
            className={cm(styles, "module-balancing-version-resource-dialog")}
            data-module-balancing-version-resources
            role="dialog"
          >
            <header className={cm(styles, "module-balancing-form-header")}>
              <h3>{t("moduleBalancing.versionResources")}</h3>
              <button
                aria-label={t("action.close")}
                className={cm(styles, "module-balancing-icon-button")}
                type="button"
                onClick={onCancel}
              >
                <LucideX aria-hidden="true" />
              </button>
            </header>
            {loadFailed ? (
              <p className={cm(styles, "module-balancing-muted")}>
                {t("moduleBalancing.versionResourceLoadFailed")}
              </p>
            ) : presets.length === 0 ? (
              <p className={cm(styles, "module-balancing-muted")}>
                {t("moduleBalancing.versionResourceEmpty")}
              </p>
            ) : (
              <div className={cm(styles, "module-balancing-version-resource-list")}>
                {presets.map((preset) => (
                  <button
                    className={cm(styles, "module-balancing-version-resource-option")}
                    key={preset.id}
                    type="button"
                    onClick={() => onSelect(preset)}
                  >
                    <LucidePackagePlus aria-hidden="true" />
                    <span>
                      <strong>{preset.name}</strong>
                      <small>
                        {preset.inputs.map((input) => (
                          input.infinite === true
                            ? `${resolveItemName(input.itemId, index, t)} ∞`
                            : `${resolveItemName(input.itemId, index, t)} ${formatFlow(input.perMinute)}/min`
                        )).join(" · ")}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </OverlayStackLayer>
  );
}

const WizardNavigation = observer(function WizardNavigation({
  activeCanvas,
  activePage,
  isTouch,
  libraryOpen,
  onAddStage,
  onToggleLibrary,
  onSelectPage,
  t,
}: {
  activeCanvas: ModuleBalancingCanvasReadWrite;
  activePage: ModuleBalancingPage;
  isTouch: boolean;
  libraryOpen: boolean;
  onAddStage: () => void;
  onToggleLibrary: () => void;
  onSelectPage: (page: ModuleBalancingPage) => void;
  t: (key: string) => string;
}) {
  return (
    <nav className={cm(styles, "module-balancing-wizard-nav")} aria-label={t("toolboxDialog.tab.moduleBalancing")}>
      <button className={cm(styles, `module-balancing-library-button${!isTouch && libraryOpen ? " is-pressed" : ""}`)} type="button" onClick={onToggleLibrary}>
        <LucideLayers3 aria-hidden="true" />
        <span>{t("moduleBalancing.moduleLibrary")}</span>
      </button>
      <div className={cm(styles, "module-balancing-wizard-tabs")}>
        <div className={cm(styles, "module-balancing-wizard-step-track")}>
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
        </div>
        <button
          aria-label={t("moduleBalancing.newStage")}
          className={cm(styles, "module-balancing-wizard-add")}
          title={t("moduleBalancing.newStage")}
          type="button"
          onClick={onAddStage}
        >
          <LucidePlus aria-hidden="true" />
          <span>{t("moduleBalancing.newStage")}</span>
        </button>
      </div>
    </nav>
  );
});

const CanvasSettingsPanel = observer(function CanvasSettingsPanel({
  activeCanvas,
  activityIds,
  canDelete,
  onCreateCanvas,
  onDeleteCanvas,
  onExportCanvas,
  onImportCanvas,
  onOpenCanvasLibrary,
  t,
}: {
  activeCanvas: ModuleBalancingCanvasReadWrite;
  activityIds: readonly string[];
  canDelete: boolean;
  onCreateCanvas: () => void;
  onDeleteCanvas: () => void;
  onExportCanvas: () => void;
  onImportCanvas: (file: File) => void;
  onOpenCanvasLibrary: () => void;
  t: (key: string) => string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // AI-REMOVED 2026-07-27:
  // Reason: 画布切换由原生下拉框升级为支持文件夹管理的独立选择对话框。
  // Trigger: 用户要求移除画布下拉框，并在“加载其他画布”对话框中切换与管理画布。
  // Evidence: CanvasLibraryDialog 统一承载用户画布、推荐画布与文件夹操作。
  // Replacement: onOpenCanvasLibrary
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // onSelectCanvas: (canvasId: string) => void;
  // visibleCanvases: readonly ModuleBalancingCanvasReadWrite[];
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
        {/* AI-REMOVED 2026-07-27:
            Reason: 原生 select 无法表达用户/推荐根目录、折叠文件夹和管理操作。
            Trigger: 用户要求画布下拉框改为对话框选择画布。
            Evidence: CanvasLibraryDialog 已提供完整的树形选择与管理界面。
            Replacement: 页脚“加载其他画布”按钮与 CanvasLibraryDialog
            Risk: Low
            Human Review: Required

            Original code:
            <label className={cm(styles, "module-balancing-form-field")}>
              <span>{t("moduleBalancing.canvas")}</span>
              <select value={activeCanvas.id} onChange={(event) => onSelectCanvas(event.currentTarget.value)}>
                {visibleCanvases.map((canvas) => (
                  <option key={canvas.id} value={canvas.id}>{canvas.name}</option>
                ))}
              </select>
            </label>
        */}
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
        <input
          ref={fileInputRef}
          accept=".json"
          hidden
          type="file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file !== undefined) {
              onImportCanvas(file);
            }
            // 重置以允许重复选择同一文件
            event.currentTarget.value = "";
          }}
        />
        <button
          className={cm(styles, "module-balancing-icon-text-button")}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <LucideFolderInput aria-hidden="true" />
          <span>{t("moduleBalancing.importCanvas")}</span>
        </button>
        <button className={cm(styles, "module-balancing-danger-button")} disabled={!canDelete} type="button" onClick={onDeleteCanvas}>
          <LucideTrash2 aria-hidden="true" />
          <span>{t("moduleBalancing.deleteCanvas")}</span>
        </button>
        <button className={cm(styles, "module-balancing-primary-button")} type="button" onClick={onCreateCanvas}>
          <LucidePlus aria-hidden="true" />
          <span>{t("moduleBalancing.newCanvas")}</span>
        </button>
        <button
          className={cm(styles, "module-balancing-icon-text-button")}
          type="button"
          onClick={onExportCanvas}
        >
          <LucideUpload aria-hidden="true" />
          <span>{t("moduleBalancing.exportCanvas")}</span>
        </button>
        <button
          className={cm(styles, "module-balancing-icon-text-button module-balancing-load-canvas-button")}
          type="button"
          onClick={onOpenCanvasLibrary}
        >
          <LucideDownload aria-hidden="true" />
          <span>{t("moduleBalancing.loadOtherCanvas")}</span>
        </button>
      </footer>
    </section>
  );
});

function CanvasLibraryDialog({
  activeCanvasId,
  canDeleteCanvas,
  canvasFolders,
  canvases,
  onClose,
  onCreateFolder,
  onDeleteCanvas,
  onDeleteFolder,
  onLoadRecommendedCanvas,
  onMoveCanvas,
  onRenameCanvas,
  onRenameFolder,
  onSelectCanvas,
  recommendedCanvasLoadFailed,
  recommendedCanvases,
  t,
}: {
  activeCanvasId: string | null;
  canDeleteCanvas: boolean;
  canvasFolders: readonly ModuleBalancingFolderReadWrite[];
  canvases: readonly ModuleBalancingCanvasReadWrite[];
  onClose: () => void;
  onCreateFolder: () => string;
  onDeleteCanvas: (canvasId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onLoadRecommendedCanvas: (canvas: RecommendedCanvasRecord) => void;
  onMoveCanvas: (canvasId: string, folderId: string | null) => void;
  onRenameCanvas: (canvasId: string, name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onSelectCanvas: (canvasId: string) => void;
  recommendedCanvasLoadFailed: boolean;
  recommendedCanvases: readonly RecommendedCanvasRecord[];
  t: (key: string) => string;
}) {
  const [collapsedRootIds, setCollapsedRootIds] = useState<Set<string>>(() => new Set());
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [canvasNameDraft, setCanvasNameDraft] = useState("");
  const [movingCanvasId, setMovingCanvasId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const activeDragCanvasIdRef = useRef<string | null>(null);
  const folderIdSet = new Set(canvasFolders.map((folder) => folder.id));
  const rootCanvases = canvases.filter((canvas) =>
    canvas.folderId === null
    || canvas.folderId === undefined
    || !folderIdSet.has(canvas.folderId),
  );
  const userExpanded = !collapsedRootIds.has("user");
  const recommendedExpanded = !collapsedRootIds.has("recommended");

  const commitFolderRename = (folderId: string) => {
    onRenameFolder(folderId, folderNameDraft);
    setEditingFolderId(null);
  };
  const commitCanvasRename = (canvasId: string) => {
    onRenameCanvas(canvasId, canvasNameDraft);
    setEditingCanvasId(null);
  };
  const moveDraggedCanvas = (event: DragEvent<HTMLElement>, folderId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    const transferredCanvasId = event.dataTransfer.getData(CANVAS_FOLDER_DRAG_TYPE);
    const canvasId = transferredCanvasId || activeDragCanvasIdRef.current;
    if (canvasId === null || canvasId.length === 0) {
      return;
    }

    onMoveCanvas(canvasId, folderId);
    if (folderId !== null) {
      setCollapsedFolderIds((current) => {
        const next = new Set(current);
        next.delete(folderId);
        return next;
      });
    }
    activeDragCanvasIdRef.current = null;
    setDropTargetFolderId(null);
  };
  const isCanvasDrag = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.types.includes(CANVAS_FOLDER_DRAG_TYPE)
    || activeDragCanvasIdRef.current !== null;

  const renderUserCanvas = (canvas: ModuleBalancingCanvasReadWrite) => {
    const isActive = canvas.id === activeCanvasId;
    const isEditing = editingCanvasId === canvas.id;
    const isMoving = movingCanvasId === canvas.id;
    return (
      <div
        className={cm(styles, `module-balancing-canvas-library-row${isActive ? " is-active" : ""}`)}
        draggable={!isEditing && !isMoving}
        key={canvas.id}
        onDragEnd={() => {
          activeDragCanvasIdRef.current = null;
          setDropTargetFolderId(null);
        }}
        onDragStart={(event) => {
          activeDragCanvasIdRef.current = canvas.id;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(CANVAS_FOLDER_DRAG_TYPE, canvas.id);
        }}
      >
        {isEditing ? (
          <div className={cm(styles, "module-balancing-canvas-library-row-main is-editing")}>
            {isActive ? <LucideCheck aria-hidden="true" /> : <LucideLayers3 aria-hidden="true" />}
            <input
              autoFocus
              aria-label={t("moduleBalancing.canvasPlaceholder")}
              value={canvasNameDraft}
              onBlur={() => commitCanvasRename(canvas.id)}
              onChange={(event) => setCanvasNameDraft(event.currentTarget.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  setEditingCanvasId(null);
                }
              }}
            />
          </div>
        ) : (
          <button
            className={cm(styles, "module-balancing-canvas-library-row-main")}
            disabled={isMoving}
            type="button"
            onClick={() => onSelectCanvas(canvas.id)}
          >
            {isActive ? <LucideCheck aria-hidden="true" /> : <LucideLayers3 aria-hidden="true" />}
            <span>{canvas.name}</span>
          </button>
        )}
        <div className={cm(styles, "module-balancing-canvas-library-row-actions")}>
          {isMoving ? (
            <select
              autoFocus
              aria-label={t("moduleBalancing.moveCanvas")}
              value={canvas.folderId ?? ""}
              onBlur={() => setMovingCanvasId(null)}
              onChange={(event) => {
                onMoveCanvas(canvas.id, event.currentTarget.value || null);
                setMovingCanvasId(null);
              }}
            >
              <option value="">{t("moduleBalancing.userCanvases")}</option>
              {canvasFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          ) : null}
          <button
            aria-label={t("moduleBalancing.renameCanvas")}
            className={cm(styles, "module-balancing-mini-icon-button")}
            type="button"
            onClick={() => {
              setEditingCanvasId(canvas.id);
              setCanvasNameDraft(canvas.name);
              setMovingCanvasId(null);
            }}
          >
            <LucideEdit3 aria-hidden="true" />
          </button>
          <button
            aria-label={t("moduleBalancing.moveCanvas")}
            className={cm(styles, "module-balancing-mini-icon-button")}
            type="button"
            onClick={() => {
              setMovingCanvasId(canvas.id);
              setEditingCanvasId(null);
            }}
          >
            <LucideFolderInput aria-hidden="true" />
          </button>
          <button
            aria-label={t("moduleBalancing.deleteCanvas")}
            className={cm(styles, "module-balancing-mini-icon-button is-danger")}
            disabled={!canDeleteCanvas}
            type="button"
            onClick={() => onDeleteCanvas(canvas.id)}
          >
            <LucideTrash2 aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <OverlayStackLayer layerId="module-balancing:canvas-library" visible>
      {({ zIndex }) => (
        <div
          className={cm(styles, "module-balancing-editor-backdrop")}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
          style={{ zIndex }}
        >
          <section
            aria-modal="true"
            className={cm(styles, "module-balancing-canvas-library-dialog")}
            data-module-balancing-canvas-library=""
            role="dialog"
          >
            <header className={cm(styles, "module-balancing-form-header")}>
              <h3>{t("moduleBalancing.canvasLibrary")}</h3>
              <button
                aria-label={t("action.close")}
                className={cm(styles, "module-balancing-icon-button")}
                type="button"
                onClick={onClose}
              >
                <LucideX aria-hidden="true" />
              </button>
            </header>
            <div className={cm(styles, "module-balancing-canvas-library-tree")}>
              <section className={cm(styles, "module-balancing-canvas-library-root")}>
                <header
                  className={cm(
                    styles,
                    "module-balancing-canvas-library-root-header",
                    dropTargetFolderId === "user-root" && "is-drop-target",
                  )}
                  onDragEnter={(event) => {
                    if (isCanvasDrag(event)) {
                      setDropTargetFolderId("user-root");
                    }
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDropTargetFolderId((current) => current === "user-root" ? null : current);
                    }
                  }}
                  onDragOver={(event) => {
                    if (isCanvasDrag(event)) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTargetFolderId("user-root");
                    }
                  }}
                  onDrop={(event) => moveDraggedCanvas(event, null)}
                >
                  <button
                    aria-expanded={userExpanded}
                    className={cm(styles, "module-balancing-canvas-library-root-toggle")}
                    type="button"
                    onClick={() => setCollapsedRootIds(toggleSetValue(collapsedRootIds, "user"))}
                  >
                    {userExpanded ? <LucideChevronDown aria-hidden="true" /> : <LucideChevronRight aria-hidden="true" />}
                    <LucideFolder aria-hidden="true" />
                    <strong>{t("moduleBalancing.userCanvases")}</strong>
                    <small>({canvases.length})</small>
                  </button>
                  <div className={cm(styles, "module-balancing-canvas-library-root-actions")}>
                    <button
                      className={cm(styles, "module-balancing-icon-text-button")}
                      type="button"
                      onClick={() => {
                        const folderId = onCreateFolder();
                        setCollapsedRootIds((current) => {
                          const next = new Set(current);
                          next.delete("user");
                          return next;
                        });
                        setCollapsedFolderIds((current) => {
                          const next = new Set(current);
                          next.delete(folderId);
                          return next;
                        });
                        setEditingFolderId(folderId);
                        setFolderNameDraft(`${t("moduleBalancing.newFolder")} ${canvasFolders.length}`);
                      }}
                    >
                      <LucideFolderPlus aria-hidden="true" />
                      <span>{t("moduleBalancing.newFolder")}</span>
                    </button>
                  </div>
                </header>
                {userExpanded ? (
                  <div className={cm(styles, "module-balancing-canvas-library-root-content")}>
                    {rootCanvases.map(renderUserCanvas)}
                    {canvasFolders.map((folder) => {
                      const folderCanvases = canvases.filter((canvas) => canvas.folderId === folder.id);
                      const expanded = !collapsedFolderIds.has(folder.id);
                      const isEditing = editingFolderId === folder.id;
                      return (
                        <section className={cm(styles, "module-balancing-canvas-library-folder")} key={folder.id}>
                          <header
                            className={cm(
                              styles,
                              "module-balancing-canvas-library-folder-header",
                              dropTargetFolderId === folder.id && "is-drop-target",
                            )}
                            onDragEnter={(event) => {
                              if (isCanvasDrag(event)) {
                                setDropTargetFolderId(folder.id);
                              }
                            }}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                setDropTargetFolderId((current) => current === folder.id ? null : current);
                              }
                            }}
                            onDragOver={(event) => {
                              if (isCanvasDrag(event)) {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                                setDropTargetFolderId(folder.id);
                              }
                            }}
                            onDrop={(event) => moveDraggedCanvas(event, folder.id)}
                          >
                            <button
                              aria-label={`${expanded ? t("moduleBalancing.collapseSection") : t("moduleBalancing.expandSection")}: ${folder.name}`}
                              aria-expanded={expanded}
                              className={cm(styles, "module-balancing-canvas-library-folder-toggle")}
                              type="button"
                              onClick={() => setCollapsedFolderIds(toggleSetValue(collapsedFolderIds, folder.id))}
                            >
                              {expanded ? <LucideChevronDown aria-hidden="true" /> : <LucideChevronRight aria-hidden="true" />}
                              <LucideFolder aria-hidden="true" />
                            </button>
                            {isEditing ? (
                              <input
                                autoFocus
                                aria-label={t("moduleBalancing.folderName")}
                                className={cm(styles, "module-balancing-canvas-library-name-input")}
                                value={folderNameDraft}
                                onBlur={() => commitFolderRename(folder.id)}
                                onChange={(event) => setFolderNameDraft(event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  } else if (event.key === "Escape") {
                                    setEditingFolderId(null);
                                  }
                                }}
                              />
                            ) : (
                              <strong className={cm(styles, "module-balancing-canvas-library-folder-name")}>{folder.name}</strong>
                            )}
                            <small>({folderCanvases.length})</small>
                            <div className={cm(styles, "module-balancing-canvas-library-folder-actions")}>
                              <button
                                aria-label={isEditing ? t("action.confirm") : t("moduleBalancing.renameFolder")}
                                className={cm(styles, "module-balancing-mini-icon-button")}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  if (isEditing) {
                                    commitFolderRename(folder.id);
                                  } else {
                                    setEditingFolderId(folder.id);
                                    setFolderNameDraft(folder.name);
                                  }
                                }}
                              >
                                {isEditing ? <LucideSave aria-hidden="true" /> : <LucideEdit3 aria-hidden="true" />}
                              </button>
                              <button
                                aria-label={t("moduleBalancing.deleteFolder")}
                                className={cm(styles, "module-balancing-mini-icon-button is-danger")}
                                type="button"
                                onClick={() => onDeleteFolder(folder.id)}
                              >
                                <LucideTrash2 aria-hidden="true" />
                              </button>
                            </div>
                          </header>
                          {expanded ? (
                            <div className={cm(styles, "module-balancing-canvas-library-folder-content")}>
                              {folderCanvases.map(renderUserCanvas)}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                ) : null}
              </section>
              <section className={cm(styles, "module-balancing-canvas-library-root is-readonly")}>
                <header className={cm(styles, "module-balancing-canvas-library-root-header")}>
                  <button
                    aria-expanded={recommendedExpanded}
                    className={cm(styles, "module-balancing-canvas-library-root-toggle")}
                    type="button"
                    onClick={() => setCollapsedRootIds(toggleSetValue(collapsedRootIds, "recommended"))}
                  >
                    {recommendedExpanded ? <LucideChevronDown aria-hidden="true" /> : <LucideChevronRight aria-hidden="true" />}
                    <LucideFolder aria-hidden="true" />
                    <strong>{t("moduleBalancing.recommendedCanvases")}</strong>
                    <small>({recommendedCanvases.length})</small>
                  </button>
                </header>
                {recommendedExpanded ? (
                  <div className={cm(styles, "module-balancing-canvas-library-root-content")}>
                    {recommendedCanvasLoadFailed ? (
                      <p className={cm(styles, "module-balancing-canvas-library-empty")}>
                        {t("moduleBalancing.recommendedCanvasLoadFailed")}
                      </p>
                    ) : recommendedCanvases.length === 0 ? (
                      <p className={cm(styles, "module-balancing-canvas-library-empty")}>
                        {t("moduleBalancing.recommendedCanvasEmpty")}
                      </p>
                    ) : recommendedCanvases.map((canvas) => (
                      <button
                        className={cm(styles, "module-balancing-canvas-library-row is-recommended")}
                        key={canvas.id}
                        type="button"
                        onClick={() => onLoadRecommendedCanvas(canvas)}
                      >
                        <LucideLayers3 aria-hidden="true" />
                        <span>{canvas.name}</span>
                        <small>{canvas.stages.length} {t("moduleBalancing.stage")}</small>
                        <strong>{t("moduleBalancing.loadCanvas")}</strong>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            </div>
          </section>
        </div>
      )}
    </OverlayStackLayer>
  );
}

const StageDetailPanel = observer(function StageDetailPanel({
  expandedBalanceIds,
  index,
  isTouch,
  onAddModule,
  onAddStage,
  onClearStage,
  onDeleteStage,
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
  isTouch: boolean;
  onAddModule: () => void;
  onAddStage: () => void;
  onClearStage: (stage: ModuleBalancingStageReadWrite) => void;
  onDeleteStage: (stage: ModuleBalancingStageReadWrite) => void;
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
        onDelete={() => onDeleteStage(selectedStage)}
        onSaveAsModule={() => onOpenStageAsModule(selectedStage)}
        onUpdateName={(name) => onRenameStage(selectedStage, name)}
        stage={selectedStage}
        t={t}
      />
      <StageEntryGrid
        index={index}
        isTouch={isTouch}
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
});

const StageHeader = observer(function StageHeader({
  onClear,
  onDelete,
  onSaveAsModule,
  onUpdateName,
  stage,
  t,
}: {
  onClear: () => void;
  onDelete: () => void;
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
        {stage.entries.length > 0 ? (
          <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onClear}>
            <LucideX aria-hidden="true" />
            <span>{t("moduleBalancing.clearStage")}</span>
          </button>
        ) : (
          <button className={cm(styles, "module-balancing-danger-button")} type="button" onClick={onDelete}>
            <LucideTrash2 aria-hidden="true" />
            <span>{t("moduleBalancing.deleteStage")}</span>
          </button>
        )}
        <button className={cm(styles, "module-balancing-icon-text-button")} type="button" onClick={onSaveAsModule}>
          <LucideSave aria-hidden="true" />
          <span>{t("moduleBalancing.saveAsModule")}</span>
        </button>
      </div>
    </header>
  );
});

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
            <strong className={cm(styles, "module-balancing-stage-entry-quantity")}>× {formatFlow(entry.quantity)}</strong>
            <span className={cm(styles, "module-balancing-stage-entry-flow")}>
              {formatPortList(inputs, index, t)} → {formatPortList(outputs, index, t)}
            </span>
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
              <div className={cm(styles, "module-balancing-summary-metrics")}>
                <span>{t("moduleBalancing.outputItems")} {formatFlow(balance.totalOutput)}</span>
                <span>{t("moduleBalancing.inputItems")} {formatFlow(balance.totalInput)}</span>
                <strong className={cm(styles, resolveBalanceClassName(balance.netDelta))}>{formatSignedFlow(balance.netDelta)}/min</strong>
              </div>
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
  dispatchTicketGroups,
  index,
  t,
  warehouseForecasts,
}: {
  balances: ModuleBalancingItemBalance[];
  canvas?: ModuleBalancingCanvasReadWrite;
  dispatchTicketGroups: ModuleBalancingDispatchTicketGroup[];
  index: ModuleBalancingIndex;
  t: (key: string) => string;
  warehouseForecasts: ModuleBalancingWarehouseForecast[];
}) {
  const meaningfulForecasts = warehouseForecasts.filter((forecast) => Math.abs(forecast.netDeltaPerMin) >= 0.005);
  // AI-REMOVED 2026-08-29:
  // Reason: 武陵与四号谷地调度券不可跨地区合计。
  // Trigger: ST2-RQ-018 要求每个地区独立合计且页面不提供两地总计。
  // Evidence: ModuleBalancingDispatchTicketGroup 已在模型层持有地区合计。
  // Replacement: group.totalDispatchPerMin
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const dispatchTotal = dispatchTicketSummaries.reduce((sum, item) => sum + item.dispatchPerMin, 0);
  const hasSideLists = dispatchTicketGroups.length > 0 || warehouseForecasts.length > 0;

  return (
    <section className={cm(styles, "module-balancing-summary", !hasSideLists && "is-summary-full-width")}>
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
            <div className={cm(styles, "module-balancing-summary-metrics")}>
              <span className={cm(styles, "module-balancing-summary-metric")}>{t("moduleBalancing.outputItems")} <strong>{formatFlow(balance.totalOutput)}</strong></span>
              <span className={cm(styles, "module-balancing-summary-metric")}>{t("moduleBalancing.inputItems")} <strong>{formatFlow(balance.totalInput)}</strong></span>
              <strong className={cm(styles, `module-balancing-summary-net ${resolveBalanceClassName(balance.netDelta)}`)}>{formatSignedFlow(balance.netDelta)}/min</strong>
            </div>
          </div>
        ))}
      </div>
      {dispatchTicketGroups.map((group) => {
        const regionNameKey = group.region === "武陵"
          ? "workbench.base.wuling"
          : "workbench.base.valley4";
        const title = t("moduleBalancing.dispatchTicketTitle")
          .replace("{region}", t(regionNameKey));
        return (
          <div className={cm(styles, "module-balancing-dispatch-list")} key={group.region}>
            <h4>{title}</h4>
            {group.items.map((summary) => (
              <div className={cm(styles, "module-balancing-warehouse-row")} key={summary.itemId}>
                <img alt="" src={resolveItemIconSrc(summary.itemId, index)} />
                <span>{resolveItemName(summary.itemId, index, t)}</span>
                <strong>{formatFlow(summary.dispatchPerMin)} {t("moduleBalancing.dispatchTicketUnit")}/min</strong>
              </div>
            ))}
            <div className={cm(styles, "module-balancing-dispatch-total")}>
              <strong>{t("moduleBalancing.dispatchTicketTotal")}</strong>
              <strong>{formatFlow(group.totalDispatchPerMin)} {t("moduleBalancing.dispatchTicketUnit")}/min</strong>
            </div>
          </div>
        );
      })}
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
  folders,
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
  folders: readonly ModuleBalancingFolderReadWrite[];
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
      <label className={cm(styles, "module-balancing-form-field")}>
        <span>{t("moduleBalancing.folder")}</span>
        <select
          value={draft.folderId ?? ""}
          onChange={(event) => onUpdate({
            ...draft,
            folderId: event.currentTarget.value || null,
          })}
        >
          <option value="">{t("moduleBalancing.rootFolder")}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>{folder.name}</option>
          ))}
        </select>
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
  allowInfinite = false,
  index,
  onChange,
  onRequestPickItem,
  ports,
  t,
}: {
  allowInfinite?: boolean;
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
        <div
          className={cm(
            styles,
            "module-balancing-port-row",
            allowInfinite && "supports-infinite",
            port.infinite === true && "is-infinite",
          )}
          key={`${port.itemId}-${portIndex}`}
        >
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
                if (allowInfinite) {
                  target.infinite = false;
                }
              }
              onChange(nextPorts);
            }}
          />
          <span>/min</span>
          {allowInfinite ? (
            <button
              aria-label={port.infinite === true
                ? t("moduleBalancing.disableInfiniteInput")
                : t("moduleBalancing.enableInfiniteInput")}
              aria-pressed={port.infinite === true}
              className={cm(
                styles,
                "module-balancing-infinite-button",
                port.infinite === true && "is-active",
              )}
              title={port.infinite === true
                ? t("moduleBalancing.disableInfiniteInput")
                : t("moduleBalancing.enableInfiniteInput")}
              type="button"
              onClick={() => {
                const nextPorts = ports.map(clonePort);
                const target = nextPorts[portIndex];
                if (target !== undefined) {
                  target.infinite = target.infinite !== true;
                }
                onChange(nextPorts);
              }}
            >
              ∞
            </button>
          ) : null}
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
    <OverlayStackLayer layerId={`module-balancing:quantity:${draft.stageId}:${draft.moduleId}`} visible>
      {({ zIndex }) => (
        <div className={cm(styles, "module-balancing-editor-backdrop")} onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onCancel();
          }
        }} style={{ zIndex }}>
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
      )}
    </OverlayStackLayer>
  );
}

function resolveModuleTitle(
  module: ModuleBalancingModule,
  index: ModuleBalancingIndex,
  t: (key: string) => string,
): string {
  // 无产出配方：优先用输入物品名作为标题，而非 recipe.nameKey（后者 i18n 可能缺失导致显示 ID）
  // AI-CORRECTION 2026-07-27: 系统配方标题现统一由模型层输出“产物 1 · … · 设备名称”，无产出时仍回退输入物品。
  return resolveModuleDisplayTitle(module, index, t);
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
  return matchesModuleSearchQuery(module, normalizedQuery, index, t);
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
    ...(port.infinite === true ? { infinite: true } : {}),
  };
}
