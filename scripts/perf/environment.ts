import { execSync } from "node:child_process";
import { availableParallelism, cpus, totalmem } from "node:os";

import type { PerfEnvironment, PerfGpuInfo } from "./types";

export function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function hasUncommittedChanges(): boolean {
  try {
    return execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
  } catch {
    return false;
  }
}

export function collectEnvironment(affinity: number | null, gpu: PerfGpuInfo | null): PerfEnvironment {
  return {
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpus: cpus().length,
    availableParallelism: availableParallelism(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
    affinity,
    gpu,
  };
}
