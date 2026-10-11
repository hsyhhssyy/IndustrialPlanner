// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

it.each([
  { contract: 0, browser: 0, expected: "0" },
  { contract: 7, browser: 0, expected: "1" },
  { contract: 0, browser: 5, expected: "5" },
])("检查调度依次执行远端契约和浏览器，保留任一失败：$contract/$browser", async ({ contract, browser, expected }) => {
  const parent = resolve(".temp/.trash/check-runner-contract");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, "e2e-"));
  directories.push(directory);
  const bin = resolve(directory, "bin");
  await mkdir(bin);
  // 调度边界使用进程夹具，不访问公网，也不启动真实浏览器。
  await writeFile(resolve(bin, "npm"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CHECK_TEST_DISPATCH_LOG"
case "$*" in
  "run test:contract") exit "$CHECK_TEST_CONTRACT_STATUS" ;;
  "run test:e2e") exit "$CHECK_TEST_BROWSER_STATUS" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  const dispatch = resolve(directory, "dispatch.log");
  const result = spawnSync("bash", ["scripts/check/check-runner.sh", "e2e", directory], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      CHECK_TEST_DISPATCH_LOG: dispatch, CHECK_TEST_CONTRACT_STATUS: String(contract), CHECK_TEST_BROWSER_STATUS: String(browser) },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect((await readFile(dispatch, "utf8")).trim().split("\n")).toEqual(["run test:contract", "run test:e2e"]);
  expect((await readFile(resolve(directory, "contract.exit"), "utf8")).trim()).toBe(String(contract));
  expect((await readFile(resolve(directory, "e2e.exit"), "utf8")).trim()).toBe(expected);
});
