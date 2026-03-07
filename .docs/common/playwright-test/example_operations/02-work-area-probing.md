# 操作二：工作区域探测（Work Area Probing）

## 目的
在目标基地中逐格探测可建造区域宽高，并将协议核心放置到右下角合法边界。

## 执行纪律（强制）

1. **禁止将探测流程打包成 `.sh` 一次执行**。
2. 必须按“单步执行 -> 单步验证 -> 单步截图”的节奏推进。
3. 每个关键转折点（首次红框、回退一格、候选落点、松手后状态）必须即时验证，不可事后补验。
4. 本操作产生的网页工件文件与截图必须统一放在 `.temp/playwright-cli-test/[子文件夹]/`，且子文件夹名称必须包含时间戳。
5. 本操作必须在 `1920x1080` 视口下执行。
6. 进入本操作前必须执行 `12px` 准入检查；若当前缩放值不是 `12px`，必须先执行“重置环境”，然后从本操作 A 段重新开始（即执行“重置环境 + 工作区域探测”链路）。
7. 实际执行 `playwright-cli` 命令时，禁止在命令行使用 Linux 环境变量，命令参数需使用完整绝对路径。
8. `run-code` 使用 `$(cat /完整绝对路径/脚本文件)` 的命令替换是允许的；要求 `cat` 的文件名必须是完整绝对路径。
9. 执行 `run-code` 时如需脚本文件，必须先将脚本文件直接创建到 `.temp/playwright-cli-test/[子文件夹]/[对应任务目录]/`；禁止使用管道命令创建脚本文件。
10. `playwright-cli run-code` 的页面脚本中禁止使用 `process.env`；脚本内如需读写路径，必须使用完整绝对路径。
11. 探测结束后必须直接打印探测结论（最终坐标、`1格=xxpx`、横向步进数、纵向步进数）；由 AI 在上下文记录，禁止仅写入 JS 变量后不打印。
12. 执行 `run-code` 必须使用脚本文件形式（如 `run-code "$(cat /完整绝对路径/xxx.js)"`）；禁止在命令后直接写内联脚本。

## 准入规则（12px）

1. 本操作只允许在当前缩放值为 `12px` 时开始。
2. 准入检查必须有截图留证。
3. 若检查结果不是 `12px`，不得继续当前步骤，必须先执行“重置环境”并重新进入本操作。

## 本操作实际使用的 Playwright Skill Commands（已验证）

- `playwright-cli -s=playwright-cli-test reload`
- `playwright-cli -s=playwright-cli-test resize 1920 1080`
- `playwright-cli -s=playwright-cli-test click e30`（选择模式）
- `playwright-cli -s=playwright-cli-test click e125`（协议核心，ref 可能随快照变化）
- `playwright-cli -s=playwright-cli-test run-code "$(cat /home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_work-area-probing/02-work-area-probing/probe-work-area.js)"`
- `playwright-cli -s=playwright-cli-test eval "() => JSON.stringify(...)"`
- `playwright-cli -s=playwright-cli-test screenshot --filename=...`
- `playwright-cli -s=playwright-cli-test snapshot --filename=...`
- `playwright-cli -s=playwright-cli-test mousemove / mousedown / mouseup`（在 `run-code` 外的分步调试场景）

> 说明：本项目中探测与边界确认最稳定的方式是 `run-code` 驱动（按格移动 + 红框/drag-invalid检测 + 截图）。

> 重要：文档中的坐标值、对象 ref/编号（如 `e30`、`e125`）均为**示例**。每次执行前必须按当前页面实时内容重新定位正确对象和坐标。

### `await page.mouse.*` 拖放范例（核心手法）

```js
// 1) 先移动到目标中心点（中心点需先通过 boundingBox 实时计算）
await page.mouse.move(centerX, centerY);

// 2) 按下左键开始拖拽
await page.mouse.down({ button: 'left' });

// 3) 分步移动（steps 用于更稳定触发拖拽逻辑）
await page.mouse.move(targetX, targetY, { steps: 20 });

// 4) 松开左键完成放置
await page.mouse.up({ button: 'left' });
```

### 对象定位范例（不要硬编码）

```js
const target = page.getByTitle('item_port_sp_hub_1').first();
const box = await target.boundingBox();
if (!box) throw new Error('target not found');
const centerX = box.x + box.width / 2;
const centerY = box.y + box.height / 2;
```

### 红框判定范例（可用于逐格探测）

```js
const isInvalid = await target.evaluate((el) => {
   const cls = el.className || '';
   const surf = el.firstElementChild ? getComputedStyle(el.firstElementChild) : null;
   const border = surf ? (surf.borderColor || '') : '';
   const shadow = surf ? (surf.boxShadow || '') : '';
   return /drag-invalid/.test(cls) || /rgb\(255,\s*93,\s*93\)/.test(border) || /86, 10, 10/.test(shadow);
});
```

## 操作步骤（每一步必须截图）

### A. 进入目标基地并建立基准

1. 读取当前缩放值并执行 `12px` 准入检查（必须截图）。
2. 若缩放值不是 `12px`：中断当前流程，先执行“重置环境”，再回到本操作 A-1 重新开始。
3. 在右侧基地列表切换到目标基地。
4. 选中协议核心。
5. 若核心不在左上合法基准，先执行“重置环境”，再回到本操作 A-1 重新开始。

### B. 逐格探测宽高

1. 横向逐格右移：每次严格 `+1 格`，记录首次无效步并回退 1 格。
2. 纵向逐格下移：每次严格 `+1 格`，记录首次无效步并回退 1 格。
3. 得到：
   - `rightLegalSteps`
   - `downLegalSteps`
4. 计算区域大小：
   - `buildWidth = rightLegalSteps + 9`
   - `buildHeight = downLegalSteps + 9`
5. 与 UI 可放置区域（如 `70x70`）比对并截图留证。

### C. 放置到右下角（大步 + 小步）

1. 先按探测格数做大步接近右下角（例如每次 5 格）。
2. 接近边界后改为 1 格小步，并按四方向反复试探：右、下、左、上。
3. 在准备松手点，做邻域三探测：
   - 右 +1 格
   - 下 +1 格
   - 右下 +1 格
4. 只有三者都无效时，才在当前点松手并截图。

### D. 输出探测结论（必须打印）

1. 探测结束后，必须直接输出以下字段到命令行：
   - `finalX`、`finalY`（最终落点坐标）
   - `stepPx`（`1格` 对应像素）
   - `rightLegalSteps`、`downLegalSteps`（最终步进数）
2. 输出后由 AI 立即在会话上下文记录，不得只保存在页面 JS 变量（如 `window.__probeResult`）中。

> 执行方式要求：A/B/C/D 四段都必须分步执行与分步验证，不得以单条批量脚本替代人工步骤校验。

## 推荐命令模板（可直接复用）

```bash
# 用例目录示例（完整绝对路径，子文件夹名含时间戳）
# /home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_work-area-probing

# 1) 进入目标页面并选中协议核心
playwright-cli -s=playwright-cli-test reload
playwright-cli -s=playwright-cli-test resize 1920 1080
playwright-cli -s=playwright-cli-test click e30
playwright-cli -s=playwright-cli-test click e125

# 2) 执行逐格探测（示例：run-code 内按 stepPx 移动并记录）
playwright-cli -s=playwright-cli-test run-code "$(cat /home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_work-area-probing/02-work-area-probing/probe-work-area.js)"

# 3) 输出探测结果（直接打印：最终坐标、stepPx、步进数）
playwright-cli -s=playwright-cli-test run-code "$(cat /home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_work-area-probing/02-work-area-probing/print-probe-result.js)"

# 4) 示例：保存快照/截图到用例子目录
playwright-cli -s=playwright-cli-test snapshot --filename=/home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_work-area-probing/probe-snapshot.yaml
playwright-cli -s=playwright-cli-test screenshot --filename=/home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_work-area-probing/probe-final.png
```

## 前文中已验证成功的关键命令片段

```bash
playwright-cli -s=playwright-cli-test run-code "$(cat /home/coder/IndustrialPlanner/.temp/playwright-cli-test/2026-03-06_07-35-00_work-area-probing/02-work-area-probing/probe-work-area.js)"
# 不再通过 window 变量读取结果，探测结论应由 run-code 直接打印
```

## 注意事项

- 不要用固定像素代替“1 格”；1 格必须等于当前缩放值（如 `12px`）。
- 缩放值获取前要先完成滚轮方向校准（`wheel(0, 800)` 与 `wheel(0, -800)` 各试一次），以实际数值变化判定缩小方向。
- 不能只看一次红框就结束，必须执行“回退一格 + 邻域三探测”。
- 若切换了基地，不能复用其他基地探测结果。
- 若发现最终点仍可再向右/下移动 1 格，说明少探了一格，必须继续修正。
- 过程网页文件（snapshot/yaml/json）和截图图片必须统一归档到 `.temp/playwright-cli-test/[子文件夹]/`，且子文件夹名必须包含时间戳。
- 探测前必须先执行 `resize 1920 1080`，并保留截图作为口径证明。
