# vitest / build 单例执行规则

## 适用范围

`vitest`（含 `normal`、`blueprint`、`dev-tools`、`contract` 等全部 project）与 `build` 都是全机单例资源：**任何时刻全局只允许一个 vitest 进程、一个 build 进程**。

适用于所有执行入口，包括 `test-writing` 单项测试、`simple-check`、`full-check`、`performance-monitor` 及手工直跑的 `npx vitest`、`npm run test*`、`npm run build`、`check-runner.sh test|build|blueprint`。

约束对象是命令类型，不是进程归属：其他 Agent、其他终端、其他会话启动的 vitest / build 同样占用单例，不得因为"不是我的进程"而并发启动。

## 执行前强制检查

### 1. 固定最后改动时间

先完成本次全部代码改动，再确定 `LAST_CHANGE`。`LAST_CHANGE` 必须来自文件系统事实，不得用"我认为改完了"的时间。

```bash
git status --porcelain=v1 | cut -c4- | xargs -r stat -c '%Y %y %n' | sort -n | tail -n 1
```

- 输出中第一列是 epoch 秒，即 `LAST_CHANGE`。
- 命令覆盖已跟踪改动与未跟踪文件；重命名条目可能解析失败，需人工补看。
- 后续任何一次代码改动都会推高 `LAST_CHANGE`，此时已完成或已复用的结果立即作废。

### 2. 检测在跑的 vitest / build

```bash
ps -eo pid,lstart,etimes,args --sort=start_time | grep -E 'vitest|run-normal-tests\.mjs|npm run (test|build)|vite build|check-runner\.sh (test|build|blueprint)' | grep -v grep
```

- 只读检测：**禁止** `kill`、`pkill`、`taskkill` 或任何信号操作他人进程。
- `lstart` 给出进程启动时间，`etimes` 给出已运行秒数，用于与 `LAST_CHANGE` 比对。
- 检测命令只用于判定，不写入任何文件。

### 3. 判定

| 检测结果 | 处理 |
| --- | --- |
| 无相关进程 | 直接启动本次执行 |
| 有进程，且启动时间 **晚于** `LAST_CHANGE` | 允许复用，必须等待该进程结束并核验其结果 |
| 有进程，且启动时间 **早于或等于** `LAST_CHANGE` | 结果不含你的改动，不可复用；等待其结束后再启动自己的执行 |
| 同时存在多个 vitest 或 build（已违规并发） | 不杀进程、不加入并发；等待全部结束后再执行，期间产生的结果一律不得作为本次结论 |
| `npm run test:watch` 等常驻 watch 进程 | 不属于可完成的一次执行，不等待、不复用；报告阻塞并请求用户处理，不得杀进程 |

启动时间晚于 `LAST_CHANGE` 是必要条件，不是充分条件：还要满足下节全部条件才能复用。

## 复用的附加条件

以下条件必须同时满足，否则只能等待后自行执行：

1. **同一工作区**：运行进程与本次执行属于同一 worktree、同一源码状态。跨 worktree、跨分支的结果不可复用。
2. **范围覆盖**：运行命令的测试范围必须覆盖本次需求。
   - `--project normal`（含 `npm run test`、`check-runner.sh test`）只覆盖 `normal` project。
   - `--project blueprint`（含 `check-runner.sh blueprint`）只覆盖蓝图串行回归。
   - `test:contract`、`test:dev-tools`、`test:eda`、`test:release` 各自独立，互不覆盖。
   - 单文件、单用例运行不得复用为 project 级或全量结论。
   - build 只认 `npm run build`（或 `check-runner.sh build`）的标准产物构建。
3. **结果可核验**：必须能读到退出码与日志。
   - `check-runner.sh` 启动的进程：读取对应 `RUN_DIR` 下的 `<step>.exit` 与 `<step>.log`。
   - 无 `RUN_DIR` 的临时进程：必须能读取其完整终端输出或日志文件；否则不得复用。
4. **复用期间零改动**：一旦修改任何源码或配置，复用结果作废，必须重新执行。

## 等待方式

- 前台等待或续接同一终端会话，每次不超过 60 秒，未完成继续续接同一会话；不得另开 shell 轮询，不得 `sleep` 轮询。
- 等待结束后必须核验 `<step>.exit` 或日志中的 `Test Files` / `Tests` 汇总，才能报告结果。仅凭"进程已退出"不得判定通过。
- 等待期间不得启动第二个 vitest 或 build，也不得以任何方式提前终止对方进程。

## 结果汇报

最终报告中必须写明：

- 本次是自行执行还是复用他人结果。
- 复用时：被复用进程的 PID、启动时间、所属 `RUN_DIR`，以及为何满足全部复用条件。
- 因等待而延迟时：说明阻塞来源与等待原因。
