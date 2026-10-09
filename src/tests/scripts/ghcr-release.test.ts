// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directories: string[] = [];

async function fixture() {
  const parent = resolve(".temp/.trash/ghcr-release");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, "case-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

describe("GHCR 发布渠道", () => {
  it.each([
    ["alpha", "v1.6.0.0-alpha1", "industrial-planner-alpha-private", "private", false],
    ["pre", "v1.6.0.0-pre1", "industrial-planner-beta", "public", false],
    ["beta", "v1.6.0.0-beta1", "industrial-planner-beta", "public", false],
    ["stable", "v1.6.0.0", "industrial-planner-beta", "public", true],
    ["stable", "v1.6.0.0-Patch1", "industrial-planner-beta", "public", true],
  ])("%s / %s 使用约定镜像与可见性", async (channel, tag, packageName, visibility, latest) => {
    const directory = await fixture();
    const output = resolve(directory, "output");
    const result = spawnSync("bash", [".github/scripts/ghcr-image.sh"], {
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_CHANNEL: channel,
        RELEASE_TAG: tag,
        GITHUB_OUTPUT: output,
        DEPLOY_CONFIG: JSON.stringify({ registry: "old.invalid", image_name: "old-image" }),
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const values = await readFile(output, "utf8");
    expect(values).toContain(`image=ghcr.io/hsyhhssyy/${packageName}:${tag}\n`);
    expect(values).toContain(`visibility=${visibility}\n`);
    expect(values.includes(":latest\n")).toBe(latest);
    expect(values).not.toContain("old.invalid");
  });

  it("未知渠道失败且不产生镜像输出", async () => {
    const directory = await fixture();
    const result = spawnSync("bash", [".github/scripts/ghcr-image.sh"], {
      encoding: "utf8",
      env: { ...process.env, RELEASE_CHANNEL: "unknown", RELEASE_TAG: "v1.6.0", GITHUB_OUTPUT: resolve(directory, "output") },
    });
    expect(result.status).toBe(1);
    expect(await readdir(directory)).toEqual([]);
  });
});

async function checkVisibility(status: string, body: string, expected: string, allowMissing = false, curlExit = "0") {
  const directory = await fixture();
  const bin = resolve(directory, "bin");
  await mkdir(bin);
  // 仅替换外部 HTTP 边界；实际执行正式 Bash 与 jq 校验，并确认响应文件被清理。
  await writeFile(resolve(bin, "curl"), `#!/usr/bin/env bash
set -euo pipefail
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output' ]; then
    printf '%s' "$GHCR_TEST_BODY" > "$2"
    shift
  fi
  shift
done
printf '%s' "$GHCR_TEST_STATUS"
exit "$GHCR_TEST_CURL_EXIT"
`, { mode: 0o755 });
  const result = spawnSync("bash", [".github/scripts/check-ghcr-visibility.sh", "hsyhhssyy", "fixture-package", expected, String(allowMissing)], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: "fixture-token",
      RUNNER_TEMP: directory,
      GHCR_TEST_STATUS: status,
      GHCR_TEST_BODY: body,
      GHCR_TEST_CURL_EXIT: curlExit,
    },
  });
  expect(await readdir(directory)).toEqual(["bin"]);
  return result;
}

describe("GHCR 包可见性门禁", () => {
  it.each(["public", "private"])("允许匹配的 %s 包", async (visibility) => {
    expect((await checkVisibility("200", JSON.stringify({ visibility }), visibility)).status).toBe(0);
  });

  it("禁止把 Alpha 推入已有公开包，即使允许首次创建", async () => {
    const result = await checkVisibility("200", '{"visibility":"public"}', "private", true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Alpha publishing is blocked");
  });

  it("普通包未公开时阻止部署并给出设置入口", async () => {
    const result = await checkVisibility("200", '{"visibility":"private"}', "public");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("/fixture-package/settings");
    expect(result.stderr).toContain("Change visibility → Public");
  });

  it("只在推送前允许包不存在，推送后必须可验证", async () => {
    expect((await checkVisibility("404", "{}", "private", true)).status).toBe(0);
    expect((await checkVisibility("404", "{}", "private")).status).toBe(1);
  });

  it.each(["401", "403", "500"])("HTTP %s 不能被当作待创建包放行", async (status) => {
    expect((await checkVisibility(status, "{}", "private", true)).status).toBe(1);
  });

  it.each(["{}", "not-json"])("缺失或损坏的元数据必须失败：%s", async (body) => {
    expect((await checkVisibility("200", body, "private")).status).not.toBe(0);
  });

  it("网络错误失败且清理响应文件", async () => {
    expect((await checkVisibility("000", "{}", "private", true, "7")).status).not.toBe(0);
  });
});
