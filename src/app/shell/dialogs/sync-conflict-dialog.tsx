import { makeAutoObservable } from "mobx";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { cm } from "@/app/shell/shared/css-module-class";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type {
  SyncConflictDecision,
  SyncConflictItemKind,
  SyncConflictResolution,
  SyncContract,
} from "@/domain/sync";
import {
  listBlueprintSyncEntries,
  type BlueprintFolderRecord,
  type BlueprintRecord,
} from "@/shared/storage";
import styles from "./sync-conflict-dialog.module.scss";

interface SyncConflictDialogProps {
  readonly appHost: AppHost;
  readonly compactMobileLayout: boolean;
  readonly onStopSync: () => void;
  readonly sync: SyncContract;
  readonly t: AppHost["actions"]["translate"];
}

export const SyncConflictDialog = observer(function SyncConflictDialog({
  appHost,
  compactMobileLayout,
  onStopSync,
  sync,
  t,
}: SyncConflictDialogProps) {
  const dialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: true,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 720,
    height: 560,
    activeTab: null,
  }), []);
  const [decisions, setDecisions] = useState(
    () => new Map<string, SyncConflictResolution>(),
  );
  const [storedItemNames, setStoredItemNames] = useState(
    () => new Map<string, string>(),
  );
  const conflict = sync.state.pendingConflict;
  const itemKey = conflict?.items.map(
    (item) => createConflictItemKey(item.adapterId, item.assetId),
  ).join("\u0001") ?? "";
  const nameLookupItems = useMemo(
    () => conflict?.items.map((item) => ({
      adapterId: item.adapterId,
      assetId: item.assetId,
    })) ?? [],
    [conflict?.items],
  );

  useEffect(() => {
    // AI-CORRECTION 2026-08-13: 按条目类型预设默认决议——
    // 上传条目默认“用我的”，下载条目默认“用远端”，冲突条目无默认必须显式选择。
    setDecisions(new Map(conflict?.items.flatMap((item): Array<[string, SyncConflictResolution]> =>
      item.kind === "upload"
        ? [[createConflictItemKey(item.adapterId, item.assetId), "use-local"]]
        : item.kind === "download"
          ? [[createConflictItemKey(item.adapterId, item.assetId), "use-remote"]]
          : []
    ) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 重置条件由 itemKey 表达，避免 phase 变化时清空选择
  }, [itemKey]);

  useEffect(() => {
    let active = true;
    setStoredItemNames(new Map());
    void loadStoredConflictItemNames(nameLookupItems).then((names) => {
      if (active) {
        setStoredItemNames(names);
      }
    });

    return () => {
      active = false;
    };
  }, [nameLookupItems]);

  if (!sync.state.settings.enabled || conflict === null) {
    return null;
  }

  const allDecisionsSelected = conflict.items.length > 0
    && conflict.items.every((item) =>
      decisions.has(createConflictItemKey(item.adapterId, item.assetId))
    );
  const submitDecisions = (): void => {
    if (!allDecisionsSelected) {
      return;
    }

    sync.actions.resolveConflicts(conflict.items.map((item) => ({
      adapterId: item.adapterId,
      assetId: item.assetId,
      resolution: decisions.get(
        createConflictItemKey(item.adapterId, item.assetId),
      )!,
    } satisfies SyncConflictDecision)));
  };
  const selectAll = (
    resolution: "use-local" | "use-remote",
  ): void => {
    setDecisions(new Map(conflict.items.map((item) => [
      createConflictItemKey(item.adapterId, item.assetId),
      resolution,
    ])));
  };

  return (
    <DialogShell
      bodyClassName={cm(styles, "sync-conflict-dialog-body")}
      className={cm(styles, "sync-conflict-dialog")}
      closeTitle={t("action.close")}
      compactMobileLayout={compactMobileLayout}
      dialogKey="sync-conflict"
      dialogState={dialogState}
      dismissible={false}
      maximizeTitle=""
      onClose={() => {}}
      onToggleMaximized={() => {}}
      overlayKind="system"
      restoreTitle=""
      showMaximizeButton={false}
      title={t("settingsField.experimental-sync-conflict-title")}
      titleId="sync-conflict-dialog-title"
    >
      {conflict.phase === "awaiting-resolution" ? (
        <form
          className={cm(styles, "sync-conflict-content")}
          onSubmit={(event) => {
            event.preventDefault();
            submitDecisions();
          }}
        >
          <p className={cm(styles, "sync-conflict-summary")}>
            {t("syncConflict.summary").replace(
              "{count}",
              String(conflict.items.length),
            )}
          </p>
          <div className={cm(styles, "sync-conflict-list")}>
            {conflict.items.map((item) => {
              const key = createConflictItemKey(
                item.adapterId,
                item.assetId,
              );
              const selectedResolution = decisions.get(key);
              const typeLabel = resolveConflictItemTypeLabel(item.adapterId, t);
              const itemName = resolveConflictItemName({
                adapterId: item.adapterId,
                assetId: item.assetId,
                appHost,
                storedItemNames,
                t,
              });
              const itemLabel = t("syncConflict.itemLabel")
                .replace("{type}", typeLabel)
                .replace("{name}", itemName);
              const kindLabel = resolveConflictItemKindLabel(item.kind, t);

              return (
                <fieldset
                  className={cm(styles, "sync-conflict-item")}
                  key={key}
                >
                  <legend>
                    <strong>{itemLabel}</strong>
                    <span className={cm(styles, "sync-conflict-item-kind")}>
                      {kindLabel}
                    </span>
                    {/*
                      AI-REMOVED 2026-08-08:
                      Reason: 内部 assetId 不是面向用户的资源名称，且长 ID 会破坏弹窗对齐。
                      Trigger: 用户要求移除基地 ID、蓝图 ID，并将类型与名称合并展示。
                      Evidence: 三种规定屏幕尺寸截图均显示 ID 折行或挤占标题空间。
                      Replacement: 上方本地化的 itemLabel。
                      Risk: Low；内部 ID 仍保留在表单 key 与提交决议中。
                      Human Review: Required

                      Original code:
                      <span>{item.assetId}</span>
                    */}
                  </legend>
                  {item.kind === "conflict" ? (
                    <p>
                      {t("syncConflict.remoteUpdatedAt").replace(
                        "{time}",
                        formatRemoteUpdatedAt(
                          item.remoteUpdatedAt,
                          t("syncConflict.unknownTime"),
                        ),
                      )}
                    </p>
                  ) : null}
                  <div className={cm(styles, "sync-conflict-options")}>
                    {CONFLICT_RESOLUTIONS.map((resolution) => (
                      <label key={resolution}>
                        <input
                          checked={selectedResolution === resolution}
                          name={`sync-conflict-${key}`}
                          onChange={() => {
                            setDecisions((current) => {
                              const next = new Map(current);
                              next.set(key, resolution);
                              return next;
                            });
                          }}
                          type="radio"
                          value={resolution}
                        />
                        <span>{t(resolveResolutionLabel(resolution))}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className={cm(styles, "sync-conflict-actions")}>
            <button
              className={cm(styles, "sync-conflict-batch-action")}
              onClick={() => selectAll("use-local")}
              type="button"
            >
              {t("syncConflict.batchUseLocal")}
            </button>
            <button
              className={cm(styles, "sync-conflict-batch-action")}
              onClick={() => selectAll("use-remote")}
              type="button"
            >
              {t("syncConflict.batchUseRemote")}
            </button>
            <button
              className={cm(styles, "sync-conflict-stop-sync")}
              onClick={onStopSync}
              type="button"
            >
              {t("syncConflict.stopSync")}
            </button>
            <button
              className={cm(styles, "sync-conflict-apply")}
              disabled={!allDecisionsSelected}
              type="submit"
            >
              {t("syncConflict.apply")}
            </button>
          </div>
        </form>
      ) : (
        <div
          aria-live="polite"
          className={cm(styles, "sync-conflict-progress")}
          role="status"
        >
          <WorkbenchIcon
            className={cm(styles, "sync-conflict-spinner")}
            kind="save-progress"
          />
          <p>
            {t(conflict.phase === "discovering"
              ? "syncConflict.discovering"
              : "syncConflict.applying")}
          </p>
        </div>
      )}
    </DialogShell>
  );
});

const CONFLICT_RESOLUTIONS: readonly SyncConflictResolution[] = [
  "use-local",
  "use-remote",
  // AI-REMOVED 2026-08-08:
  // Reason: pause 是关闭整个同步流程的全局决议，不是单项资源的独立选择。
  // Trigger: 用户要求从子项移除拒绝冲突，并改为底部红色全局操作按钮。
  // Evidence: 任意一个 pause 都会保留双方数据并结束本次同步，逐项重复展示会误导用户。
  // Replacement: WebDavConflictDialog 的 webdav-conflict-stop-sync 按钮。
  // Risk: Low；pause 仍由同步状态的 cancelConflictWorkflow 为全部冲突统一提交。
  // Human Review: Required
  //
  // Original code:
  // "pause",
];

function createConflictItemKey(adapterId: string, assetId: string): string {
  return `${adapterId}\u0000${assetId}`;
}

function resolveConflictItemKindLabel(
  kind: SyncConflictItemKind,
  t: AppHost["actions"]["translate"],
): string {
  return t(`syncConflict.kind.${kind}`);
}

function resolveResolutionLabel(
  resolution: SyncConflictResolution,
):
  | "settingsField.experimental-sync-conflict-use-local"
  | "settingsField.experimental-sync-conflict-use-remote"
  | "settingsField.experimental-sync-conflict-pause" {
  if (resolution === "use-local") {
    return "settingsField.experimental-sync-conflict-use-local";
  }
  if (resolution === "use-remote") {
    return "settingsField.experimental-sync-conflict-use-remote";
  }

  return "settingsField.experimental-sync-conflict-pause";
}

function formatRemoteUpdatedAt(
  value: string | null,
  fallback: string,
): string {
  if (value === null) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

async function loadStoredConflictItemNames(
  items: readonly { readonly adapterId: string; readonly assetId: string }[],
): Promise<Map<string, string>> {
  const blueprintIds = new Set(items.flatMap((item) =>
    item.adapterId === "blueprints" ? [item.assetId] : []
  ));
  const blueprintFolderIds = new Set(items.flatMap((item) =>
    item.adapterId === "blueprint-folders" ? [item.assetId] : []
  ));
  if (blueprintIds.size === 0 && blueprintFolderIds.size === 0) {
    return new Map();
  }

  try {
    const [blueprints, blueprintFolders] = await Promise.all([
      blueprintIds.size === 0
        ? Promise.resolve([])
        : listBlueprintSyncEntries<BlueprintRecord>("blueprint"),
      blueprintFolderIds.size === 0
        ? Promise.resolve([])
        : listBlueprintSyncEntries<BlueprintFolderRecord>("folder"),
    ]);
    const names = new Map<string, string>();
    for (const entry of blueprints) {
      if (blueprintIds.has(entry.id)) {
        names.set(createConflictItemKey("blueprints", entry.id), entry.value.name);
      }
    }
    for (const entry of blueprintFolders) {
      if (blueprintFolderIds.has(entry.id)) {
        names.set(
          createConflictItemKey("blueprint-folders", entry.id),
          entry.value.name,
        );
      }
    }

    return names;
  } catch {
    return new Map();
  }
}

function resolveConflictItemTypeLabel(
  adapterId: string,
  t: AppHost["actions"]["translate"],
): string {
  switch (adapterId) {
    case "world-documents":
      return t("syncConflict.type.base");
    case "blueprints":
      return t("syncConflict.type.blueprint");
    case "blueprint-folders":
      return t("syncConflict.type.blueprintFolder");
    case "custom-modules":
      return t("syncConflict.type.module");
    case "custom-module-folders":
      return t("syncConflict.type.moduleFolder");
    case "module-canvases":
      return t("syncConflict.type.moduleCanvas");
    case "module-canvas-folders":
      return t("syncConflict.type.moduleCanvasFolder");
    case "production-planning":
      return t("syncConflict.type.productionPlanning");
    default:
      return t("syncConflict.type.syncData");
  }
}

function resolveConflictItemName(options: {
  readonly adapterId: string;
  readonly assetId: string;
  readonly appHost: AppHost;
  readonly storedItemNames: ReadonlyMap<string, string>;
  readonly t: AppHost["actions"]["translate"];
}): string {
  const { adapterId, assetId, appHost, storedItemNames, t } = options;
  const moduleBalancing = appHost.internalState.workbench.toolbox.moduleBalancing;
  let name: string | undefined;

  switch (adapterId) {
    case "world-documents":
      name = appHost.workspace.registry.baseDefinitions.find(
        (definition) => definition.id === assetId,
      )?.name;
      break;
    case "blueprints":
    case "blueprint-folders":
      name = storedItemNames.get(createConflictItemKey(adapterId, assetId));
      break;
    case "custom-modules":
      name = moduleBalancing.customModules.find((item) => item.id === assetId)?.name;
      break;
    case "custom-module-folders":
      name = moduleBalancing.folders.find((item) => item.id === assetId)?.name;
      break;
    case "module-canvases":
      name = moduleBalancing.canvases.find((item) => item.id === assetId)?.name;
      break;
    case "module-canvas-folders":
      name = moduleBalancing.canvasFolders.find((item) => item.id === assetId)?.name;
      break;
    case "production-planning":
      return t("syncConflict.currentPlan");
  }

  return name?.trim() || t("syncConflict.nameUnavailable");
}
