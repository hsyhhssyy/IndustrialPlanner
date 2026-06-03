import type { AppHost } from "@/app/host/app-host";
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
  createHypergryphEntityVariantSwitchGestureModule,
} from "./hypergryph/hypergryph-entity-variant-switch-gesture-module";
import {
  createHypergryphLogisticsPlacementGestureModule,
} from "./hypergryph/hypergryph-logistics-placement-gesture-module";
import {
  createHypergryphMarqueeGestureModule,
} from "./hypergryph/hypergryph-marquee-gesture-module";
import {
  createHypergryphMoveGestureModule,
} from "./hypergryph/hypergryph-move-gesture-module";
import {
  createHypergryphSinglePlacementGestureModule,
} from "./hypergryph/hypergryph-single-placement-gesture-module";
import { createHypergryphSaveBlueprintGestureModule } from "./hypergryph/hypergryph-save-blueprint-gesture-module";
import { createHypergryphMouseViewportPanModule } from "./hypergryph/hypergryph-mouse-viewport-pan-module";
import {
  createHypergryphSelectGestureModule,
} from "./hypergryph/hypergryph-select-gesture-module";
import { createHypergryphViewportZoomModule } from "./hypergryph/hypergryph-viewport-zoom-module";
import { createHypergryphViewportRotationModule } from "./hypergryph/hypergryph-viewport-rotation-module";
import { createHypergryphHistoryGestureModule } from "./hypergryph/hypergryph-history-gesture-module";
import { createPanelToggleGestureModule } from "./panel-toggle-gesture-module";
import { createSimulationControlGestureModule } from "./simulation-control-gesture-module";

export interface AppGestureModuleRegistrarOptions {
  readonly appHost: AppHost;
  readonly router: GestureActionRouter<AppHost>;
  readonly gestureDiagnostics: GestureDiagnosticsStore;
}

export class AppGestureModuleRegistrar {
  private readonly unregisterModules: Array<() => void> = [];
  private disposed = false;

  public constructor(options: AppGestureModuleRegistrarOptions) {
    this.unregisterModules.push(
      options.router.registerModule(createHypergryphBlueprintPlacementGestureModule()),
      options.router.registerModule(createHypergryphLogisticsPlacementGestureModule()),
      options.router.registerModule(createHypergryphSinglePlacementGestureModule()),
      options.router.registerModule(createHypergryphMoveGestureModule()),
      options.router.registerModule(createHypergryphMarqueeGestureModule()),
      options.router.registerModule(createHypergryphSelectGestureModule()),
      options.router.registerModule(createHypergryphSaveBlueprintGestureModule()),
      options.router.registerModule(createHypergryphEntityVariantSwitchGestureModule()),
      options.router.registerModule(createHypergryphDeleteSelectionGestureModule()),
      options.router.registerModule(createHypergryphMouseViewportPanModule()),
      options.router.registerModule(createHypergryphViewportZoomModule()),
      options.router.registerModule(createHypergryphViewportRotationModule()),
      options.router.registerModule(createHypergryphHistoryGestureModule()),
      options.router.registerModule(createPanelToggleGestureModule()),
      options.router.registerModule(createSimulationControlGestureModule()),
      options.router.registerModule(
        createGestureDiagnosticsModule(options.gestureDiagnostics),
      ),
    );
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
