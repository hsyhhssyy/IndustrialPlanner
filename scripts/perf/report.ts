import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PerfRun, PerfRunSummary, PerfSample } from "./types";

export const PERF_ROOT = ".temp/perf";

export function createRunId(suite: string, scenario: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${suite}-${scenario}`;
}

export function createRunDirectory(runId: string): string {
  const directory = resolve(PERF_ROOT, "runs", runId);
  mkdirSync(resolve(directory, "samples"), { recursive: true });
  return directory;
}

export function writeRun(directory: string, run: PerfRun): void {
  writeFileSync(resolve(directory, "run.json"), JSON.stringify(run, null, 2) + "\n", "utf8");
  writeFileSync(resolve(directory, "summary.json"), JSON.stringify({
    formatVersion: run.formatVersion,
    runId: run.runId,
    suite: run.suite,
    scenario: run.scenario,
    commit: run.commit,
    dirty: run.dirty,
    options: run.options,
    environment: run.environment,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    samples: run.samples,
  }, null, 2) + "\n", "utf8");
}

export function readRun(path: string): PerfRun {
  const file = path.endsWith(".json") ? resolve(path) : resolve(path, "summary.json");
  if (!existsSync(file)) throw new Error(`找不到性能结果：${file}`);
  return JSON.parse(readFileSync(file, "utf8")) as PerfRun;
}

function values(samples: readonly PerfSample[], pick: (sample: PerfSample) => number | null): number[] {
  return samples.map(pick).filter((value): value is number => value !== null && Number.isFinite(value));
}

export function median(input: readonly number[]): number | null {
  if (input.length === 0) return null;
  const sorted = [...input].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function coefficientOfVariation(input: readonly number[]): number | null {
  if (input.length < 2) return null;
  const average = input.reduce((sum, value) => sum + value, 0) / input.length;
  if (average === 0) return null;
  const variance = input.reduce((sum, value) => sum + (value - average) ** 2, 0) / input.length;
  return Math.sqrt(variance) / average;
}

export function summarize(samples: readonly PerfSample[]): PerfRunSummary {
  const successful = samples.filter(sample => sample.error === null);
  const wallValues = values(successful, sample => sample.wallMs);
  return {
    wallMsMedian: median(wallValues),
    activeMsMedian: median(values(successful, sample => sample.activeMs)),
    evaluationsMedian: median(values(successful, sample => sample.evaluations)),
    evaluationsPerSecondMedian: median(values(successful, sample => sample.evaluationsPerSecond)),
    searchEvaluationsPerSecondMedian: median(values(successful, sample => sample.searchEvaluationsPerSecond)),
    searchMsMedian: median(values(successful, sample => sample.phases?.searchMs ?? null)),
    verificationMsMedian: median(values(successful, sample => sample.phases?.verificationMs ?? null)),
    schedulerMsMedian: median(values(successful, sample => sample.phases?.schedulerMs ?? null)),
    wallMsCv: coefficientOfVariation(wallValues),
  };
}

export function appendMarkdownRow(file: string, row: string, header: string): void {
  const target = resolve(PERF_ROOT, file);
  mkdirSync(resolve(PERF_ROOT), { recursive: true });
  if (!existsSync(target)) appendFileSync(target, header, "utf8");
  appendFileSync(target, row, "utf8");
}

export function formatNumber(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}
