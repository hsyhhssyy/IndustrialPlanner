import type { AppHost } from "@/app/host/app-host";
import {
  type GestureDiagnosticsStore,
} from "@/app/input/gesture/diagnostics";
import type { GestureActionRouter } from "./gesture-action-router";
import { createHypergryphGestureDiagnosticsModule } from "./hypergryph/hypergryph-gesture-diagnostics-module";
import {
  createHypergryphLogisticsPlacementGestureModule,
  hookLogisticsPlacementToolCleanupFallback,
} from "./hypergryph/hypergryph-logistics-placement-gesture-module";
import {
  createHypergryphMarqueeGestureModule,
  hookMarqueeToolCleanupFallback,
} from "./hypergryph/hypergryph-marquee-gesture-module";
import {
  createHypergryphMoveGestureModule,
  hookMoveToolCleanupFallback,
} from "./hypergryph/hypergryph-move-gesture-module";
import {
  createHypergryphSinglePlacementGestureModule,
  hookSinglePlacementToolCleanupFallback,
} from "./hypergryph/hypergryph-single-placement-gesture-module";
import { createHypergryphMouseViewportPanModule } from "./hypergryph/hypergryph-mouse-viewport-pan-module";
import { createHypergryphSelectGestureModule } from "./hypergryph/hypergryph-select-gesture-module";
import { createHypergryphSelectToolButtonModule } from "./hypergryph/hypergryph-select-tool-button-module";
import { createHypergryphViewportZoomModule } from "./hypergryph/hypergryph-viewport-zoom-module";

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
      hookLogisticsPlacementToolCleanupFallback(options.appHost),
      hookMoveToolCleanupFallback(options.appHost),
      hookSinglePlacementToolCleanupFallback(options.appHost),
      hookMarqueeToolCleanupFallback(options.appHost),
      options.router.registerModule(createHypergryphLogisticsPlacementGestureModule()),
      options.router.registerModule(createHypergryphSinglePlacementGestureModule()),
      options.router.registerModule(createHypergryphMoveGestureModule()),
      options.router.registerModule(createHypergryphMarqueeGestureModule()),
      options.router.registerModule(createHypergryphSelectGestureModule()),
      options.router.registerModule(createHypergryphMouseViewportPanModule()),
      options.router.registerModule(createHypergryphViewportZoomModule()),
      options.router.registerModule(createHypergryphSelectToolButtonModule()),
      options.router.registerModule(
        createHypergryphGestureDiagnosticsModule(options.gestureDiagnostics),
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
