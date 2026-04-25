import type { AppHost } from "@/app/app-host";
import {
  type GestureDiagnosticsStore,
} from "@/app/input/gesture-diagnostics";
import type { GestureActionRouter } from "./gesture-action-router";
import { createHypergryphGestureDiagnosticsModule } from "./hypergryph/hypergryph-gesture-diagnostics-module";
import { createHypergryphMarqueeModeToggleModule } from "./hypergryph/hypergryph-marquee-mode-toggle-module";
import { createHypergryphMoveModeToggleModule } from "./hypergryph/hypergryph-move-mode-toggle-module";
import { createHypergryphMouseViewportPanModule } from "./hypergryph/hypergryph-mouse-viewport-pan-module";
import { createHypergryphSelectToolButtonModule } from "./hypergryph/hypergryph-select-tool-button-module";
import { createHypergryphViewportZoomModule } from "./hypergryph/hypergryph-viewport-zoom-module";

export interface AppGestureModuleRegistrarOptions {
  readonly router: GestureActionRouter<AppHost>;
  readonly gestureDiagnostics: GestureDiagnosticsStore;
}

export class AppGestureModuleRegistrar {
  private readonly unregisterModules: Array<() => void> = [];
  private disposed = false;

  public constructor(options: AppGestureModuleRegistrarOptions) {
    this.unregisterModules.push(
      options.router.registerModule(createHypergryphMoveModeToggleModule()),
      options.router.registerModule(createHypergryphMouseViewportPanModule()),
      options.router.registerModule(createHypergryphViewportZoomModule()),
      options.router.registerModule(createHypergryphSelectToolButtonModule()),
      options.router.registerModule(createHypergryphMarqueeModeToggleModule()),
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