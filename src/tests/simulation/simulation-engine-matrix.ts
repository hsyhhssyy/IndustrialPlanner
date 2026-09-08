import { describe } from "vitest";

import {
  SUPPORTED_SIMULATION_ENGINE_KINDS,
  type SimulationEngineKind,
} from "@/simulation/simulation-host";

export const SIMULATION_ENGINE_MATRIX = SUPPORTED_SIMULATION_ENGINE_KINDS;

export function describeSimulationEngineMatrix(
  name: string,
  suite: (engineKind: SimulationEngineKind) => void,
): void {
  describe.each(SIMULATION_ENGINE_MATRIX)(`${name} [%s]`, (engineKind) => {
    suite(engineKind);
  });
}
