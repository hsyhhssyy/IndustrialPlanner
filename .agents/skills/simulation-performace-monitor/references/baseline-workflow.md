# 性能基线流程

## 正式基线

1. 检查工作区：

```bash
git status --porcelain
```

2. 如果存在未提交改动，停止并通知用户先提交代码。只有用户明确要求快速验证时才能改用快速模式。
3. 工作区干净时运行：

```bash
npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts
```

该脚本使用蓝图 7 核息壤运行到 3600 tick，重复 10 次取平均值，并把结果记录到 `.temp/sim-perf.md`。向用户汇报脚本输出的耗时摘要。

## 快速验证模式

用户明确要求在未提交改动上快速验证性能变化时，运行：

```bash
npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts -n 1
```

快速模式只执行一次迭代并跳过未提交改动拦截。写入 `.temp/sim-perf.md` 时，SHA 列标记为 `+WT`；详细日志仍写入 `.temp/sim-perf/runs/<RunID>/run-1.console.log`。不得把该结果当作正式基线。
