import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { makeAutoObservable, runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type { V2MigrationController } from "@/app/migration";
import type { PwaController } from "@/app/pwa/pwa-controller";
import { PwaSettingsSection } from "@/app/pwa/pwa-settings-section";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { ActivityIconStrip } from "@/app/shell/shared/activity-icon-strip";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { fetchHelpMarkdownHtml } from "@/app/shell/dialogs/help-markdown";
import {
  type SettingsGroupId,
  type WorkbenchSettingDefinition,
  WORKBENCH_SETTINGS_GROUPS,
  WorkbenchSettingsDialogController,
} from "@/app/shell/state/settings-dialog-state";
import {
  ACTIVITY_DEFINITIONS,
  isActivityOngoing,
  normalizeSelectedActivityIds,
  resolveEffectiveActivityIds,
} from "@/shared/registry/activity-availability";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const SETTINGS_DIALOG_SECTION_SCROLL_OFFSET = 10;

const CONFIG_GUIDE_SETTING_DOC_FILES: ReadonlySet<string> = new Set([
  "game-use-blueprint-style-device-images.md",
  "game-show-device-names.md",
  "game-show-device-icons.md",
  "other-toolbox-show-all-activity-content.md",
  "game-use-inspector-panel.md",
  "game-arknights-selection-right-dock-sync.md",
  "game-arknights-inspector-open-on-second-click.md",
  "game-show-hotkeys.md",
  "game-always-show-grid-lines.md",
  "game-show-grass-background.md",
  "game-arknights-immediate-move.md",
  "game-arknights-copy-while-moving.md",
  "game-arknights-immediate-marquee.md",
  "game-arknights-allow-empty-logistics-endpoints.md",
  "game-arknights-auto-create-splitters-and-convergers.md",
  "other-debug-mode.md",
  "debug-show-fps.md",
  "debug-show-gesture-diagnostics-window.md",
]);

interface SettingsDialogProps {
  appHost: AppHost;
  controller: WorkbenchSettingsDialogController;
  pwaController: PwaController;
  migrationController?: V2MigrationController;
}

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const SettingsDialog = observer(function SettingsDialog({
  appHost,
  controller,
  migrationController,
  pwaController,
}: SettingsDialogProps) {
  const t = appHost.actions.translate;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<SettingsGroupId, HTMLElement>());
  const [capturingKeybindingId, setCapturingKeybindingId] = useState<string | null>(null);
  const dialogState = appHost.internalState.workbench.dialogState.settings;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  const effectiveActivityIds = resolveEffectiveActivityIds({ selectedActivityIds });
  const isOpen = dialogState.visible;
  const [settingGuideSettingId, setSettingGuideSettingId] = useState<string | null>(null);
  const hideGroupSidebar = appHost.state.screenProfile.deviceClass !== "desktop";
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isNonDesktop = appHost.state.screenProfile.deviceClass !== "desktop";
  const selectedSettingGuideSetting = settingGuideSettingId === null
    ? null
    : findWorkbenchSettingDefinition(settingGuideSettingId);

  const settingGuideDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  }), []);

  const handleClose = useCallback(() => {
    setCapturingKeybindingId(null);
    setSettingGuideSettingId(null);
    runInAction(() => {
      settingGuideDialogState.visible = false;
    });
    appHost.internalActions.closeDialog("settings");
  }, [appHost, settingGuideDialogState]);

  const handleOpenSettingGuide = useCallback((settingId: string) => {
    setSettingGuideSettingId(settingId);
    runInAction(() => {
      settingGuideDialogState.visible = true;
      settingGuideDialogState.maximized = false;
      settingGuideDialogState.offsetX = 0;
      settingGuideDialogState.offsetY = 0;
    });
  }, [settingGuideDialogState]);

  const handleCloseSettingGuide = useCallback(() => {
    runInAction(() => {
      settingGuideDialogState.visible = false;
    });
    setSettingGuideSettingId(null);
  }, [settingGuideDialogState]);

  const confirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const resetAllConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const activityDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 520,
    height: null,
    activeTab: null,
  }), []);

  const conflictDialogState = useMemo(() => makeAutoObservable({
    visible: false,
    currentSettingId: null as string | null,
    conflictSettingId: null as string | null,
    newKeyValue: null as string | null,
  }), []);

  // AI-REMOVED 2026-06-24:
  // Reason: conflictPendingRef 被声明但从未被使用，属于死代码
  // Trigger: ESLint @typescript-eslint/no-unused-vars error
  // Evidence: 全仓库搜索仅此一处声明，无任何读取或写入引用
  // Replacement: None
  // Risk: Low — 若后续需要冲突暂存逻辑，可从此处恢复
  // Human Review: Required
  //
  // Original code:
  // const conflictPendingRef = useRef<{ settingId: string; value: string } | null>(null);

  const handleResetOperationAndShortcuts = useCallback(() => {
    runInAction(() => {
      confirmDialogState.visible = true;
    });
  }, [confirmDialogState]);

  const handleResetConfirm = useCallback(() => {
    controller.resetArknightsOperationAndShortcuts();
    runInAction(() => {
      confirmDialogState.visible = false;
    });
  }, [controller, confirmDialogState]);

  const handleResetCancel = useCallback(() => {
    runInAction(() => {
      confirmDialogState.visible = false;
    });
  }, [confirmDialogState]);

  const handleResetAllSettings = useCallback(() => {
    runInAction(() => {
      resetAllConfirmDialogState.visible = true;
    });
  }, [resetAllConfirmDialogState]);

  const handleResetAllConfirm = useCallback(() => {
    controller.resetAllSettings();
    runInAction(() => {
      resetAllConfirmDialogState.visible = false;
    });
  }, [controller, resetAllConfirmDialogState]);

  const handleResetAllCancel = useCallback(() => {
    runInAction(() => {
      resetAllConfirmDialogState.visible = false;
    });
  }, [resetAllConfirmDialogState]);

  const handleOpenActivityDialog = useCallback(() => {
    runInAction(() => {
      activityDialogState.visible = true;
    });
  }, [activityDialogState]);

  const handleCloseActivityDialog = useCallback(() => {
    runInAction(() => {
      activityDialogState.visible = false;
    });
  }, [activityDialogState]);

  const handleToggleActivity = useCallback((activityId: string, selected: boolean) => {
    runInAction(() => {
      const selectedIds = new Set(normalizeSelectedActivityIds(appHost.internalState.settings.selectedActivityIds));
      if (selected) {
        selectedIds.add(activityId);
      } else {
        selectedIds.delete(activityId);
      }

      appHost.internalState.settings.selectedActivityIds = normalizeSelectedActivityIds([...selectedIds]);
    });
  }, [appHost]);

  const handleConflictCancel = useCallback(() => {
    runInAction(() => {
      conflictDialogState.visible = false;
      conflictDialogState.currentSettingId = null;
      conflictDialogState.conflictSettingId = null;
      conflictDialogState.newKeyValue = null;
    });
  }, [conflictDialogState]);

  const handleConflictConfirm = useCallback(() => {
    const currentId = conflictDialogState.currentSettingId;
    const conflictId = conflictDialogState.conflictSettingId;
    const newValue = conflictDialogState.newKeyValue;

    runInAction(() => {
      conflictDialogState.visible = false;
      conflictDialogState.currentSettingId = null;
      conflictDialogState.conflictSettingId = null;
      conflictDialogState.newKeyValue = null;
    });

    if (currentId === null || conflictId === null || newValue === null) return;

    // 先清空冲突快捷键，再设置当前快捷键
    controller.clearKeybinding(conflictId);
    controller.updateKeybindingValue(currentId, newValue);
  }, [controller, conflictDialogState]);

  const handleWindowKeyDown = useCallback((event: KeyboardEvent) => {
    if (capturingKeybindingId === null) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setCapturingKeybindingId(null);

      return true;
    }

    if (!controller.isSettingEditable(capturingKeybindingId)) {
      setCapturingKeybindingId(null);

      return true;
    }

    const nextValue = formatCapturedKeybinding(event);
    if (nextValue === null) {
      return true;
    }

    // 检查快捷键冲突
    const conflictSettingId = controller.findKeybindingConflict(capturingKeybindingId, nextValue);
    if (conflictSettingId !== null) {
      // 有冲突：弹出确认对话框
      runInAction(() => {
        conflictDialogState.visible = true;
        conflictDialogState.currentSettingId = capturingKeybindingId;
        conflictDialogState.conflictSettingId = conflictSettingId;
        conflictDialogState.newKeyValue = nextValue;
      });
      setCapturingKeybindingId(null);

      return true;
    }

    controller.updateKeybindingValue(capturingKeybindingId, nextValue);
    setCapturingKeybindingId(null);

    return true;
  }, [capturingKeybindingId, controller, conflictDialogState]);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setCapturingKeybindingId(null);
    setSettingGuideSettingId(null);
    runInAction(() => {
      settingGuideDialogState.visible = false;
    });
  }, [isOpen, settingGuideDialogState]);

  useEffect(() => {
    if (!isOpen || hideGroupSidebar) {
      return;
    }

    const contentElement = contentRef.current;
    const selectedSection = sectionRefs.current.get(controller.selectedGroupId);
    if (contentElement === null || selectedSection === undefined) {
      return;
    }

    scrollSettingsDialogContentToSection({
      contentElement,
      selectedSection,
    });
  }, [isOpen, controller.selectedGroupId, hideGroupSidebar]);

  if (!isOpen) {
    return null;
  }

  const selectedGroup = controller.selectedGroup;

  return (
    <>
    <DialogShell
      className="settings-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="settings"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("settings", offsetX, offsetY);
      }}
      onResize={(width, height) => {
        appHost.internalActions.setDialogSize("settings", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("settings");
      }}
      onWindowKeyDown={handleWindowKeyDown}
      restoreTitle={t("dialog.restore")}
      title={t("settingsDialog.title")}
      titleId="settings-dialog-title"
    >
        <div
          className={cm(styles, hideGroupSidebar
            ? "settings-dialog-layout settings-dialog-layout-single-pane"
            : "settings-dialog-layout")}
        >
          {hideGroupSidebar ? null : (
            <aside className={cm(styles, "settings-dialog-sidebar")}>
              <div className={cm(styles, "settings-dialog-sidebar-title")}>{t("settingsDialog.groups")}</div>
              <div aria-label={t("settingsDialog.groups")} className={cm(styles, "settings-dialog-tree")} role="tree">
                {WORKBENCH_SETTINGS_GROUPS.filter((group) => !isNonDesktop || !group.mobileHidden).map((group) => {
                  const isActive = group.id === selectedGroup.id;

                  return (
                    <button
                      aria-selected={isActive}
                      aria-controls={`settings-dialog-group-${group.id}`}
                      className={cm(styles, isActive
                        ? "settings-dialog-tree-button is-active"
                        : "settings-dialog-tree-button")}
                      key={group.id}
                      onClick={() => {
                        controller.selectGroup(group.id);
                      }}
                      role="treeitem"
                      type="button"
                    >
                      <span className={cm(styles, "settings-dialog-tree-label")}>{t(group.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}
          <div className={cm(styles, "settings-dialog-content")} ref={contentRef}>
            {WORKBENCH_SETTINGS_GROUPS.filter((group) => !isNonDesktop || !group.mobileHidden).map((group) => (
              <section
                className={cm(styles, "settings-dialog-group-section")}
                id={`settings-dialog-group-${group.id}`}
                key={group.id}
                ref={(element) => {
                  if (element === null) {
                    sectionRefs.current.delete(group.id);

                    return;
                  }

                  sectionRefs.current.set(group.id, element);
                }}
              >
                <div className={cm(styles, "settings-dialog-group-header")}>
                  <h3>{t(group.labelKey)}</h3>
                  <p>{t(group.descriptionKey)}</p>
                </div>
                <div className={cm(styles, "settings-dialog-settings-list")}>
                  {group.items.filter((setting) => !isNonDesktop || !setting.mobileHidden).flatMap((setting, index, _filtered) => {
                    const isEditable = controller.isSettingEditable(setting.id);
                    const isKeybinding = setting.kind === "keybinding";
                    const isDebugGroup = group.id === "debug";
                    const isGameGroup = group.id === "game";
                    const settingLabel = resolveSettingLabel(setting, t);
                    const hasSettingGuide = CONFIG_GUIDE_SETTING_DOC_FILES.has(`${setting.id}.md`);

                    // 调试分组：调试模式关闭时隐藏除调试模式开关外的所有项
                    if (isDebugGroup && index > 0 && !controller.getValue("other-debug-mode")) {
                      return [];
                    }

                    const elements: React.ReactNode[] = [];

                    // 游戏分组分隔符：index 0-2 为第一组(使用蓝图样式+显示设备名称+显示设备图标)，index 3 为第二组(工具箱显示所有活动)
                    if (isGameGroup && (index === 3 || index === 4 || index === 6)) {
                      elements.push(<hr key={`sep-${group.id}-${index}`} className={cm(styles, "settings-dialog-separator")} />);
                    }

                    // 游戏分组：活动设置按钮（第二组中，工具箱显示所有活动后面）
                    if (isGameGroup && index === 3) {
                      elements.push(
                        <ActivitySettingsCard
                          effectiveActivityIds={effectiveActivityIds}
                          key="activity-card"
                          onOpen={handleOpenActivityDialog}
                        />,
                      );
                    }

                    elements.push(
                      <article
                        aria-disabled={!isEditable}
                        className={cm(styles, [
                          "settings-dialog-setting-card",
                          isEditable ? "" : "is-disabled",
                          isKeybinding ? "is-keybinding" : "",
                        ].filter(Boolean).join(" "))}
                        key={setting.id}
                      >
                        <div className={cm(styles, "settings-dialog-setting-copy")}>
                          <h4 className={cm(styles, "settings-dialog-setting-title")}>
                            <span>{settingLabel}</span>
                            {hasSettingGuide ? (
                              <SettingGuideButton
                                label={settingLabel}
                                onClick={() => handleOpenSettingGuide(setting.id)}
                                t={t}
                              />
                            ) : null}
                          </h4>
                          {!isKeybinding && <p>{resolveSettingDescription(setting, t)}</p>}
                        </div>
                        <div className={cm(styles, "settings-dialog-setting-control")}>
                          {renderSettingControl({
                            controller,
                            setting,
                            t,
                            isEditable,
                            capturingKeybindingId,
                            onStartCapturing: setCapturingKeybindingId,
                          })}
                        </div>
                      </article>,
                    );

                    return elements;
                  })}
                </div>
                {group.id === "operation" && (
                  /*
                   * AI-REMOVED 2026-06-15:
                   * Reason: 重置操作需要与普通设置项使用同一张卡片，避免按钮脱离设置列表。
                   * Trigger: 用户反馈重置按钮没有走设置选项样式、视觉突兀。
                   * Evidence: Playwright 截图显示重置按钮位于卡片列表外；代码中使用 settings-dialog-reset-row 单独渲染。
                   * Replacement: SettingsActionCard in this file.
                   * Risk: Low
                   * Human Review: Required
                   *
                   * Original code:
                   * <div className={cm(styles, "settings-dialog-reset-row")}>
                   *   <button
                   *     className={cm(styles, "settings-dialog-reset-button")}
                   *     onClick={handleResetOperationAndShortcuts}
                   *     type="button"
                   *   >
                   *     {t("settingsAction.resetOperationAndShortcuts")}
                   *   </button>
                   * </div>
                   */
                  <SettingsActionCard
                    buttonLabel={t("settingsAction.resetOperationAndShortcuts")}
                    description={t("settingsAction.resetOperationAndShortcutsConfirm")}
                    onClick={handleResetOperationAndShortcuts}
                    title={t("settingsAction.resetOperationAndShortcuts")}
                  />
                )}
                {group.id === "other" && (
                  <>
                    {/*
                      AI-REMOVED 2026-06-15:
                      Reason: 全部重置操作需要与普通设置项使用同一张卡片，避免按钮脱离设置列表。
                      Trigger: 用户反馈重置按钮没有走设置选项样式、视觉突兀。
                      Evidence: Playwright 截图显示重置按钮位于卡片列表外；代码中使用 settings-dialog-reset-row 单独渲染。
                      Replacement: SettingsActionCard in this file.
                      Risk: Low
                      Human Review: Required

                      Original code:
                      <div className={cm(styles, "settings-dialog-reset-row")}>
                        <button
                          className={cm(styles, "settings-dialog-reset-button")}
                          onClick={handleResetAllSettings}
                          type="button"
                        >
                          {t("settingsAction.resetAllSettings")}
                        </button>
                      </div>
                    */}
                    <SettingsActionCard
                      buttonLabel={t("settingsAction.resetAllSettings")}
                      description={t("settingsAction.resetAllSettingsConfirm")}
                      onClick={handleResetAllSettings}
                      title={t("settingsAction.resetAllSettings")}
                    />
                    {migrationController === undefined ? null : (
                      <V2MigrationSettingsCard controller={migrationController} />
                    )}
                    <PwaSettingsSection appHost={appHost} hideHeader pwaController={pwaController} />
                  </>
                )}
              </section>
            ))}
          </div>
        </div>
    </DialogShell>
    {confirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={confirmDialogState}
        onCancel={handleResetCancel}
        onConfirm={handleResetConfirm}
        t={t}
      />
    )}
    {resetAllConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={resetAllConfirmDialogState}
        confirmMessageKey="settingsAction.resetAllSettingsConfirm"
        onCancel={handleResetAllCancel}
        onConfirm={handleResetAllConfirm}
        t={t}
        titleKey="settingsAction.resetAllSettings"
      />
    )}
    {activityDialogState.visible && (
      <ActivitySelectionDialog
        activityDialogState={activityDialogState}
        effectiveActivityIds={effectiveActivityIds}
        onClose={handleCloseActivityDialog}
        onToggleActivity={handleToggleActivity}
        selectedActivityIds={selectedActivityIds}
        t={t}
      />
    )}
    {conflictDialogState.visible && (
      <ConflictDialog
        conflictDialogState={conflictDialogState}
        controller={controller}
        onCancel={handleConflictCancel}
        onConfirm={handleConflictConfirm}
        t={t}
      />
    )}
    {settingGuideDialogState.visible && selectedSettingGuideSetting !== null ? (
      <SettingGuideDialog
        compactMobileLayout={isMobileCompactLayout}
        dialogState={settingGuideDialogState}
        onClose={handleCloseSettingGuide}
        setting={selectedSettingGuideSetting}
        t={t}
      />
    ) : null}
    </>
  );
});

function SettingGuideButton({
  label,
  onClick,
  t,
}: {
  label: string;
  onClick: () => void;
  t: AppHost["actions"]["translate"];
}) {
  const buttonLabel = `${t("helpDialog.title")}: ${label}`;

  return (
    <button
      aria-label={buttonLabel}
      className={cm(styles, "settings-dialog-setting-help-button")}
      onClick={onClick}
      title={buttonLabel}
      type="button"
    >
      <WorkbenchIcon kind="help" />
      <span className={cm(styles, "sr-only")}>{buttonLabel}</span>
    </button>
  );
}

function SettingGuideDialog({
  compactMobileLayout,
  dialogState,
  onClose,
  setting,
  t,
}: {
  compactMobileLayout: boolean;
  dialogState: DialogStateReadWrite;
  onClose: () => void;
  setting: WorkbenchSettingDefinition;
  t: AppHost["actions"]["translate"];
}) {
  const title = resolveSettingLabel(setting, t);
  const path = `/help/config-guide/${setting.id}.md`;

  return (
    <DialogShell
      bodyClassName={cm(styles, "settings-guide-dialog-body")}
      className="settings-guide-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={compactMobileLayout}
      dialogKey="settings-guide"
      dialogState={dialogState}
      maximizeTitle=""
      onClose={onClose}
      onOffsetChange={(offsetX, offsetY) => {
        runInAction(() => {
          dialogState.offsetX = offsetX;
          dialogState.offsetY = offsetY;
        });
      }}
      onResize={(width, height) => {
        runInAction(() => {
          dialogState.width = width;
          dialogState.height = height;
        });
      }}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={title}
      titleId={`settings-guide-dialog-title-${setting.id}`}
    >
      <SettingGuideMarkdown path={path} />
    </DialogShell>
  );
}

function SettingGuideMarkdown({ path }: { path: string }) {
  const [loadState, setLoadState] = useState<{
    path: string;
    html: string | null;
    error: string | null;
  }>(() => ({
    path,
    html: null,
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nextHtml = await fetchHelpMarkdownHtml(path, { stripLeadingH1: true });
        if (!cancelled) {
          setLoadState({
            path,
            html: nextHtml,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setLoadState({
            path,
            html: null,
            error: err instanceof Error ? err.message : "加载失败",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loadState.path !== path) {
    return (
      <div className={cm(styles, "changelog-placeholder settings-guide-placeholder")}>
        <p>加载中…</p>
      </div>
    );
  }

  if (loadState.error !== null) {
    return (
      <div className={cm(styles, "changelog-placeholder settings-guide-placeholder")}>
        <p>加载失败：{loadState.error}</p>
      </div>
    );
  }

  if (loadState.html === null) {
    return (
      <div className={cm(styles, "changelog-placeholder settings-guide-placeholder")}>
        <p>加载中…</p>
      </div>
    );
  }

  return (
    <div
      className={cm(styles, "changelog-markdown settings-guide-markdown")}
      dangerouslySetInnerHTML={{ __html: loadState.html }}
    />
  );
}

function SettingsActionCard({
  buttonLabel,
  description,
  onClick,
  title,
}: {
  buttonLabel: string;
  description: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <article className={cm(styles, "settings-dialog-setting-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <div className={cm(styles, "settings-dialog-setting-control")}>
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={onClick}
          type="button"
        >
          {buttonLabel}
        </button>
      </div>
    </article>
  );
}

const V2MigrationSettingsCard = observer(function V2MigrationSettingsCard({
  controller,
}: {
  controller: V2MigrationController;
}) {
  const summary = controller.result ?? controller.migrationState.summary;
  const statusText = summary !== null && controller.migrationState.completedAt !== null
    ? `已迁移地图 ${summary.migratedMapCount} 个，蓝图 ${summary.migratedBlueprintCount} 个`
    : controller.detection.hasData
      ? `检测到 v2 地图 ${controller.detection.mapCount} 个，蓝图 ${controller.detection.blueprintCount} 个`
      : "未检测到可迁移的 v2 数据";

  return (
    <article className={cm(styles, "settings-dialog-setting-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>v2 数据迁移</h4>
        <p>{statusText}</p>
      </div>
      <div className={cm(styles, "settings-dialog-migration-control")}>
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={controller.openDialog}
          type="button"
        >
          打开迁移
        </button>
      </div>
    </article>
  );
});

function ActivitySettingsCard({
  effectiveActivityIds,
  onOpen,
}: {
  effectiveActivityIds: readonly string[];
  onOpen: () => void;
}) {
  return (
    <article className={cm(styles, "settings-dialog-setting-card settings-dialog-activity-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>活动数据</h4>
        <p>当前生效活动</p>
      </div>
      <div className={cm(styles, "settings-dialog-activity-control")}>
        <ActivityIconStrip activityIds={effectiveActivityIds} />
        {effectiveActivityIds.length === 0 ? (
          <span className={cm(styles, "settings-dialog-activity-empty")}>无</span>
        ) : null}
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={onOpen}
          type="button"
        >
          加载活动数据
        </button>
      </div>
    </article>
  );
}

function ActivitySelectionDialog({
  activityDialogState,
  effectiveActivityIds,
  onClose,
  onToggleActivity,
  selectedActivityIds,
  t,
}: {
  activityDialogState: DialogStateReadWrite;
  effectiveActivityIds: readonly string[];
  onClose: () => void;
  onToggleActivity: (activityId: string, selected: boolean) => void;
  selectedActivityIds: readonly string[];
  t: AppHost["actions"]["translate"];
}) {
  const selectedActivityIdSet = new Set(selectedActivityIds);
  const effectiveActivityIdSet = new Set(effectiveActivityIds);

  return (
    <DialogShell
      className="activity-selection-dialog"
      bodyClassName={cm(styles, "activity-selection-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="activity-selection"
      dialogState={activityDialogState}
      maximizeTitle=""
      onClose={onClose}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title="加载活动数据"
      titleId="activity-selection-dialog-title"
    >
      <div className={cm(styles, "activity-selection-list")}>
        {ACTIVITY_DEFINITIONS.map((activity) => {
          const isSelected = selectedActivityIdSet.has(activity.id);
          const isEffective = effectiveActivityIdSet.has(activity.id);
          const isOngoing = isActivityOngoing(activity);

          return (
            <label className={cm(styles, "activity-selection-row")} key={activity.id}>
              <input
                checked={isSelected}
                onChange={(event) => onToggleActivity(activity.id, event.currentTarget.checked)}
                type="checkbox"
              />
              <img alt="" src={activity.icon} />
              <span className={cm(styles, "activity-selection-row-copy")}>
                <strong>{activity.name}</strong>
                <span>{formatActivityTimeRange(activity.startTime, activity.endTime)}</span>
              </span>
              {isOngoing ? <span className={cm(styles, "activity-selection-badge")}>进行中</span> : null}
              {isEffective ? <span className={cm(styles, "activity-selection-badge")}>生效</span> : null}
            </label>
          );
        })}
      </div>
    </DialogShell>
  );
}

function scrollSettingsDialogContentToSection(options: {
  contentElement: HTMLDivElement;
  selectedSection: HTMLElement;
}): void {
  const { contentElement, selectedSection } = options;
  const contentRect = contentElement.getBoundingClientRect();
  const sectionRect = selectedSection.getBoundingClientRect();
  const nextScrollTop = Math.max(
    0,
    contentElement.scrollTop + sectionRect.top - contentRect.top - SETTINGS_DIALOG_SECTION_SCROLL_OFFSET,
  );

  if (typeof contentElement.scrollTo === "function") {
    contentElement.scrollTo({ top: nextScrollTop });
    return;
  }

  contentElement.scrollTop = nextScrollTop;
}

function findWorkbenchSettingDefinition(settingId: string): WorkbenchSettingDefinition | null {
  for (const group of WORKBENCH_SETTINGS_GROUPS) {
    const setting = group.items.find((item) => item.id === settingId);
    if (setting !== undefined) {
      return setting;
    }
  }

  return null;
}

function resolveSettingLabel(
  setting: WorkbenchSettingDefinition,
  translate: AppHost["actions"]["translate"],
): string {
  if (typeof setting.labelText === "string") {
    return setting.labelText;
  }

  return setting.labelKey ? translate(setting.labelKey) : "";
}

function resolveSettingDescription(
  setting: WorkbenchSettingDefinition,
  translate: AppHost["actions"]["translate"],
): string {
  if (typeof setting.descriptionText === "string") {
    return setting.descriptionText;
  }

  return setting.descriptionKey ? translate(setting.descriptionKey) : "";
}

function renderSettingControl(options: {
  controller: WorkbenchSettingsDialogController;
  setting: WorkbenchSettingDefinition;
  t: AppHost["actions"]["translate"];
  isEditable: boolean;
  capturingKeybindingId: string | null;
  onStartCapturing: (settingId: string | null) => void;
}) {
  const {
    controller,
    setting,
    t,
    isEditable,
    capturingKeybindingId,
    onStartCapturing,
  } = options;
  const value = controller.getValue(setting.id);

  if (setting.kind === "select") {
    return (
      <label className={cm(styles, "settings-dialog-field-shell")} htmlFor={`setting-${setting.id}`}>
        <select
          disabled={!isEditable}
          id={`setting-${setting.id}`}
          name={setting.id}
          onChange={(event) => {
            controller.updateSelectValue(setting.id, event.target.value);
          }}
          value={typeof value === "string" ? value : setting.defaultValue}
        >
          {setting.options.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (setting.kind === "slider") {
    const numericValue = typeof value === "number" ? value : setting.defaultValue;

    return (
      <label className={cm(styles, "settings-dialog-slider-shell")} htmlFor={`setting-${setting.id}`}>
        <input
          disabled={!isEditable}
          id={`setting-${setting.id}`}
          max={setting.max}
          min={setting.min}
          name={setting.id}
          onChange={(event) => {
            controller.updateSliderValue(setting.id, Number(event.target.value));
          }}
          step={setting.step}
          type="range"
          value={numericValue}
        />
        <span className={cm(styles, "settings-dialog-slider-value")}>{numericValue}%</span>
      </label>
    );
  }

  if (setting.kind === "keybinding") {
    const isCapturing = capturingKeybindingId === setting.id;
    const buttonLabel = isCapturing
      ? t("settingsKeybinding.awaitingInput")
      : (typeof value === "string" ? value : setting.defaultValue);

    return (
      <button
        aria-pressed={isCapturing}
        className={cm(styles, isCapturing
          ? "settings-dialog-keybinding-button is-capturing"
          : "settings-dialog-keybinding-button")}
        data-setting-id={setting.id}
        disabled={!isEditable}
        id={`setting-${setting.id}`}
        onClick={(event) => {
          event.preventDefault();
        }}
        onMouseDown={(event) => {
          event.preventDefault();

          if (!isEditable) {
            return;
          }

          onStartCapturing(setting.id);
        }}
        title={buttonLabel}
        type="button"
      >
        {buttonLabel}
      </button>
    );
  }

  const checked = typeof value === "boolean" ? value : setting.defaultValue;

  return (
    <label
      className={cm(styles, isEditable
        ? "settings-dialog-switch-shell"
        : "settings-dialog-switch-shell is-disabled")}
      htmlFor={`setting-${setting.id}`}
    >
      <input
        checked={checked}
        disabled={!isEditable}
        id={`setting-${setting.id}`}
        name={setting.id}
        onChange={(event) => {
          controller.updateSwitchValue(setting.id, event.target.checked);
        }}
        type="checkbox"
      />
      <span className={cm(styles, "settings-dialog-switch-track")} aria-hidden="true">
        <span className={cm(styles, "settings-dialog-switch-thumb")} />
      </span>
      <span className={cm(styles, "settings-dialog-switch-label")}>
        {t(checked ? "settingsOption.enabled" : "settingsOption.disabled")}
      </span>
    </label>
  );
}

function formatCapturedKeybinding(event: KeyboardEvent): string | null {
  if (isModifierOnlyKey(event.key)) {
    return null;
  }

  const keyLabel = normalizeCapturedKeyLabel(event.key);
  if (keyLabel === null) {
    return null;
  }

  const parts: string[] = [];

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (event.metaKey) {
    parts.push("Meta");
  }

  if (!parts.includes(keyLabel)) {
    parts.push(keyLabel);
  }

  return parts.join("+");
}

function normalizeCapturedKeyLabel(key: string): string | null {
  if (key === "") {
    return null;
  }

  if (key === " ") {
    return "Space";
  }

  if (key === "Escape") {
    return "Esc";
  }

  if (key === "ArrowUp") {
    return "Up";
  }

  if (key === "ArrowDown") {
    return "Down";
  }

  if (key === "ArrowLeft") {
    return "Left";
  }

  if (key === "ArrowRight") {
    return "Right";
  }

  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key;
}

function isModifierOnlyKey(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}

function formatActivityTimeRange(startTime: number | undefined, endTime: number | undefined): string {
  const formatTime = (timestamp: number) => new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(timestamp);

  if (startTime !== undefined && endTime !== undefined) {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  }

  if (startTime !== undefined) {
    return `${formatTime(startTime)} 起`;
  }

  if (endTime !== undefined) {
    return `${formatTime(endTime)} 止`;
  }

  return "长期";
}

// ─── 重置确认对话框 ───

interface ConfirmResetDialogProps {
  confirmDialogState: DialogStateReadWrite;
  onCancel: () => void;
  onConfirm: () => void;
  t: AppHost["actions"]["translate"];
  titleKey?: string;
  confirmMessageKey?: string;
}

function ConfirmResetDialog({
  confirmDialogState,
  onCancel,
  onConfirm,
  t,
  titleKey,
  confirmMessageKey,
}: ConfirmResetDialogProps) {
  const title = titleKey ? t(titleKey as Parameters<typeof t>[0]) : t("settingsAction.resetOperationAndShortcuts");
  const message = confirmMessageKey
    ? t(confirmMessageKey as Parameters<typeof t>[0])
    : t("settingsAction.resetOperationAndShortcutsConfirm");

  return (
    <DialogShell
      className="confirm-reset-dialog"
      bodyClassName={cm(styles, "confirm-reset-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="confirm-reset"
      dialogState={confirmDialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={title}
      titleId="confirm-reset-dialog-title"
    >
      <div className={cm(styles, "confirm-reset-content")}>
        <p>{message}</p>
        <div className={cm(styles, "confirm-reset-actions")}>
          <button
            className={cm(styles, "confirm-reset-cancel-btn")}
            onClick={onCancel}
            type="button"
          >
            {t("action.cancel")}
          </button>
          <button
            className={cm(styles, "confirm-reset-confirm-btn")}
            onClick={onConfirm}
            type="button"
          >
            {t("action.confirm")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ─── 快捷键冲突对话框 ───

interface ConflictDialogProps {
  conflictDialogState: {
    visible: boolean;
    currentSettingId: string | null;
    conflictSettingId: string | null;
    newKeyValue: string | null;
  };
  controller: WorkbenchSettingsDialogController;
  onCancel: () => void;
  onConfirm: () => void;
  t: AppHost["actions"]["translate"];
}

function ConflictDialog({
  conflictDialogState,
  controller,
  onCancel,
  onConfirm,
  t,
}: ConflictDialogProps) {
  const conflictLabel = useMemo(() => {
    if (conflictDialogState.conflictSettingId === null) return "";
    return resolveSettingLabelById(conflictDialogState.conflictSettingId, controller, t);
  }, [conflictDialogState.conflictSettingId, controller, t]);

  const newKey = conflictDialogState.newKeyValue ?? "";

  const message = t("settingsKeybinding.conflictMessage")
    .replace("{newKey}", newKey)
    .replace("{conflictLabel}", conflictLabel);

  // 为 ConflictDialog 创建一个简单的 DialogStateReadWrite
  const dialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: conflictDialogState.visible,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), [conflictDialogState.visible]);

  return (
    <DialogShell
      className="conflict-dialog"
      bodyClassName={cm(styles, "confirm-reset-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="shortcut-conflict"
      dialogState={dialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={t("settingsKeybinding.conflictTitle")}
      titleId="shortcut-conflict-dialog-title"
    >
      <div className={cm(styles, "confirm-reset-content")}>
        <p>{message}</p>
        <div className={cm(styles, "confirm-reset-actions")}>
          <button
            className={cm(styles, "confirm-reset-cancel-btn")}
            onClick={onCancel}
            type="button"
          >
            {t("settingsKeybinding.conflictCancel")}
          </button>
          <button
            className={cm(styles, "confirm-reset-confirm-btn")}
            onClick={onConfirm}
            type="button"
          >
            {t("settingsKeybinding.conflictReplace")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

/** 根据 setting id 解析显示标签 */
function resolveSettingLabelById(
  settingId: string,
  controller: WorkbenchSettingsDialogController,
  translate: AppHost["actions"]["translate"],
): string {
  // 通过 WORKBENCH_SETTINGS_GROUPS 查找
  for (const group of WORKBENCH_SETTINGS_GROUPS) {
    for (const setting of group.items) {
      if (setting.id === settingId) {
        return resolveSettingLabel(setting, translate);
      }
    }
  }

  return settingId;
}
