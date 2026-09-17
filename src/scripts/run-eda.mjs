import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const options = { engineKind: "dense-v2" };
let plan = "src/tests/blueprint-planner/fixtures/pyrrolite-nugget.json";
const numbers = { "--local-evaluations": "localEvaluations", "--width": "width", "--height": "height", "--attempts": "attempts", "--seconds": "seconds", "--start-variant": "startVariant", "--candidate-seconds": "candidateSeconds", "--verification-seconds": "verificationSeconds" };
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1];
  if (key === "--help") {
    console.log("npm run test:eda -- --plan <配置.json> (--attempts X | --seconds X) [--profile 参数.json] [--local-evaluations X] [--width W --height H] [--engine dense-v2] [--start-variant N] [--candidate-seconds X] [--verification-seconds X]；固定 Dense 2 tick/秒");
    process.exit(0);
  }
  if (value === undefined) throw new Error(`缺少参数值：${key}`);
  if (key === "--plan") plan = value;
  else if (key === "--profile") {
    const input = JSON.parse(readFileSync(value, "utf8"));
    options.profile = input.profile ?? input;
  }
  else if (key === "--engine") {
    if (value !== "dense-v2") throw new Error("EDA 测试固定使用 dense-v2 引擎、2 tick/秒。");
    options.engineKind = value;
  } else if (key in numbers) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < (key === "--start-variant" ? 0 : Number.MIN_VALUE)
      || (["--attempts", "--start-variant"].includes(key) && !Number.isInteger(number))) throw new Error(`无效参数：${key}`);
    options[numbers[key]] = number;
  } else throw new Error(`未知参数：${key}`);
}
if (options.attempts !== undefined && options.seconds !== undefined) throw new Error("attempts 与 seconds 二选一。");
if (options.attempts === undefined && options.seconds === undefined) options.attempts = 1;
const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "eda"], {
  stdio: "inherit", env: { ...process.env, EDA_PLAN: plan, EDA_RUN_OPTIONS: JSON.stringify(options) },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
