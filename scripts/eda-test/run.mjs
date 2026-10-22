import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const cases = JSON.parse(await readFile(new URL("../../src/shared/eda-regression/cases.json", import.meta.url), "utf8"));
const args = process.argv.slice(2), environment = { ...process.env };
let selected;
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (key === "--help") {
    console.log("npm run test:eda -- [--case <id>] [--url <网页地址>] [--browser chromium|chrome|msedge]\n仅有界面浏览器，串行运行。--list 列出用例，不启动测试。远程机器也可直接打开网页，在「规划 → EDA 算法测试」点击开始。");
    process.exit(0);
  }
  if (key === "--list") { console.log(cases.map(test => `${test.id}\t${test.name}\t${test.initialArea} → ≤${test.maximumArea}\t${test.budgetMode === "milestones" ? "≤" : "<"}${test.evaluationLimit / 1e6}M${test.continuation
    ? `；次解严格缩面积且 ≤${test.continuation.maximumArea}，累计 ${test.budgetMode === "milestones" ? "=" : "<"}${test.continuation.evaluationLimit / 1e6}M` : ""}`).join("\n")); process.exit(0); }
  const value = args[++index];
  if (!value) throw new Error(`缺少参数：${key}`);
  if (key === "--case") {
    if (!cases.some(test => test.id === value)) throw new Error(`未知用例：${value}`);
    selected = value;
  } else if (key === "--url") {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("测试地址必须使用 HTTP 或 HTTPS。");
    environment.EDA_TEST_URL = url.href;
  } else if (key === "--browser") {
    if (!["chromium", "chrome", "msedge"].includes(value)) throw new Error("不支持的浏览器。");
    environment.EDA_TEST_BROWSER = value;
  } else throw new Error(`未知参数：${key}；EDA 不提供无头模式。`);
}
if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error("EDA 测试需要有界面的浏览器。请在桌面会话执行，或显式配置 DISPLAY；不会自动切换无头模式。");
const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "eda",
  ...(selected ? ["--testNamePattern", selected] : [])], { stdio: "inherit", env: environment });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", error => { console.error(error); process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
