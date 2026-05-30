---
description: "对当前工作区执行完整的代码质量检查（eslint、tsc、test、build、test:blueprint），并以表格汇总未通过的测试"
argument-hint: "[额外说明...]"
agent: "agent"
---

请使用 `scripts/check/full-check.sh` 对当前工作区执行完整检查。所有检查命令已固化为脚本，AI 只需调用脚本的子命令，不得自行拼写检查命令。

## 硬性要求

* 只执行检查，不要根据检查结果修改任何业务代码、测试代码或配置代码。
* 某一步失败后，必须继续执行后续检查项。
* 不得删除 `.temp/full-check/` 下的任何文件或目录。
* 不得使用 `rm`、`rmdir`、`find -delete`、`find -exec`、`ps`、`kill`、`taskkill`。
* 不要粘贴完整长日志，只输出关键失败信息和最后日志摘要。
* 最终报告必须使用中文。
* 执行时必须按顺序执行要执行的脚本，除非本文档给出的指令中包含`&&`，否则不可以使用`&&`拼接多个指令

## 执行方式

按顺序分步执行。eslint、tsc、build 快速且可同步等待；test 和 blueprint 耗时长，必须后台启动后用 `poll` 轮询，不可同步等待。

```bash
# 0. 初始化
RUN_DIR=$(bash scripts/check/full-check.sh init) && echo "$RUN_DIR"

# 1-2. 快速步骤（同步执行）
bash scripts/check/full-check.sh eslint "$RUN_DIR"
bash scripts/check/full-check.sh tsc    "$RUN_DIR"

# 3. 长时间步骤：后台启动 + poll 轮询
bash scripts/check/full-check.sh test "$RUN_DIR" &
# 反复调用 poll 直到显示"已完成"，每次间隔 60 秒 注意,你最多只能间隔60秒，不可使用更长的等待时间
sleep 60 && bash scripts/check/full-check.sh poll test "$RUN_DIR"

# 4. 快速步骤
bash scripts/check/full-check.sh build "$RUN_DIR"

# 5. 长时间步骤：后台启动 + poll 轮询
bash scripts/check/full-check.sh blueprint "$RUN_DIR" &
# 注意,你最多只能间隔60秒，不可使用更长的等待时间
sleep 60 && bash scripts/check/full-check.sh poll blueprint "$RUN_DIR"

# 6. 汇总
bash scripts/check/full-check.sh summary "$RUN_DIR"
```

poll 输出中已包含日志摘要，无需额外读取。

## 最终输出格式

全部检查完成后，输出以下内容。

### 本次检查信息

| 项目      | 值          |
| ------- | ---------- |
| RUN_ID  | `$RUN_ID`  |
| RUN_DIR | `$RUN_DIR` |
| 日志目录    | `$RUN_DIR` |

### 总体结果

| 检查项          | 命令                            |    结果 | 退出码 | 摘要 |
| ------------ | ----------------------------- | ----: | --: | -- |
| ESLint       | `npx eslint . --ext .ts,.tsx` | 通过/失败 | 退出码 | 摘要 |
| TypeScript   | `npx tsc -b --noEmit`         | 通过/失败 | 退出码 | 摘要 |
| Vitest 全量测试  | `npm run test`                | 通过/失败 | 退出码 | 摘要 |
| Build        | `npm run build`               | 通过/失败 | 退出码 | 摘要 |
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