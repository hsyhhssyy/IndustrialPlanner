# 完整检查执行规范

## 目录

- [检查范围](#检查范围)
- [终端执行模型](#终端执行模型)
- [命令限制](#命令限制)
- [RUN_DIR](#run_dir)
- [硬性限制](#硬性限制)
- [完整检查步骤](#完整检查步骤)

使用 `scripts/check/full-check.sh` 对当前工作区执行完整检查。所有底层命令已经固化，禁止自行拼写 ESLint、TypeScript、Vitest、Build、E2E 或 Blueprint 命令。

## 检查范围

除非用户明确给出测试集名称并要求只执行该测试集，否则任何测试请求都必须执行完整检查，不得自行缩小范围或选择性执行。用户明确指定单一测试集时，改用 `test-writing` skill。

## 终端执行模型

1. 使用项目根目录作为终端工具的 `workdir`，禁止在命令中执行 `cd`。
2. 终端工具支持 `login` 参数时必须设为 `false`；不支持时不得主动请求 login shell。检查不应加载 `.profile`、`.bash_profile` 或 `.bashrc`。
3. `bash scripts/check/full-check.sh ...` 只表示用 Bash 解释器运行项目脚本，不表示启动 login shell。
4. 每次终端调用只能执行一条命令。
5. `test`、`e2e`、`blueprint` 必须以前台命令启动，禁止添加 `&`。
6. 长任务返回 `session_id`、会话句柄或仍在运行状态时，必须续接同一进程等待完成，不得另开终端调用脚本的 `poll` 子命令。
7. 每次等待或会话续接不得超过 60 秒；未完成时继续续接同一会话。
8. 某一步失败后记录结果，并继续后续检查项。

正确的长任务启动方式：

```bash
bash scripts/check/full-check.sh test ".temp/full-check/runs/实际-run-dir"
```

若终端返回会话句柄，续接该会话直至获得最终退出状态。会话续接不是新 shell 命令，不需要执行 `sleep`。

禁止把包装脚本放到后台：

```bash
bash scripts/check/full-check.sh test ".temp/full-check/runs/实际-run-dir" &
```

禁止退出原终端后从新终端调用：

```bash
bash scripts/check/full-check.sh poll test ".temp/full-check/runs/实际-run-dir"
```

一次性终端结束时可能终止后台包装脚本及测试子进程，留下 `.pid` 和空日志并制造假失败。不得使用 `nohup`、`setsid`、`disown` 绕过终端生命周期；工具无法续接同一会话时，必须报告限制，不得伪造检查结果。

## 命令限制

禁止任何命令拼接或批处理，包括：

- `&&`
- `||`
- `;`
- `|`
- `{ ...; }`
- `( ... )`
- 多行 shell 脚本
- 在一次调用中先 `cd` 再执行检查

错误示例：

```bash
cd /home/coder/IndustrialPlanner && bash scripts/check/full-check.sh init
```

```bash
RUN_DIR=$(bash scripts/check/full-check.sh init) && echo "$RUN_DIR"
```

```bash
bash scripts/check/full-check.sh eslint "$RUN_DIR" && bash scripts/check/full-check.sh tsc "$RUN_DIR"
```

## RUN_DIR

初始化后必须从输出提取并记录 `RUN_DIR` 的实际路径。后续命令直接使用该字符串，禁止依赖 shell 变量跨调用存在。整个流程只能执行一次 `init`，不得重新初始化。

允许：

```bash
bash scripts/check/full-check.sh eslint ".temp/full-check/runs/full-check-xxxxxx"
```

禁止：

```bash
bash scripts/check/full-check.sh eslint "$RUN_DIR"
```

## 硬性限制

- 只执行检查，不根据结果修改业务代码、测试代码或配置。
- 不得删除 `.temp/full-check/` 下的文件或目录。
- 不得使用 `rm`、`rmdir`、`find -delete`、`find -exec`、`ps`、`kill`、`taskkill`。
- 不得粘贴完整长日志，只输出关键失败信息和脚本摘要。
- 最终报告使用中文。
- 按固定顺序执行全部检查。

## 完整检查步骤

### 0. 初始化

```bash
bash scripts/check/full-check.sh init
```

记录输出的实际 `RUN_DIR`，不得重复初始化。

### 1. ESLint

```bash
bash scripts/check/full-check.sh eslint "<RUN_DIR>"
```

### 2. TypeScript

```bash
bash scripts/check/full-check.sh tsc "<RUN_DIR>"
```

### 3. Vitest 全量测试

```bash
bash scripts/check/full-check.sh test "<RUN_DIR>"
```

以前台方式执行，并续接同一终端会话直至完成。

### 4. Build

```bash
bash scripts/check/full-check.sh build "<RUN_DIR>"
```

### 5. E2E

```bash
bash scripts/check/full-check.sh e2e "<RUN_DIR>"
```

以前台方式执行，并续接同一终端会话直至完成。

### 6. Blueprint

```bash
bash scripts/check/full-check.sh blueprint "<RUN_DIR>"
```

以前台方式执行，并续接同一终端会话直至完成。

### 7. 汇总

```bash
bash scripts/check/full-check.sh summary "<RUN_DIR>"
```

`summary` 已包含日志摘要，不需要额外读取长日志。
