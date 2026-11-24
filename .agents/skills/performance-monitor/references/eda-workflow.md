# EDA 性能流程

EDA perf 只测吞吐和阶段耗时，不替代 `npm run test:eda` 的面积、首解和产出质量回归。

## 场景

场景定义在 `scripts/perf/eda-scenarios.json`，输入复用 `src/shared/eda-regression/cases.json` 的固定用例，不复制任务 JSON。

| 场景 | 用例 | 模式 | 说明 |
|---|---|---|---|
| `cuprium-200k` | `cuprium-canister-30-2s` | CPU core | 气态赤铜基线，无反应池 |
| `filter-core-200k` | `filter-core-120-2s` | CPU core | 分离芯共享供料基线 |
| `amethyst-200k` | `amethyst-cuprium-solution-30-2s` | CPU core | 含普通反应池 `mix_pool_1` |
| `cuprium-browser-200k` | `cuprium-canister-30-2s` | GPU browser | 真实硬件 WebGPU |
| `amethyst-browser-200k` | `amethyst-cuprium-solution-30-2s` | GPU browser | 含反应池的真实 GPU 场景 |

场景固定 `dense-v2` / 2 TPS。新增场景优先复用现有 EDA case；不要为 perf 新造任务文件，也不要把 perf 预算改成质量门槛。

## CPU 单核基线

```bash
npm run perf -- eda --mode core --scenario amethyst-200k -n 3 --affinity 0
```

- core 模式使用 Node 单 Worker，纯 CPU。
- `--affinity 0` 通过 `taskset` 绑定单核；Windows 不支持，会被忽略。
- 正式基线要求工作区干净。开发验证可加 `--allow-dirty`，结果带 `+WT`。
- `--evaluations` 和 `--attempts` 可覆盖场景预算与尝试次数；覆盖后不能与默认场景结果直接比较。

## GPU 浏览器基线

```bash
npm run perf -- eda --mode browser --scenario amethyst-browser-200k -n 1
```

- 必须有界面浏览器和真实硬件 WebGPU；Linux 无 `DISPLAY` 会直接拒绝。
- 无 adapter 或 `isFallbackAdapter === true` 时直接失败，不会静默改测 CPU。
- 默认由脚本启动 `127.0.0.1:4176` 专用服务；可用 `--url` 连接已有服务。
- Windows 默认使用 `msedge`；可用 `--browser chromium|chrome|msedge` 指定。
- Windows 不要传 `--affinity`。

## 指标

| 指标 | 含义 |
|---|---|
| `evaluations` | 实际提案数，不是预算上限 |
| `searchMs` | 算法生成与搜索耗时 |
| `verificationMs` | Dense 仿真验收耗时 |
| `schedulerMs` | 墙钟中未被搜索或验收覆盖的部分 |
| `searchEvaluationsPerSecond` | 纯搜索吞吐 |
| `evaluationsPerSecond` | 总吞吐，分母包含验证 |
| `wallMsCv` | 墙钟变异系数，用于判断样本稳定性 |

成功返回会提前结束单次 attempt；后续 attempt 可能只消耗 1～6 次续搜。比较时必须同时看实际提案数、`searchMs` 和 `searchEvaluationsPerSecond`。

## 当前开发基线

2026-11-24，单核 `affinity: 0`，`+WT`，3 次中位数，仅作开发参考：

| 场景 | 实际提案 | 墙钟 | 总提案/s | 搜索提案/s | search | verify | CV |
|---|---:|---:|---:|---:|---:|---:|---:|
| `cuprium-200k` | 36,259 | 29,720.6 ms | 1,242 | 4,113 | 8,815.1 ms | 20,305.5 ms | 1.4% |
| `amethyst-200k` | 36,253 | 34,990.7 ms | 1,048 | 2,727 | 13,293.8 ms | 21,493.0 ms | 0.6% |

这不是正式基线；提交后需重新运行。

## 比较

```bash
npm run perf -- compare .temp/perf/runs/<baseline> .temp/perf/runs/<current>
```

`compare` 会拒绝 suite、场景、模式、affinity、GPU 状态或场景参数不一致的结果。不要用跨机器、跨并发或跨 GPU 的数字直接比较。
