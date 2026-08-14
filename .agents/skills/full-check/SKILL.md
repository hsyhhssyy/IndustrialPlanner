---
name: full-check
description: 对当前工作区执行完整的代码质量检查（eslint、tsc、test、build、e2e、test:blueprint），并以表格汇总未通过的测试。
---

请使用 `scripts/check/full-check.sh` 对当前工作区执行完整检查。所有检查命令已固化为脚本，AI 只需调用脚本的子命令，不得自行拼写检查命令。

## 测试范围强度条款

**除非用户明确给出测试集名称要求执行单一测试集，否则任何时候执行测试都必须执行完整测试**，不得自行缩小测试范围或选择性执行。

## 最高优先级命令执行规则

**每次终端调用只能执行一条命令。**

严格禁止使用任何命令拼接或批处理形式，包括但不限于：

* 禁止使用 `&&`
* 禁止使用 `||`
* 禁止使用 `;`
* 禁止使用 `|`
* 禁止使用 `{ ...; }`
* 禁止使用 `( ... )`
* 禁止使用多行 shell 脚本
* 禁止在一次终端调用里先 `cd` 再执行检查命令

如果需要切换目录，必须使用终端工具、Agent 工具或 VS Code 的 `cwd` / `workdir` / 工作目录参数，不得在命令中写 `cd`。

错误示例，禁止：

```bash
cd /home/coder/IndustrialPlanner && bash scripts/check/full-check.sh init
```

错误示例，禁止：

```bash
RUN_DIR=$(bash scripts/check/full-check.sh init) && echo "$RUN_DIR"
```

错误示例，禁止：

```bash
bash scripts/check/full-check.sh eslint "$RUN_DIR" && bash scripts/check/full-check.sh tsc "$RUN_DIR"
```

错误示例，禁止：

```bash
sleep 60 && bash scripts/check/full-check.sh poll test "$RUN_DIR"
```

正确示例：

```bash
bash scripts/check/full-check.sh init
```

正确示例：

```bash
bash scripts/check/full-check.sh eslint ".temp/full-check/实际-run-dir"
```

正确示例：

```bash
sleep 60
```

正确示例：

```bash
bash scripts/check/full-check.sh poll test ".temp/full-check/实际-run-dir"
```

## RUN_DIR 使用规则

初始化后，必须从 `init` 命令输出中提取 `RUN_DIR` 的实际路径字符串。

后续所有命令必须直接使用该实际路径字符串，不得依赖 shell 变量跨命令存在。

允许：

```bash
bash scripts/check/full-check.sh eslint ".temp/full-check/full-check-xxxxxx"
```

禁止：

```bash
bash scripts/check/full-check.sh eslint "$RUN_DIR"
```

除非当前终端调用的命令本身就是脚本要求的完整单条命令，否则不得使用变量赋值。

如果 VS Code、Copilot 或 Agent 每次终端调用都会打开新的 shell，也必须继续使用第一次 `init` 输出的 `RUN_DIR` 实际路径，不要重新执行 `init`。

整个检查流程中只能执行一次 `init`。

## 硬性要求

* 只执行检查，不要根据检查结果修改任何业务代码、测试代码或配置代码。
* 某一步失败后，必须继续执行后续检查项。
* 不得删除 `.temp/full-check/` 下的任何文件或目录。
* 不得使用 `rm`、`rmdir`、`find -delete`、`find -exec`、`ps`、`kill`、`taskkill`。
* 不要粘贴完整长日志，只输出关键失败信息和最后日志摘要。
* 最终报告必须使用中文。
* 必须按顺序执行脚本。
* 每次终端调用只能执行一条命令。
* 不得使用 `&&`、`||`、`;`、`|` 拼接多个命令。
* 不得自行拼写 eslint、tsc、test、build、test:e2e、test:blueprint 的原始命令，只能调用 `scripts/check/full-check.sh` 的子命令。
* `test`、`e2e` 和 `blueprint` 必须后台启动后用 `poll` 轮询，不可同步等待。
* `poll` 的等待间隔不得超过 60 秒。
* `sleep 60` 和 `poll` 必须拆成两次独立终端调用。
* 不得重新初始化多个 `RUN_DIR`。
* 不得依赖 `$RUN_DIR` 变量跨终端调用存在，后续命令必须使用 `RUN_DIR` 的实际路径字符串。

## 执行步骤

### 0. 初始化

执行：

```bash
bash scripts/check/full-check.sh init
```

从输出中提取并记录 `RUN_DIR` 实际路径。

后续命令中的 `<RUN_DIR>` 必须替换为该实际路径字符串。

不得使用：

```bash
RUN_DIR=$(bash scripts/check/full-check.sh init) && echo "$RUN_DIR"
```

不得重复执行初始化。

### 1. ESLint

执行：

```bash
bash scripts/check/full-check.sh eslint "<RUN_DIR>"
```

即使失败，也继续下一步。

### 2. TypeScript

执行：

```bash
bash scripts/check/full-check.sh tsc "<RUN_DIR>"
```

即使失败，也继续下一步。

### 3. Vitest 全量测试

后台启动：

```bash
bash scripts/check/full-check.sh test "<RUN_DIR>" &
```

然后轮询，直到输出显示"已完成"。

每次轮询前执行：

```bash
sleep 60
```

然后执行：

```bash
bash scripts/check/full-check.sh poll test "<RUN_DIR>"
```

注意：`sleep 60` 和 `poll` 必须分成两次终端调用，禁止写成 `sleep 60 && bash ...`。

如果 `poll` 显示尚未完成，继续重复：

```bash
sleep 60
```

```bash
bash scripts/check/full-check.sh poll test "<RUN_DIR>"
```

直到显示"已完成"。

### 4. Build

执行：

```bash
bash scripts/check/full-check.sh build "<RUN_DIR>"
```

即使失败，也继续下一步。

### 5. E2E 测试

后台启动：

```bash
bash scripts/check/full-check.sh e2e "<RUN_DIR>" &
```

然后轮询，直到输出显示"已完成"。

每次轮询前执行：

```bash
sleep 60
```

然后执行：

```bash
bash scripts/check/full-check.sh poll e2e "<RUN_DIR>"
```

注意：`sleep 60` 和 `poll` 必须分成两次终端调用，禁止写成 `sleep 60 && bash ...`。

如果 `poll` 显示尚未完成，继续重复：

```bash
sleep 60
```

```bash
bash scripts/check/full-check.sh poll e2e "<RUN_DIR>"
```

直到显示"已完成"。

### 6. Blueprint 测试

后台启动：

```bash
bash scripts/check/full-check.sh blueprint "<RUN_DIR>" &
```

然后轮询，直到输出显示"已完成"。

每次轮询前执行：

```bash
sleep 60
```

然后执行：

```bash
bash scripts/check/full-check.sh poll blueprint "<RUN_DIR>"
```

注意：`sleep 60` 和 `poll` 必须分成两次终端调用，禁止写成 `sleep 60 && bash ...`。

如果 `poll` 显示尚未完成，继续重复：

```bash
sleep 60
```

```bash
bash scripts/check/full-check.sh poll blueprint "<RUN_DIR>"
```

直到显示"已完成"。

### 7. 汇总

执行：

```bash
bash scripts/check/full-check.sh summary "<RUN_DIR>"
```

`poll` 和 `summary` 输出中已包含日志摘要，无需额外读取长日志。

## 最终输出格式

全部检查完成后，输出以下内容。

### 本次检查信息

| 项目      | 值                       |
| ------- | ----------------------- |
| RUN_ID  | 从 RUN_DIR 或 summary 中提取 |
| RUN_DIR | `<RUN_DIR>`             |
| 日志目录    | `<RUN_DIR>`             |

### 总体结果

| 检查项          | 命令                            |    结果 | 退出码 | 摘要 |
| ------------ | ----------------------------- | ----: | --: | -- |
| ESLint       | `npx eslint . --ext .ts,.tsx` | 通过/失败 | 退出码 | 摘要 |
| TypeScript   | `npx tsc -b --noEmit`         | 通过/失败 | 退出码 | 摘要 |
| Vitest 全量测试  | `npm run test`                | 通过/失败 | 退出码 | 摘要 |
| Build        | `npm run build`               | 通过/失败 | 退出码 | 摘要 |
| E2E 测试     | `npm run test:e2e`            | 通过/失败 | 退出码 | 摘要 |
| Blueprint 测试 | `npm run test:blueprint`      | 通过/失败 | 退出码 | 摘要 |

### 未通过的测试

| 测试内容（测试用例名称） | 测试项目（所属测试文件或模块） | 对应结果（失败原因摘要） |
| ------------ | --------------- | ------------ |

如果没有发现失败测试，必须输出：

```text
未发现失败测试。
```

### 关键日志

只附上失败检查项的关键日志片段。不要粘贴完整长日志。
