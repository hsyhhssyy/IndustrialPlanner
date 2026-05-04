import type { AppHost } from "@/app/host/app-host";
import type { GestureMappingModule } from "./types";

const SIMULATION_CONTROL_BUTTON_ID = "top-bar-simulation-control";

export function createSimulationControlGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "simulation-control-button",
    handle(event, context) {
      if (event.type !== "ui-button-touch-tap" && event.type !== "ui-button-mouse-tap") {
        return { status: "ignored" };
      }

      if (event.uiButtonId !== SIMULATION_CONTROL_BUTTON_ID) {
        return { status: "ignored" };
      }

      if (event.type === "ui-button-mouse-tap" && event.button !== 0) {
        return { status: "ignored" };
      }

      const simulation = context.workspace.simulation;
      if (simulation === null) {
        return { status: "ignored" };
      }

      if (simulation.state === "start") {
        simulation.actions.pause();
        return { status: "handled" };
      }

      void simulation.actions.start();
      return { status: "handled" };
    },
  };
}