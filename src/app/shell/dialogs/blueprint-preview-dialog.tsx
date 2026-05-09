import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type { WorkbenchBlueprintPreviewController } from "@/app/shell/state/blueprint-preview-dialog-state";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";

function formatBlueprintTimestamp(locale: string, value: string): string {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function resolveBlueprintFootprint(record: BlueprintLibraryRecord) {
  const orderedEntities = record.entityOrder
    .map((entityId) => record.entities[entityId])
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined);

  if (orderedEntities.length === 0) {
    return {
      width: 0,
      height: 0,
    };
  }

  const minX = Math.min(...orderedEntities.map((entity) => entity.position.x));
  const maxX = Math.max(...orderedEntities.map((entity) => entity.position.x));
  const minY = Math.min(...orderedEntities.map((entity) => entity.position.y));
  const maxY = Math.max(...orderedEntities.map((entity) => entity.position.y));

  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const BlueprintPreviewDialog = observer(function BlueprintPreviewDialog({
  appHost,
  controller,
}: {
  appHost: AppHost;
  controller: WorkbenchBlueprintPreviewController;
}) {
  const t = appHost.actions.translate;
  const record = controller.record;
  const dialogState = controller.dialogState;
  const locale = appHost.state.settings.locale;
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isTabletLayout = appHost.state.screenProfile.deviceClass === "tablet";
  const useImmersiveShell = isPhoneLayout
    || (dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile));

  if (!dialogState.visible || record === null) {
    return null;
  }

  const copy = appHost.state.settings.locale === "zh-CN"
    ? {
      title: "蓝图预览",
      close: "关闭",
      maximize: "最大化",
      restore: "还原",
      previewTitle: "蓝图预览",
      previewHint: "布局总览",
      place: "放置",
      placeHint: "将当前蓝图放置到场景",
      version: "版本",
      base: "地图",
      entities: "实体数",
      links: "连线数",
      footprint: "预估范围",
      anchor: "初始坐标",
      updatedAt: "更新时间",
      noDescription: "暂无描述",
      rendererNote: "蓝图信息",
    }
    : {
      title: "Blueprint Preview",
      previewTitle: "Blueprint Preview",
      previewHint: "Layout Overview",
      place: "Place",
      placeHint: "Place this blueprint into the scene",
      version: "Version",
      base: "Base",
      entities: "Entities",
      links: "Links",
      footprint: "Footprint",
      anchor: "Anchor",
      updatedAt: "Updated",
      noDescription: "No description",
      rendererNote: "Blueprint Information",
    };
  const footprint = resolveBlueprintFootprint(record);
  const formattedUpdatedAt = formatBlueprintTimestamp(locale, record.updatedAt);
  const previewSummary = `${copy.entities} ${record.entityOrder.length} · ${copy.links} ${record.slotLinks.length} · ${copy.footprint} ${footprint.width} x ${footprint.height}`;
  const rendererSummary = `${copy.base}: ${record.baseId} · ${copy.updatedAt}: ${formattedUpdatedAt}`;
  const handlePlaceButtonPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: "blueprint-preview-place-button",
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: "blueprint-preview-place-button",
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };
  const handlePlaceButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) {
      return;
    }

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "blueprint-preview-place-button",
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  };

  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      width: isPhoneLayout ? "100dvw" : isTabletLayout ? "720px" : "760px",
      height: isPhoneLayout ? "100dvh" : isTabletLayout ? "720px" : "680px",
      minHeight: isPhoneLayout ? "100dvh" : "520px",
    }
    : undefined;

  return (
    <DialogShell
      bodyClassName="blueprint-preview-dialog-body"
      className="blueprint-preview-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isPhoneLayout}
      dialogKey="blueprint-preview"
      dialogState={dialogState}
      immersiveMaximized={useImmersiveShell}
      maximizeTitle={t("dialog.maximize")}
      onClose={controller.close}
      onOffsetChange={controller.setOffset}
      onResize={isPhoneLayout ? undefined : controller.setSize}
      onToggleMaximized={controller.toggleMaximized}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={copy.title}
      titleId="blueprint-preview-dialog-title"
    >
      <div className="blueprint-preview-dialog-content">
        <section className="blueprint-preview-layout" aria-label={copy.previewTitle}>
          <div className="blueprint-preview-stage">
            <div className="blueprint-preview-canvas-shell">
              <canvas aria-hidden="true" className="blueprint-preview-canvas" />
              <div className="blueprint-preview-overlay">
                <span className="blueprint-preview-canvas-label">{copy.previewHint}</span>
                <p>{previewSummary}</p>
              </div>
            </div>
            <div className="blueprint-preview-stage-metrics">
              <span className="pill">{copy.entities}: {record.entityOrder.length}</span>
              <span className="pill">{copy.footprint}: {footprint.width} x {footprint.height}</span>
              <span className="pill">{copy.anchor}: ({record.initialGridPoint.x}, {record.initialGridPoint.y})</span>
            </div>
            <p aria-label={copy.rendererNote} className="blueprint-preview-renderer-note">{rendererSummary}</p>
          </div>
          <div className="blueprint-preview-summary-card">
            <div className="blueprint-preview-header">
              <div className="blueprint-preview-header-copy">
                <h3>{record.name}</h3>
                <p>{record.description.length > 0 ? record.description : copy.noDescription}</p>
              </div>
              <button
                className="save-blueprint-primary-button"
                data-ui-button-id="blueprint-preview-place-button"
                onClick={handlePlaceButtonClick}
                onPointerDown={preventTouchPointerCompatibilityMouseEvents}
                onPointerUp={handlePlaceButtonPointerUp}
                title={copy.placeHint}
                type="button"
              >
                {copy.place}
              </button>
            </div>
            <dl className="blueprint-preview-metadata">
              <dt>{copy.version}</dt>
              <dd>{record.version}</dd>
              <dt>{copy.base}</dt>
              <dd>{record.baseId}</dd>
              <dt>{copy.entities}</dt>
              <dd>{record.entityOrder.length}</dd>
              <dt>{copy.links}</dt>
              <dd>{record.slotLinks.length}</dd>
              <dt>{copy.footprint}</dt>
              <dd>{footprint.width} x {footprint.height}</dd>
              <dt>{copy.anchor}</dt>
              <dd>({record.initialGridPoint.x}, {record.initialGridPoint.y})</dd>
              <dt>{copy.updatedAt}</dt>
              <dd>{formattedUpdatedAt}</dd>
            </dl>
            {/* AI-REMOVED 2026-05-09:
                Reason: 移除预览卡底部的说明性脚注，避免 UI 出现不必要的提示性副标题。
                Trigger: 用户要求新建 UI 不要展示开发性质 hint，也不要添加不需要的说明性质文案。
                Evidence: 当前卡片已有主动作按钮与完整元信息，脚注只是在重复说明“放置”动作。
                Replacement: None
                Risk: Low
                Human Review: Required

                Original code:
                <p className="blueprint-preview-footnote">{copy.placeHint}</p>
            */}
          </div>
        </section>
      </div>
    </DialogShell>
  );
});