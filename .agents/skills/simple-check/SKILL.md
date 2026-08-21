---
name: simple-check
description: 开发或修复任务完成后，用户未主动要求完整检查且未指定单一测试集时，用于自动执行基础代码质量检查；用户明确要求 full-check、完整检查、单项测试、E2E 或 Blueprint 时不得使用。
---

# 开发后基础检查

## 检查范围

按顺序执行以下检查：

1. ESLint
2. TypeScript
3. Vitest `normal` project
4. Build

不得执行 E2E（`npm run test:e2e`）或 Blueprint（`npm run test:blueprint`）。只有用户明确要求完整检查或明确点名对应测试时，才允许执行这两项。

## 执行方式

使用项目根目录作为终端工具的 `workdir`。所有步骤复用 `scripts/check/check-runner.sh`，禁止直接拼写底层 ESLint、TypeScript、Vitest 或 Build 命令。

先且仅初始化一次：

```bash
bash scripts/check/check-runner.sh init
```

记录输出的实际 `RUN_DIR`，随后分别执行：

```bash
bash scripts/check/check-runner.sh eslint "<RUN_DIR>"
bash scripts/check/check-runner.sh tsc "<RUN_DIR>"
bash scripts/check/check-runner.sh test "<RUN_DIR>"
bash scripts/check/check-runner.sh build "<RUN_DIR>"
```

- 每次终端调用只执行一条命令，不得使用命令拼接、管道或批处理。
- `test` 必须以前台命令启动。若返回可续接的会话句柄，持续续接同一进程直至完成；每次等待不超过 60 秒。
- 某一步失败后记录结果，并继续执行其余检查项。
- 不得调用脚本的 `all` 或 `summary` 子命令；两者属于完整检查流程或会把未授权测试纳入报告。
- 不得删除 `.temp/full-check/` 下的检查产物。

## 结果处理

最终仅汇报 ESLint、TypeScript、Vitest normal 和 Build 的结果，并明确说明 E2E 与 Blueprint 未执行。

如果失败由本次开发改动引起，修复后重新运行完整的 `simple-check`；如果失败与本次改动无关或无法可靠判断，报告证据和剩余风险，不得为转绿擅自修改测试断言或测试逻辑。
