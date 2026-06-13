import { runInAction } from "mobx";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type { V2MigrationController } from "@/app/migration";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

interface V2MigrationDialogProps {
  appHost: AppHost;
  controller: V2MigrationController;
}

export const V2MigrationDialog = observer(function V2MigrationDialog({
  appHost,
  controller,
}: V2MigrationDialogProps) {
  const t = appHost.actions.translate;
  const locale = appHost.state.settings.locale;
  const isCompact = appHost.state.screenProfile.deviceClass === "mobile";
  const isCompleted = controller.migrationState.completedAt !== null;

  return (
    <DialogShell
      bodyClassName={cm(styles, "v2-migration-dialog-body")}
      className="v2-migration-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isCompact}
      dialogKey="v2-migration"
      dialogState={controller.dialogState}
      maximizeTitle={t("dialog.maximize")}
      onClose={controller.closeDialog}
      onOffsetChange={(offsetX, offsetY) => {
        runInAction(() => {
          controller.dialogState.offsetX = offsetX;
          controller.dialogState.offsetY = offsetY;
        });
      }}
      onResize={(width, height) => {
        runInAction(() => {
          controller.dialogState.width = width;
          controller.dialogState.height = height;
        });
      }}
      onToggleMaximized={() => {
        runInAction(() => {
          controller.dialogState.maximized = !controller.dialogState.maximized;
        });
      }}
      restoreTitle={t("dialog.restore")}
      title="v2 数据迁移"
      titleId="v2-migration-dialog-title"
    >
      <div className={cm(styles, "v2-migration-content")}>
        <section className={cm(styles, "v2-migration-section")}>
          <h3>迁移内容</h3>
          <p>迁移会读取当前浏览器里的 v2 数据，并写入 v3。</p>
          <ul>
            <li>所有 v2 地图设备、位置、旋转、配置和暗管链接会迁移到对应 v3 地图。</li>
            <li>所有 v2 用户蓝图会保存到 v3 蓝图库的“迁移的蓝图”文件夹。</li>
            <li>模块配平工具里的画布和自定义模块会迁移到 v3 模块配平工具。</li>
          </ul>
        </section>

        <section className={cm(styles, "v2-migration-section v2-migration-warning")}>
          <h3>迁移影响</h3>
          <ul>
            <li>迁移会清空 v3 当前所有地图，并用 v2 地图替换。</li>
            <li>迁移不会删除 v2 的地图、蓝图或模块配平数据。</li>
            <li>v2 存储槽位锁定不会迁移；预置物品和数量会保留。</li>
            <li>v2 历史记录、缓存和剪贴板数据可能会被清理以释放 localStorage 空间。</li>
          </ul>
        </section>

        <MigrationStatus controller={controller} />

        {!isCompleted && (
          <p className={cm(styles, "v2-migration-hint")}>
            {locale === "zh-CN"
              ? "今后如需再次迁移，请在设置对话框中点击「v2 数据迁移」按钮。"
              : "To migrate again later, click the 'v2 Data Migration' button in the Settings dialog."}
          </p>
        )}

        <div className={cm(styles, "v2-migration-actions")}>
          {controller.showClearConfirmation ? (
            <ClearConfirmationBlock
              appHost={appHost}
              controller={controller}
            />
          ) : (
            <>
              <button
                className={cm(styles, "v2-migration-secondary-button")}
                disabled={controller.phase === "migrating"}
                onClick={controller.closeDialog}
                type="button"
              >
                {locale === "zh-CN" ? "稍后在设置中手动迁移" : "Migrate later in Settings"}
              </button>
              <button
                className={cm(styles, "v2-migration-primary-button")}
                disabled={!controller.detection.hasData || controller.phase === "migrating"}
                onClick={() => void controller.requestConfirmation(appHost)}
                type="button"
              >
                {controller.phase === "migrating" ? "迁移中..." : isCompleted ? "重新迁移" : "开始迁移"}
              </button>
            </>
          )}
        </div>
      </div>
    </DialogShell>
  );
});

const MigrationStatus = observer(function MigrationStatus({
  controller,
}: {
  controller: V2MigrationController;
}) {
  if (controller.phase === "failed") {
    return (
      <section className={cm(styles, "v2-migration-status is-error")}>
        <strong>迁移失败</strong>
        <span>{controller.errorMessage ?? "请检查浏览器存储状态后重试。"}</span>
      </section>
    );
  }

  if (controller.phase === "migrating") {
    return (
      <section className={cm(styles, "v2-migration-status")}>
        <strong>正在迁移</strong>
        <span>请保持页面打开，迁移完成前不要刷新。</span>
      </section>
    );
  }

  const summary = controller.result ?? controller.migrationState.summary;
  if (summary !== null && controller.migrationState.completedAt !== null) {
    return (
      <section className={cm(styles, "v2-migration-status is-success")}>
        <strong>已完成迁移</strong>
        <span>
          地图 {summary.migratedMapCount} 个，蓝图 {summary.migratedBlueprintCount} 个，
          配平画布 {summary.migratedModuleCanvasCount} 个，自定义模块 {summary.migratedCustomModuleCount} 个。
        </span>
      </section>
    );
  }

  if (!controller.detection.hasData) {
    return (
      <section className={cm(styles, "v2-migration-status")}>
        <strong>未检测到 v2 数据</strong>
        <span>当前浏览器没有可迁移的 v2 地图、用户蓝图或模块配平数据。</span>
      </section>
    );
  }

  return (
    <section className={cm(styles, "v2-migration-status")}>
      <strong>已检测到 v2 数据</strong>
      <span>
        地图 {controller.detection.mapCount} 个，用户蓝图 {controller.detection.blueprintCount} 个，
        模块配平数据 {controller.detection.hasModuleBalancingData ? "存在" : "未检测到"}。
      </span>
    </section>
  );
});

interface ClearConfirmationBlockProps {
  appHost: AppHost;
  controller: V2MigrationController;
}

const CLEAR_CONFIRMATION_PHRASE = "清除所有基地数据";

const ClearConfirmationBlock = observer(function ClearConfirmationBlock({
  appHost,
  controller,
}: ClearConfirmationBlockProps) {
  const isMigrating = controller.phase === "migrating";
  const inputMatches = controller.clearConfirmationText === CLEAR_CONFIRMATION_PHRASE;

  return (
    <div className={cm(styles, "v2-migration-clear-confirm")}>
      <section className={cm(styles, "v2-migration-section v2-migration-warning")}>
        <h3>当前 v3 地图已有内容</h3>
        <p>迁移会清空 v3 当前所有地图数据。请输入「{CLEAR_CONFIRMATION_PHRASE}」确认操作。</p>
      </section>

      <input
        className={cm(styles, "v2-migration-confirm-input")}
        disabled={isMigrating}
        onChange={(event) => {
          runInAction(() => {
            controller.clearConfirmationText = event.target.value;
          });
        }}
        placeholder="请输入「清除所有基地数据」"
        type="text"
        value={controller.clearConfirmationText}
      />

      <div className={cm(styles, "v2-migration-actions")}>
        <button
          className={cm(styles, "v2-migration-secondary-button")}
          disabled={isMigrating}
          onClick={controller.cancelConfirmation}
          type="button"
        >
          取消
        </button>
        <button
          className={cm(styles, "v2-migration-danger-button")}
          disabled={!inputMatches || isMigrating}
          onClick={() => controller.submitClearConfirmation(appHost)}
          type="button"
        >
          确认清空 v3 地图并迁移
        </button>
      </div>
    </div>
  );
});
