import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { TestInfo } from "playwright/test";

export type TimingPhase = { name: string; ms: number };

// 2026-11-24：E2E 步骤计时只写入运行产物，不改变测试行为；阶段命名用于汇总
// fixture、页面生命周期、取证与 playwright-cli 调用的真实耗时。
export class TestTiming {
  private readonly phases: TimingPhase[] = [];
  private readonly startedAt = performance.now();

  async measure<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
    const start = performance.now();
    try {
      return await operation();
    } finally {
      this.phase(name, performance.now() - start);
    }
  }

  phase(name: string, milliseconds: number): void {
    this.phases.push({ name, ms: Math.round(milliseconds * 10) / 10 });
  }

  async write(info: TestInfo): Promise<void> {
    const totalMs = performance.now() - this.startedAt;
    const phasesMs = this.phases.reduce((total, phase) => total + phase.ms, 0);
    const entry = {
      title: info.titlePath.join(" › "),
      file: info.file,
      retry: info.retry,
      status: info.status,
      totalMs: Math.round(totalMs),
      phasesMs: Math.round(phasesMs),
      unaccountedMs: Math.round(Math.max(0, totalMs - phasesMs)),
      phases: this.phases,
    };
    const line = JSON.stringify(entry);
    await appendFile(resolve(info.project.outputDir, "timing.jsonl"), `${line}\n`, "utf8")
      .catch(error => console.warn(`E2E 计时写入失败：${String(error)}`));
    console.log(`[E2E-TIMING] ${line}`);
  }
}
