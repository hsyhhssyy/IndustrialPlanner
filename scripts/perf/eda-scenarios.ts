import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { EdaPerfScenario } from "./types";

interface ScenarioFile {
  readonly formatVersion: 1;
  readonly scenarios: readonly EdaPerfScenario[];
}

export function readEdaScenarios(): readonly EdaPerfScenario[] {
  const file = resolve("scripts/perf/eda-scenarios.json");
  const value = JSON.parse(readFileSync(file, "utf8")) as ScenarioFile;
  if (value.formatVersion !== 1 || !Array.isArray(value.scenarios)) throw new Error(`EDA 性能场景格式无效：${file}`);
  return value.scenarios;
}

export function findEdaScenario(id: string): EdaPerfScenario {
  const scenario = readEdaScenarios().find(candidate => candidate.id === id);
  if (!scenario) throw new Error(`未知 EDA 性能场景：${id}`);
  return scenario;
}
