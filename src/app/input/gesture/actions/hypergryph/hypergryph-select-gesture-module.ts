// AI-REMOVED 2026-08-03:
// Reason: 返回选择模式的 Escape 必须硬编码，不再读取可配置快捷键。
// Trigger: ST2-RQ-002 禁止任何快捷键绑定 Escape。
// Evidence: key down 分支已直接匹配 event.code / event.key。
// Replacement: createHypergryphSelectGestureModule 的 key down 分支。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppHost } from "@/app/host/app-host";
import {
  createSceneAttachmentReference,
  resolvePeriodicRangeAttachmentCandidatesAtClientPoint,
  resolvePeriodicRangeRegionByReference,
} from "@/app/canvas";
import type { SceneAttachmentReference } from "@/domain/document/scene-view-input";
import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import type { UiKey } from "@/shared/i18n";
import type { PeriodicRangeRegion } from "@/shared/periodic-range-conversion";

import type { GestureMappingModule } from "../types";
// AI-REMOVED 2026-09-10:
// Reason: 操作模式总开关已废弃，不再保留关闭分支
// Trigger: 用户要求彻底移除 hypergryphOperationMode。
// Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
// Replacement: gesture-action-router.ts 的默认启用语义
// Risk: 历史 false 设置统一使用当前操作行为。
// Human Review: Required
//
// Original code:
// import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import { cancelBlueprintPlacement } from "./hypergryph-blueprint-placement-gesture-module";
import {
  createOverlapEntityCandidate,
  openOverlapMenuForCandidates,
  resolveOverlappingEntityCandidatesAtClientPoint,
} from "./overlap-entity-candidates";
import type { OverlapMenuCandidate } from "@/app/shell";

const PERIODIC_RANGE_ATTACHMENT_LABEL_KEY: UiKey = "inspector.periodicRange.label";
const PERIODIC_RANGE_ATTACHMENT_ICON_PATH = "3d-top-view/avatar/transmuter_2_solidtrans.webp";

export function createHypergryphSelectGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-select-gesture",
    priority: 100,
    // AI-REMOVED 2026-09-10:
    // Reason: 操作模式总开关已废弃，不再保留关闭分支
    // Trigger: 用户要求彻底移除 hypergryphOperationMode。
    // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
    // Replacement: gesture-action-router.ts 的默认启用语义
    // Risk: 历史 false 设置统一使用当前操作行为。
    // Human Review: Required
    //
    // Original code:
    // when: isHypergryphGestureEnabled,
    shortcutRoutes: [{
      id: "active-tool.cancel-to-select",
      actionId: "fixed.active-tool.cancel-to-select",
      binding: { kind: "fixed", value: "Esc" },
      scope: {
        inputLayers: ["canvas"],
        // AI-CORRECTION 2026-09-09: 区域编辑加入同一 Escape 固定取消路由，当前可取消工具不再只有原注释所述五种。
        // 2026-11-24: 选择工具加入同一固定取消路由，用于取消附属实体查看；无焦点且无选区时不消费 Escape。
        activeTools: [
          "select",
          "move",
          "marquee",
          "blueprint-placement",
          "single-placement",
          "logistics-placement",
          "region-edit",
        ],
      },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        if (context.canvas.state.activeTool === "select") {
          const hasFocus = context.canvas.workbench.internalState.runtime.attachmentFocus !== null;
          const hasSelection = (context.canvas.editor?.state.collections.selection.length ?? 0) > 0;
          if (!hasFocus && !hasSelection) {
            return { status: "ignored" };
          }
          context.canvas.editor?.actions.clearCollection(EntityCollectionType.selection);
          context.canvas.workbench.internalActions.setAttachmentFocus(null);
          context.canvas.actions.hideCanvasFloatingToolbar();
          return { status: "handled" };
        }
        if (context.canvas.state.activeTool === "blueprint-placement" && context.canvas.editor !== null) {
          cancelBlueprintPlacement(context.canvas, context.canvas.editor);
          return { status: "handled" };
        }
        context.canvas.actions.setActiveTool("select");
        return { status: "handled" };
      },
    }],
    handle(event, context) {
      // AI-REMOVED 2026-08-30:
      // Reason: 返回选择模式的 Escape 已迁入固定 Shortcut Route。
      // Trigger: ST2-RQ-020 固定 Action 与输入层统一。
      // Evidence: active-tool.cancel-to-select 显式限定五种可取消工具。
      // Replacement: shortcutRoutes[active-tool.cancel-to-select] in this module
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (event.type === "key down") {
      //   if (event.code !== "Escape" && event.key !== "Escape") return { status: "ignored" };
      //   context.appHost.internalActions.setActiveTool("select");
      //   return { status: "handled" };
      // }

      if (event.type === "ui-button-touch-tap" || event.type === "ui-button-mouse-tap") {
        if (event.uiButtonId !== "placement-tool-select") {
          return { status: "ignored" };
        }

        if (event.type === "ui-button-mouse-tap" && event.button !== 0) {
          return { status: "ignored" };
        }

        context.canvas.actions.setActiveTool("select");
        return { status: "handled" };
      }

      if (event.type === "on-exit-active-tool") {
        if (event.from !== "select" || event.to === "select") {
          return { status: "ignored" };
        }

        context.canvas.actions.hideCanvasFloatingToolbar();
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "select") {
          return { status: "ignored" };
        }

        context.canvas.actions.hideCanvasFloatingToolbar();
        return { status: "handled" };
      }

      const editor = context.canvas.editor;
      if (editor === null || context.canvas.state.activeTool !== "select") {
        return { status: "ignored" };
      }

      const revealInspector = () => {
        if (!context.canvas.canUseWorkbenchActions || !context.canvas.isOperationEnabled("open-inspector")) return;
        // AI-REMOVED 2026-09-26:
        // Reason: 音效运行时提取为独立 Audio 模块，App 仅保留 UI 与真实手势入口。
        // Trigger: 用户授权模块重构并逐项确认 AudioAction、AudioContract 和 WorkspaceContract.audio。
        // Evidence: 原 AppHost 持有控制器，WorkbenchApp effect 管理播放订阅生命周期。
        // Replacement: WorkspaceContract.audio.actions.playDeviceInspector(entityId)
        // Risk: 需验证手势解锁、单实例生命周期及销毁后的迟到任务。
        // Human Review: Required
        // Original code:
        // context.appHost.deviceAudio.playInspector();
        const selection = editor.state.collections.selection;
        if (selection.length === 1) {
          context.canvas.workbench.workspace.audio?.actions.playDeviceInspector(selection[0]!);
        }
        if (context.canvas.workbench.state.settings.gameUseInspectorPanel) {
          context.canvas.workbench.internalActions.setRightDockActiveTab("selection");
          if (!context.canvas.workbench.internalState.workbench.rightDockOpen) {
            context.canvas.workbench.internalActions.toggleRightDock();
          }
          return;
        }

        context.canvas.workbench.internalActions.openDialog("inspector");
      };

      const selectEntity = (options: {
        entityId: string;
        definitionId: string;
      }) => {
        const selection = editor.state.collections.selection;
        const openInspectorOnSecondClick =
          context.canvas.workbench.state.settings.hypergryphInspectorOpenOnSecondClick;

        if (selection.length === 1 && selection.contains(options.entityId)) {
          if (openInspectorOnSecondClick) {
            revealInspector();
            return;
          }

          clearSelection();
          return;
        }

        context.canvas.workbench.internalActions.setAttachmentFocus(null);

        if (!selection.contains(options.entityId)) {
          editor.actions.clearCollection(EntityCollectionType.selection);
        }

        editor.actions.addToCollection({
          collectionType: EntityCollectionType.selection,
          entityId: options.entityId,
        });

        if (
          context.canvas.canUseWorkbenchActions && context.canvas.workbench.state.settings.gameUseInspectorPanel
          && context.canvas.workbench.state.settings.hypergryphSelectionRightDockSync
          && !openInspectorOnSecondClick
        ) {
          context.canvas.workbench.internalActions.setRightDockActiveTab("selection");
          if (!context.canvas.workbench.internalState.workbench.rightDockOpen) {
            context.canvas.workbench.internalActions.toggleRightDock();
          }
        }
      };

      const clearSelection = () => {
        editor.actions.clearCollection(EntityCollectionType.selection);
        context.canvas.workbench.internalActions.setAttachmentFocus(null);
        context.canvas.actions.hideCanvasFloatingToolbar();

        if (
          context.canvas.canUseWorkbenchActions && context.canvas.workbench.state.settings.gameUseInspectorPanel
          && context.canvas.workbench.internalState.workbench.rightDockOpen
        ) {
          context.canvas.workbench.internalActions.toggleRightDock();
        }
      };

      const focusAttachment = (reference: SceneAttachmentReference) => {
        const current = context.canvas.workbench.internalState.runtime.attachmentFocus;
        if (current !== null && current.documentKey === reference.documentKey
          && current.regionId === reference.regionId) {
          revealInspector();
          return;
        }
        editor.actions.clearCollection(EntityCollectionType.selection);
        context.canvas.actions.hideCanvasFloatingToolbar();
        context.canvas.workbench.internalActions.setAttachmentFocus(reference);
        revealInspector();
      };

      const openSelectMenuIfNeeded = (options: {
        position: ClientPixelPoint;
        pointerEntity: WorldEntity | null;
        regions: readonly PeriodicRangeRegion[];
      }): boolean => {
        const entities = resolveOverlappingEntityCandidatesAtClientPoint({
          canvas: context.canvas,
          editor,
          position: options.position,
          pointerEntity: options.pointerEntity,
        });
        const entityCandidates = (entities.length === 0 && options.pointerEntity !== null
          ? [options.pointerEntity] : entities).map(createOverlapEntityCandidate);
        const attachmentCandidates = options.regions.map((region) => ({
          kind: "attachment" as const,
          id: `attachment:${region.regionId}`,
          reference: createSceneAttachmentReference(region),
          labelKey: PERIODIC_RANGE_ATTACHMENT_LABEL_KEY,
          iconPath: PERIODIC_RANGE_ATTACHMENT_ICON_PATH,
        }));
        const candidates: OverlapMenuCandidate[] = [...entityCandidates, ...attachmentCandidates];
        if (candidates.length > 1) {
          return openOverlapMenuForCandidates({
            canvas: context.canvas,
            position: options.position,
            candidates,
            onSelect: (candidate) => {
              if (candidate.kind === "entity") {
                const entity = editor.queries.getEntityById(candidate.entityId);
                if (entity !== null) {
                  selectEntity({ entityId: entity.id, definitionId: entity.definitionId });
                }
                return;
              }
              const region = resolvePeriodicRangeRegionByReference({
                appHost: context.canvas.workbench,
                editor,
                reference: candidate.reference,
              });
              if (region === null) {
                context.canvas.workbench.internalActions.setAttachmentFocus(null);
                return;
              }
              focusAttachment(createSceneAttachmentReference(region));
            },
          });
        }
        const only = candidates[0];
        if (only === undefined) return false;
        if (only.kind === "entity") {
          const entity = editor.queries.getEntityById(only.entityId);
          if (entity !== null) selectEntity({ entityId: entity.id, definitionId: entity.definitionId });
        } else {
          focusAttachment(only.reference);
        }
        return true;
      };

      switch (event.type) {
        case "mouse move": {
          if (editor.state.collections.selection.length === 0) {
            editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          } else {
            editor.actions.clearHoverPoint();
          }
          return { status: "handled", consume: false };
        }

        case "mouse tap": {
          if (event.button === 2) {
            clearSelection();
            return { status: "handled" };
          }

          if (event.button !== 0) {
            return { status: "ignored" };
          }

          const regions = resolvePeriodicRangeAttachmentCandidatesAtClientPoint({
            canvas: context.canvas,
            appHost: context.canvas.workbench,
            editor,
            position: event.position,
          });
          if (openSelectMenuIfNeeded({
            position: event.position,
            pointerEntity: event.pointerEntity,
            regions,
          })) {
            return { status: "handled" };
          }

          // 空白点击只取消附属实体查看；无焦点时保持既有的不处理语义。
          if (context.canvas.workbench.internalState.runtime.attachmentFocus !== null) {
            clearSelection();
            return { status: "handled" };
          }
          return { status: "ignored" };
        }

        case "touch tap": {
          const regions = resolvePeriodicRangeAttachmentCandidatesAtClientPoint({
            canvas: context.canvas,
            appHost: context.canvas.workbench,
            editor,
            position: event.position,
          });
          if (openSelectMenuIfNeeded({
            position: event.position,
            pointerEntity: event.pointerEntity,
            regions,
          })) {
            return { status: "handled" };
          }

          if (context.canvas.workbench.internalState.runtime.attachmentFocus !== null) {
            clearSelection();
            return { status: "handled" };
          }
          return { status: "ignored" };
        }

        default:
          return { status: "ignored" };
      }
    },
  };
}
