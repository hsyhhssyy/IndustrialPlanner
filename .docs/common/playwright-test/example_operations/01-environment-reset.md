# 操作一：重置环境（Environment Reset）

## 目的
在执行任何探测/拖拽测试前，统一环境状态，避免历史缓存和缩放状态污染结果。

> 定位：本操作是**非幂等的环境重设操作**，应在每一个测试链条的初始执行一次；不应在每一个操作开始前重复执行。

## 执行纪律（强制）

1. **禁止把本操作打包成 `.sh` 一次跑完**。
2. 必须逐步执行：每执行一步，立即验证并截图，再执行下一步。
3. 若某一步验证失败，先定位并修正，不得跳过继续执行。
4. 本操作产生的所有工件（截图、snapshot、临时结果文件）必须放在 `.temp/playwright-cli-test/[子文件夹]/`，且子文件夹名称必须包含时间戳。
5. 所有步骤必须在 `1920x1080` 视口下进行。
6. 执行频次约束：每条测试链仅在起始执行一次；链内后续操作默认复用该环境基线。
7. 实际执行 `playwright-cli` 命令时，禁止在命令行使用 Linux 环境变量，命令参数需使用完整绝对路径。
8. `run-code` 使用 `$(cat /完整绝对路径/脚本文件)` 的命令替换是允许的；要求 `cat` 的文件名必须是完整绝对路径。
9. 执行 `run-code` 时如需脚本文件，必须先将脚本文件直接创建到 `.temp/playwright-cli-test/[子文件夹]/[对应任务目录]/`；禁止使用管道命令创建脚本文件。
10. `playwright-cli run-code` 的页面脚本中禁止使用 `process.env`；脚本内如需读写路径，必须使用完整绝对路径。
11. 执行 `run-code` 必须使用脚本文件形式（如 `run-code "$(cat /完整绝对路径/xxx.js)"`）；禁止在命令后直接写内联脚本。

## 本操作实际使用的 Playwright Skill Commands（已验证）

- `playwright-cli -s=playwright-cli-test open http://localhost:5173`
- `playwright-cli -s=playwright-cli-test reload`
- `playwright-cli -s=playwright-cli-test resize 1920 1080`
- `playwright-cli -s=playwright-cli-test click e30`（进入“选择”模式，按页面快照 ref 可能变化）
- `playwright-cli -s=playwright-cli-test snapshot --filename=...`
- `playwright-cli -s=playwright-cli-test screenshot --filename=...`
- `playwright-cli -s=playwright-cli-test eval "..."`
- `playwright-cli -s=playwright-cli-test run-code "$(cat /home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_environment-reset/01-environment-reset/reset-localstorage.js)"`
- `playwright-cli -s=playwright-cli-test mousewheel 0 800`（用于缩小视角）

### `await page.mouse.*` 范例（用于调试/分步观测）

```js
await page.mouse.move(980, 520);
await page.mouse.wheel(0, 800);
await page.mouse.wheel(0, 800);
// 若发现缩放值变大，改用反方向：
await page.mouse.wheel(0, -800);
```

> 注：清空 localStorage 在实操中使用 `run-code`/`eval` 完成（例如 `localStorage.clear()`）；不同版本 CLI 也可尝试 `localstorage-clear` 子命令。

> 重要：文档中出现的坐标值、对象 ref/编号（如 `e125`）均为**实例值**，执行时必须先基于当前页面快照/实际渲染重新获取，不可硬编码复用。

## 操作步骤（每一步必须截图）

1. 启动或切换到目标会话页面（`http://localhost:5173`）。
2. 设置视口为 `1920x1080`，并截图留证。
3. （可选）先刷新到干净页面状态。
4. 清空当前 origin 的 localStorage（全部键）。
5. **在不刷新的前提下**立即确认 localStorage 为空。
6. 连续缩放到最小视角，直到缩放值不再下降。
7. **读取并确认当前缩放值为 `12px`**；未检测到 `12px` 视为本操作失败，不得继续后续用例。
8. 记录最终缩放值并截图。

> 执行方式要求：以上步骤必须逐步执行并逐步验证，不得合并为单条 shell 脚本批量执行。
> 口径修正：页面刷新可能自动回写默认键，因此“刷新后仍为空”不是有效验收条件。

### 缩放方向校准（必须执行）

1. 先各执行一次双方向滚轮（如 `wheel(0, 800)` 与 `wheel(0, -800)`）。
2. 观察顶部“缩放：xxpx”是否变小，确认当前环境的“缩小方向”。
3. 后续仅使用该方向缩放到最小，并以数值变化为准，不以方向经验判断。

### 通过性限制（必须满足）

1. 重置环境的缩放验收值固定为 `12px`。
2. 必须通过 UI 文本或 `eval/run-code` 读取到当前缩放值并确认等于 `12`。
3. 若缩放已稳定但读数不为 `12px`，判定本次“重置环境”不通过，必须先排查并修正后再继续。

## 推荐命令模板（可直接复用）

```bash
# 用例目录示例（完整绝对路径，子文件夹名含时间戳）
# /home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_environment-reset

# 1) 打开/刷新
playwright-cli -s=playwright-cli-test open http://localhost:5173
playwright-cli -s=playwright-cli-test resize 1920 1080
playwright-cli -s=playwright-cli-test reload

# 2) 清空 localStorage 并验证
playwright-cli -s=playwright-cli-test run-code "$(cat /home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_environment-reset/01-environment-reset/reset-localstorage.js)"
playwright-cli -s=playwright-cli-test eval "() => JSON.stringify(Object.keys(localStorage))"

# 3) 缩放到最小（示例：多次滚轮后再检查）
playwright-cli -s=playwright-cli-test mousemove 980 520
playwright-cli -s=playwright-cli-test mousewheel 0 -800
playwright-cli -s=playwright-cli-test mousewheel 0 800
playwright-cli -s=playwright-cli-test mousewheel 0 800
playwright-cli -s=playwright-cli-test snapshot --filename=/home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_environment-reset/prep-zoom-check.yaml

# 4) 每步截图
playwright-cli -s=playwright-cli-test screenshot --filename=/home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_environment-reset/prep-final.png
```

## 注意事项

- 任何一步都必须截图，不能只截“最终结果图”。
- 必须有“清空后验证图”，否则不可审计。
- localStorage 的“为空”判定必须发生在 `clear()` 之后、刷新之前。
- 网页工件文件（如 snapshot/yaml）与截图必须位于同一个用例子目录：`.temp/playwright-cli-test/[子文件夹]/`，且该子文件夹名必须包含时间戳。
- 必须先固定视口到 `1920x1080`，否则探测格数与截图口径可能不一致。
- 最小缩放要有“达到最小且稳定”的证据（建议至少 2 次额外缩放无变化）。
- 缩放通过标准是“检测值等于 `12px`”，仅“看起来已最小”或“无继续变化”不能单独作为通过依据。
- 滚轮方向可能翻转，必须先做双向校准，不可默认某个方向一定是缩小。
- 该操作是全局重置手段，属于非幂等环境重设；默认每条测试链仅执行一次，若只是链内切换操作且状态正常，不应重复执行。
