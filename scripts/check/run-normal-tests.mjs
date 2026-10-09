import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const vitestEntry = resolve(root, "node_modules/vitest/vitest.mjs");
const evidenceParent = resolve(root, ".temp/full-check/normal-tests");
const timeoutMessage = /(?:^|\n)(?:Error: )?(?:Test|Hook) timed out in \d+ms\./u;
const workerStartTimeout = /^\[vitest-pool\]: Timeout starting (?:forks|threads) runner\.$/u;
const workerStartFailure = /^\[vitest-pool\]: Failed to start (?:forks|threads) worker for test files (.+)\.$/u;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function resultPaths(directory, label) {
  return {
    report: resolve(directory, `${label}.json`),
    metadata: resolve(directory, `${label}.metadata.json`),
  };
}

function timeoutTargets(report) {
  const targets = [];
  const otherFailures = [];
  let failedCount = 0;
  for (const file of report.testResults) {
    const failed = file.assertionResults.filter(test => test.status === "failed");
    failedCount += failed.length;
    if (file.status === "failed" && (file.message || failed.length === 0)) {
      otherFailures.push(`${file.name}: ${file.message || "file-level failure"}`);
    }
    for (const test of failed) {
      const target = { file: file.name, name: test.fullName };
      const duplicateNames = file.assertionResults.filter(entry => entry.fullName === test.fullName).length > 1;
      if (!duplicateNames && test.failureMessages.length > 0 && test.failureMessages.every(message => timeoutMessage.test(message))) {
        targets.push(target);
      } else {
        otherFailures.push(`${file.name} > ${test.fullName}`);
      }
    }
  }
  if (report.numFailedTests !== failedCount) {
    otherFailures.push("Vitest JSON failed-test count does not match assertion results");
  }
  return { targets, otherFailures };
}

function missingWorkerTimeoutFiles(metadata) {
  const requested = metadata.requestedFiles;
  const completed = metadata.completedFiles;
  if (!Array.isArray(requested) || !Array.isArray(completed)) {
    return { files: [], otherErrors: ["Vitest metadata is missing its file inventory", ...metadata.unhandledErrors.map(error => `Unhandled: ${error.message}`)] };
  }
  const completedSet = new Set(completed);
  const missing = [...new Set(requested.filter(file => !completedSet.has(file)))];
  const otherErrors = [];
  let timeoutCount = 0;
  for (const error of metadata.unhandledErrors) {
    if (workerStartTimeout.test(error.message)) {
      timeoutCount++;
      continue;
    }
    const match = workerStartFailure.exec(error.message);
    if (match && /\[vitest-pool-runner\]: Timeout waiting for worker to respond/u.test(error.cause || "")) {
      const files = match[1].split(", ");
      if (files.every(file => missing.includes(file))) {
        timeoutCount++;
        continue;
      }
    }
    otherErrors.push(`Unhandled: ${error.message}`);
  }
  if (timeoutCount === 0 || missing.length === 0) {
    otherErrors.push(...metadata.unhandledErrors.filter(error => workerStartTimeout.test(error.message)).map(error => `Unhandled: ${error.message}`));
    if (missing.length > 0) otherErrors.push(`Vitest did not complete ${missing.length} collected test file(s)`);
    return { files: [], otherErrors };
  }
  return { files: missing, otherErrors };
}

function retryPattern(target) {
  const file = relative(root, target.file).replaceAll("\\", "/");
  if (!file || file.startsWith("../") || !target.name) throw new Error(`Invalid retry target: ${target.file}`);
  return `^${escapeRegex(target.name)}$`;
}

async function readResult(directory, label) {
  const paths = resultPaths(directory, label);
  return {
    report: JSON.parse(await readFile(paths.report, "utf8")),
    metadata: JSON.parse(await readFile(paths.metadata, "utf8")),
  };
}

async function runVitest(directory, label, extraArgs) {
  const paths = resultPaths(directory, label);
  const args = [
    vitestEntry, "run", "--project", "normal", ...extraArgs,
    "--reporter=default", "--reporter=json",
    "--reporter=./scripts/check/normal-test-metadata-reporter.mjs",
    `--outputFile.json=${paths.report}`,
  ];
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      // 2026-10-07：直接执行 `npm run test` 时不经过 check-runner.sh，这里同样补上 Python 的
      // UTF-8 默认值（原因见 check-runner.sh 顶部说明）；已显式设置的环境变量优先。
      env: { ...process.env, INDUSTRIAL_NORMAL_TEST_METADATA: paths.metadata,
        PYTHONUTF8: process.env.PYTHONUTF8 ?? "1",
        PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8" },
      stdio: "inherit",
    });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      done({ code, signal });
    });
  });
}

export async function runNormalTests(directory, run = runVitest) {
  const initialProcess = await run(directory, "initial", []);
  if (initialProcess.signal) throw new Error(`Initial Vitest run interrupted by ${initialProcess.signal}`);
  const initial = await readResult(directory, "initial");
  const { targets, otherFailures } = timeoutTargets(initial.report);
  const workerFailures = missingWorkerTimeoutFiles(initial.metadata);
  otherFailures.push(...workerFailures.otherErrors);
  if (initial.metadata.reason === "interrupted") otherFailures.push("Initial Vitest run was interrupted");
  if (initialProcess.code !== 0 && initialProcess.code !== 1) otherFailures.push(`Initial Vitest exit code: ${initialProcess.code}`);
  if (initialProcess.code === 0 && initial.report.success !== true) otherFailures.push("Initial Vitest exit code contradicts JSON report");
  if (initialProcess.code !== 0 && initial.report.success === true && workerFailures.files.length === 0) {
    otherFailures.push("Initial Vitest failed outside reported test cases");
  }
  if (initial.report.success === true && targets.length > 0) otherFailures.push("Initial Vitest JSON success contradicts failed tests");
  if (initial.metadata.reason !== (initial.report.success === true ? "passed" : "failed")) {
    otherFailures.push(`Initial Vitest completion reason: ${initial.metadata.reason}`);
  }
  if (initial.report.success === false && targets.length === 0 && workerFailures.files.length === 0 && otherFailures.length === 0) {
    otherFailures.push("Initial Vitest failed without identifiable failed tests");
  }

  const retries = [];
  for (const [index, target] of targets.entries()) {
    const label = `retry-${String(index + 1).padStart(3, "0")}`;
    const args = [target.file, `--testNamePattern=${retryPattern(target)}`, "--maxWorkers=1", "--maxConcurrency=1", "--no-file-parallelism"];
    console.log(`\n[normal-test retry ${index + 1}/${targets.length}] ${target.file} > ${target.name}`);
    const processResult = await run(directory, label, args);
    if (processResult.signal) throw new Error(`Vitest retry interrupted by ${processResult.signal}`);
    const { report, metadata } = await readResult(directory, label);
    const assertions = report.testResults.flatMap(file => file.assertionResults.map(test => ({ ...test, file: file.name })));
    const executed = assertions.filter(test => test.status === "passed" || test.status === "failed");
    const matched = executed.filter(test => test.file === target.file && test.fullName === target.name);
    const passed = processResult.code === 0 && report.success === true && metadata.reason === "passed"
      && metadata.unhandledErrors.length === 0 && executed.length === 1 && matched.length === 1 && matched[0].status === "passed";
    const fileErrors = report.testResults.some(file => file.status === "failed" && (file.message || !file.assertionResults.some(test => test.status === "failed")));
    const timedOut = processResult.code === 1 && report.success === false && metadata.reason === "failed" && !fileErrors
      && metadata.unhandledErrors.length === 0 && executed.length === 1 && matched.length === 1 && matched[0].status === "failed"
      && matched[0].failureMessages.length > 0 && matched[0].failureMessages.every(message => timeoutMessage.test(message));
    const status = passed ? "passed" : timedOut ? "timed-out" : "failed";
    retries.push({ ...target, status, exitCode: processResult.code });
    console.log(`[normal-test retry] ${status}: ${target.name}`);
  }

  const fileRetries = [];
  for (const [index, file] of workerFailures.files.entries()) {
    const label = `file-retry-${String(index + 1).padStart(3, "0")}`;
    console.log(`\n[normal-test file retry ${index + 1}/${workerFailures.files.length}] ${file}`);
    const processResult = await run(directory, label, [file, "--maxWorkers=1", "--maxConcurrency=1", "--no-file-parallelism"]);
    if (processResult.signal) throw new Error(`Vitest file retry interrupted by ${processResult.signal}`);
    const { report, metadata } = await readResult(directory, label);
    const onlyTargetFile = report.testResults.length === 1 && report.testResults[0].name === file;
    const passed = processResult.code === 0 && report.success === true && metadata.reason === "passed"
      && metadata.unhandledErrors.length === 0 && onlyTargetFile;
    const timeoutResult = timeoutTargets(report);
    const timedOut = processResult.code === 1 && (
      (metadata.unhandledErrors.length > 0 && missingWorkerTimeoutFiles(metadata).files.includes(file))
      || (onlyTargetFile && metadata.unhandledErrors.length === 0 && timeoutResult.targets.length > 0
        && timeoutResult.otherFailures.length === 0)
    );
    const status = passed ? "passed" : timedOut ? "timed-out" : "failed";
    fileRetries.push({ file, status, exitCode: processResult.code });
    console.log(`[normal-test file retry] ${status}: ${file}`);
  }

  const passed = otherFailures.length === 0 && retries.every(retry => retry.status === "passed")
    && fileRetries.every(retry => retry.status === "passed")
    && (initialProcess.code === 0 || retries.length > 0 || fileRetries.length > 0);
  const summary = { passed, initialExitCode: initialProcess.code, otherFailures, retries, fileRetries };
  await writeFile(resolve(directory, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  await mkdir(evidenceParent, { recursive: true });
  const directory = await mkdtemp(resolve(evidenceParent, "run-"));
  console.log(`常规测试证据: ${directory}`);
  try {
    const summary = await runNormalTests(directory);
    console.log(`常规测试结果: ${summary.passed ? "通过" : "失败"}; 用例超时复跑 ${summary.retries.length} 项; 文件级 worker 超时复跑 ${summary.fileRetries.length} 项`);
    for (const failure of summary.otherFailures) console.error(`其他失败: ${failure}`);
    process.exitCode = summary.passed ? 0 : 1;
  } catch (error) {
    console.error("常规测试调度失败:", error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
