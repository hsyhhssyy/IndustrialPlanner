import {
  SUPPORTED_SIMULATION_ENGINE_KINDS,
  type SimulationEngineKind,
} from "../../src/simulation/simulation-host";

/** 由技能核对应用默认值后显式传入，禁止回落到测试工具的默认引擎。 */
export function requirePerformanceEngineKind(configured: string | undefined): SimulationEngineKind {
  const engineKind = SUPPORTED_SIMULATION_ENGINE_KINDS.find(candidate => candidate === configured);
  if (engineKind === undefined) {
    throw new Error(
      `必须通过 SIMULATION_TEST_ENGINE 显式指定应用当前默认引擎；允许值：${SUPPORTED_SIMULATION_ENGINE_KINDS.join(", ")}；收到：${JSON.stringify(configured) ?? "undefined"}`,
    );
  }
  return engineKind;
}
