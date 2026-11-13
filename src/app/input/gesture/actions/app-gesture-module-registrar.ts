import type { AppHost } from "@/app/host/app-host";
import type { CanvasInteractionController } from "@/app/canvas";
import type { CanvasOperationId } from "@/domain/shared/canvas-operation";
import type { GestureMappingModule } from "./types";
import {
  type GestureDiagnosticsStore,
  createGestureDiagnosticsModule,
} from "@/app/input/gesture/diagnostics";
import type { GestureActionRouter } from "./gesture-action-router";
import {
  createHypergryphBlueprintPlacementGestureModule,
} from "./hypergryph/hypergryph-blueprint-placement-gesture-module";
import {
  createHypergryphDeleteSelectionGestureModule,
} from "./hypergryph/hypergryph-delete-selection-gesture-module";
import {
  createHypergryphDarkPipeLinkGestureModule,
} from "./hypergryph/hypergryph-dark-pipe-link-gesture-module";
import {
  createHypergryphEntityVariantSwitchGestureModule,
} from "./hypergryph/hypergryph-entity-variant-switch-gesture-module";
import {
  bindLogisticsPlacementAlert,
  createHypergryphLogisticsPlacementGestureModule,
} from "./hypergryph/hypergryph-logistics-placement-gesture-module";
import {
  createHypergryphMarqueeGestureModule,
} from "./hypergryph/hypergryph-marquee-gesture-module";
import {
  createHypergryphRegionGestureModule,
} from "./hypergryph/hypergryph-region-gesture-module";
import {
  createHypergryphMoveGestureModule,
} from "./hypergryph/hypergryph-move-gesture-module";
import {
  createHypergryphOverlapEntityMenuGuardModule,
} from "./hypergryph/hypergryph-overlap-entity-menu-guard";
import {
  createHypergryphSinglePlacementGestureModule,
} from "./hypergryph/hypergryph-single-placement-gesture-module";
import { createHypergryphSaveBlueprintGestureModule } from "./hypergryph/hypergryph-save-blueprint-gesture-module";
import { createHypergryphMouseViewportPanModule } from "./hypergryph/hypergryph-mouse-viewport-pan-module";
import { createHypergryphKeyboardViewportPanModule } from "./hypergryph/hypergryph-keyboard-viewport-pan-module";
import {
  createHypergryphSelectGestureModule,
} from "./hypergryph/hypergryph-select-gesture-module";
import { createHypergryphViewportZoomModule } from "./hypergryph/hypergryph-viewport-zoom-module";
import { createHypergryphViewportRotationModule } from "./hypergryph/hypergryph-viewport-rotation-module";
import { createHypergryphHistoryGestureModule } from "./hypergryph/hypergryph-history-gesture-module";
import { createPanelToggleGestureModule } from "./panel-toggle-gesture-module";
import { createQuickPlaceGestureModule } from "./quick-place-gesture-module";
import { createSimulationControlGestureModule } from "./simulation-control-gesture-module";
import { createToolboxOpenGestureModule } from "./toolbox-open-gesture-module";

export interface AppGestureModuleRegistrarOptions {
  readonly readOnly?: boolean;
  readonly canvas: CanvasInteractionController;
  readonly router: GestureActionRouter<AppHost>;
  readonly gestureDiagnostics: GestureDiagnosticsStore;
}

export class AppGestureModuleRegistrar {
  private readonly unregisterModules: Array<() => void> = [];
  private disposed = false;

  public constructor(options: AppGestureModuleRegistrarOptions) {
    if (options.readOnly) {
      this.unregisterModules.push(
        options.router.registerModule(createHypergryphMouseViewportPanModule()),
        options.router.registerModule(createHypergryphKeyboardViewportPanModule()),
        options.router.registerModule(createHypergryphViewportZoomModule()),
      );
      return;
    }
    // AI-REMOVED 2026-11-12:
    // Reason: 每张画布仅注册自身支持的操作，EDA 不取得工作台功能。
    // Trigger: REQ-048 操作资格统一。
    // Evidence: 原清单无条件包含蓝图、仿真、面板等入口。
    // Replacement: 下方按 CanvasOperationId 注册。
    // Risk: 需检查快捷键冲突及指针修饰键旁路。
    // Human Review: Required
    // Original code:
    //     this.unregisterModules.push(
    //       bindLogisticsPlacementAlert(options.appHost.mainCanvas),
    //       options.router.registerModule(createHypergryphOverlapEntityMenuGuardModule()),
    //       options.router.registerModule(createHypergryphBlueprintPlacementGestureModule()),
    //       options.router.registerModule(createHypergryphLogisticsPlacementGestureModule()),
    //       options.router.registerModule(createHypergryphSinglePlacementGestureModule()),
    //       options.router.registerModule(createHypergryphMoveGestureModule()),
    //       options.router.registerModule(createHypergryphRegionGestureModule()),
    //       options.router.registerModule(createHypergryphMarqueeGestureModule()),
    //       options.router.registerModule(createHypergryphDarkPipeLinkGestureModule()),
    //       options.router.registerModule(createHypergryphSelectGestureModule()),
    //       options.router.registerModule(createHypergryphSaveBlueprintGestureModule()),
    //       options.router.registerModule(createHypergryphEntityVariantSwitchGestureModule()),
    //       options.router.registerModule(createHypergryphDeleteSelectionGestureModule()),
    //       options.router.registerModule(createHypergryphMouseViewportPanModule()),
    //       options.router.registerModule(createHypergryphKeyboardViewportPanModule()),
    //       options.router.registerModule(createHypergryphViewportZoomModule()),
    //       options.router.registerModule(createHypergryphViewportRotationModule()),
    //       options.router.registerModule(createHypergryphHistoryGestureModule()),
    //       options.router.registerModule(createQuickPlaceGestureModule()),
    //       options.router.registerModule(createPanelToggleGestureModule()),
    //       options.router.registerModule(createSimulationControlGestureModule()),
    //       options.router.registerModule(createToolboxOpenGestureModule()),
    //       options.router.registerModule(
    //         createGestureDiagnosticsModule(options.gestureDiagnostics),
    //       ),
    //     );
    const register = (operation: CanvasOperationId, module: GestureMappingModule<AppHost>): void => {
      if (options.canvas.canUseWorkbenchActions || options.canvas.getOperationAvailability(operation).supported) {
        this.unregisterModules.push(options.router.registerModule(module));
      }
    };
    register("select", createHypergryphOverlapEntityMenuGuardModule());
    register("blueprint-placement", createHypergryphBlueprintPlacementGestureModule());
    register("logistics-placement", createHypergryphLogisticsPlacementGestureModule());
    if (options.canvas.canUseWorkbenchActions || options.canvas.getOperationAvailability("logistics-placement").supported) {
      this.unregisterModules.push(bindLogisticsPlacementAlert(options.canvas));
    }
    register("confirm-placement", createHypergryphSinglePlacementGestureModule());
    register("move", createHypergryphMoveGestureModule());
    register("region-edit", createHypergryphRegionGestureModule());
    register("marquee-select", createHypergryphMarqueeGestureModule());
    register("configure-device", createHypergryphDarkPipeLinkGestureModule());
    register("select", createHypergryphSelectGestureModule());
    register("save-blueprint", createHypergryphSaveBlueprintGestureModule());
    register("switch-device-variant", createHypergryphEntityVariantSwitchGestureModule());
    register("delete", createHypergryphDeleteSelectionGestureModule());
    register("pan-viewport", createHypergryphMouseViewportPanModule());
    register("pan-viewport", createHypergryphKeyboardViewportPanModule());
    register("zoom-viewport", createHypergryphViewportZoomModule());
    register("rotate-viewport", createHypergryphViewportRotationModule());
    register("undo", createHypergryphHistoryGestureModule());
    register("quick-place", createQuickPlaceGestureModule());
    if (options.canvas.canUseWorkbenchActions) {
      this.unregisterModules.push(options.router.registerModule(createPanelToggleGestureModule()),
        options.router.registerModule(createSimulationControlGestureModule()),
        options.router.registerModule(createToolboxOpenGestureModule()));
    }
    this.unregisterModules.push(options.router.registerModule(createGestureDiagnosticsModule(options.gestureDiagnostics)));
    options.router.assertShortcutRouteIntegrity({ requireAllActions: options.canvas.canUseWorkbenchActions });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    while (this.unregisterModules.length > 0) {
      this.unregisterModules.pop()?.();
    }
  }
}
