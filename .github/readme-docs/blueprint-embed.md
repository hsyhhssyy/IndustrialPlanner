# 蓝图嵌入接入指南

[返回 README](../../README.md#蓝图嵌入)

通过 iframe 在自己的网站展示蓝图，复用主站的画布与仿真能力。嵌入页支持鼠标和触摸平移、缩放，但不能编辑；运行、暂停、显示模式和设备动画可由父页面控制，按钮的位置和样式由接入方决定。

## 嵌入画布

下面使用 `https://endfield.amiyabot.com/` 和主站公共蓝图作为示例：

```html
<iframe
  title="蓝图查看器"
  src="https://endfield.amiyabot.com/?embed=blueprint&amp;blueprintUrl=%2Fblueprints%2Fgetting-started-tutorial.json&amp;showBase=0&amp;view=3d-top&amp;animations=0&amp;autoplay=0&amp;warmupSeconds=0"
  style="width: 100%; height: 480px; border: 0"
></iframe>
```

设置 iframe 的宽高即可决定画布尺寸。以上示例加载后保持停止状态；若需要自动运行，将 `autoplay` 改为 `1`。

## URL 参数

蓝图地址可指向规划器原生蓝图、带有 `format: "akeblueprint/1"` 的完整游戏交换文件，或直接以 `name`、`bp_size`、`nodes` 等字段为根的游戏蓝图正文。

| 参数 | 取值 | 默认值 |
| --- | --- | --- |
| `embed` | 单图传 `blueprint`，多图传由 `{ f, p }` 条目组成的 JSON 数组文本 | 必填 |
| `blueprintUrl` | 单图的 JSON 文件地址 | 单图模式必填 |
| `baseId` | 整张画布的目标基地 ID | 沿用唯一的原生蓝图基地。纯游戏蓝图使用 `draft_box` |
| `view` | `3d-top` 或 `blueprint` | `3d-top` |
| `animations` | `1` 播放设备动画，`0` 关闭 | `0` |
| `autoplay` | `1` 就绪后开始仿真，`0` 等待外部命令 | `0` |
| `warmupSeconds` | 预热的仿真秒数，非负十进制数，可含小数 | `0` |
| `showBase` | `1` 显示基地，`0` 隐藏基地并使用无边场景 | `1` |

使用 `URLSearchParams.set()` 传入原始文件地址，由浏览器完成外层编码，不要先手动转义再传入。相对地址以嵌入页为基准；例如 `/blueprints/getting-started-tutorial.json` 指向 `https://endfield.amiyabot.com/blueprints/getting-started-tutorial.json`。

外部蓝图应使用可直接 GET 的 HTTPS 地址，且服务器须通过 CORS 允许 `https://endfield.amiyabot.com` 读取。请求不携带登录凭据。设备动画开关独立于仿真运行；蓝图外观沿用静态设备图像，关闭设备动画也不会暂停仿真。

## 在同一个 iframe 中摆放多份蓝图

`f` 填蓝图文件地址，`p` 用 `"XxY"` 指定该文件实体包围盒的目标左上角，坐标以整数格为单位，X 向右、Y 向下。清单至少有一个条目，使用清单时省略 `blueprintUrl`。清单条目共享同一画布，可以混用规划器和游戏蓝图，也可以重复摆放同一个文件。文件地址写入清单后，用 `URLSearchParams.set()` 对整个清单编码一次。

```js
const viewer = new URL("https://endfield.amiyabot.com/");
const layout = [
  { f: "/blueprints/getting-started-tutorial.json", p: "10x10" },
  { f: "/blueprints/dual-oven-xiranite.json", p: "60x10" },
];
viewer.searchParams.set("embed", JSON.stringify(layout));
document.querySelector("iframe").src = viewer.href;
```

显式传入 `baseId` 时，所有蓝图统一使用该基地。省略时，如果原生蓝图含有多个不同的基地 ID，查看器报告 `BASE_CONFLICT`，需要显式选定一个基地。相邻格上方向匹配的传送带和管道可以跨文件传输，供电设备可以覆盖相邻蓝图，仓库端点访问同一份基地库存。

清单错误提示会指出相关条目，序号从 1 开始。文件地址、读取或解码错误会同时给出文件地址，无效坐标会返回 `INVALID_POSITION`。

## 在 JavaScript 中独立转换游戏蓝图

规划器发布目录的 `game-blueprint.js` 提供 ESM 命名导出 `convertGameBlueprint`。将该目录静态部署后，可以从同源页面导入。跨域导入时，静态服务器需要允许调用方读取入口和它引用的模块。

```js
import { convertGameBlueprint } from "./game-blueprint.js";

const response = await fetch("./game-blueprint.json");
if (!response.ok) throw new Error(`蓝图读取失败 (${response.status})`);
const input = await response.json();
const blueprint = convertGameBlueprint(input, {
  baseId: "wuling_old_dam_construction_site",
});
```

转换器可直接接收完整游戏交换文件或游戏裸正文的解析结果，同步返回规划器 `BlueprintDocument`。省略第二个参数时使用草稿箱 `draft_box`。注册表由模块初始化，调用方可以在挂载规划器界面前转换。

维护者可在已备齐四份原件的工作区执行 `npm run dev -- --port 4187`，打开 [旧水坝四图开发验收入口](http://localhost:4187/fixtures/old-dam/)。

## 加载预热

`warmupSeconds=60` 表示加载时先快速计算 60 个仿真秒，并非等待 60 秒。查看器按当前 dense 标准频率换算为 tick，小数不足一个 tick 时向上取整；预热固定从 2 tick/秒启动，因此 60 秒为 120 tick。默认 `0` 跳过预热。

嵌入页在应用启动前显示“正在加载蓝图…”，读取文件和预热期间继续显示同一提示。预热完成后创建并显示画布、发送 `ready`，加载提示此时消失。`autoplay=0` 时显示预热后的暂停状态，父页发送 `start` 从该状态继续；`autoplay=1` 自动继续运行。播放阶段交回现有动态调频逻辑，在合法边界恢复通常的 4 tick/秒，状态和进度原位保留。`tickNumber` 属于当前频率的时间坐标，切换频率后编号也会换算，不表示进度重置或额外快进。预热不会向用户个人存档写入数据。

无效、负数、非有限、重复参数或换算后超出安全整数范围的 tick 会返回错误。加载或预热失败时，错误信息接替加载提示。秒数越大，首次显示前的计算等待越长；单次推进沿用现有 Worker 的 30 秒活跃时间超时，超时会返回加载错误。移除 iframe 会销毁正在预热的 Worker。

## 基地与画面范围

`showBase=0` 时，画布不显示基地边框、内外区域区别或外围警告区，草地铺满可见范围。蓝图元素保留原始坐标，原基地内外、边缘及区域范围不再造成放置拒绝；其他实体冲突与连接规则仍保留。`showBase=1` 则显示基地并沿用基地放置规则。

画面以蓝图全部实体的包围盒为基准，正常情况下四边最多留白三格。初始加载、平移、缩小和 iframe 尺寸变化都会重新约束可见范围。必要时自动放大，最高要求到 200%；若在 200% 或更大缩放下某个方向仍露出三格以外的区域，就将蓝图包围盒在该方向强制居中并锁住平移，另一个方向独立判断。

200% 不是放大上限。继续放大后，若原先锁定的方向已经满足三格限制，便恢复该方向范围内的平移。普通缩放保留 50%～800% 的绝对上下限，实际可缩小到的比例取决于蓝图与画布尺寸。

3Dtop 始终开启草地背景、关闭网格，初始进入和切换回来都生效；蓝图外观使用静态网格。这些显示规则只作用于当前嵌入实例。

## 父页面控制

下面是包含运行、暂停和显示选项的完整接入片段。先监听消息和 iframe 的 `load`，再设置 `src`；收到 `ready` 后启用自己的控件。

```html
<fieldset id="blueprint-controls" disabled>
  <button id="blueprint-start" type="button">运行</button>
  <button id="blueprint-pause" type="button">暂停</button>
  <select id="blueprint-view" aria-label="显示模式">
    <option value="3d-top">3Dtop</option>
    <option value="blueprint">蓝图</option>
  </select>
  <label><input id="blueprint-animations" type="checkbox">设备动画</label>
</fieldset>
<p id="blueprint-error" role="alert" hidden></p>
<iframe id="blueprint-frame" title="蓝图查看器"
  style="width: 100%; height: 480px; border: 0"></iframe>

<script>
  const iframe = document.querySelector("#blueprint-frame");
  const controls = document.querySelector("#blueprint-controls");
  const errorText = document.querySelector("#blueprint-error");
  const view = document.querySelector("#blueprint-view");
  const animations = document.querySelector("#blueprint-animations");
  const viewer = new URL("https://endfield.amiyabot.com/");
  viewer.searchParams.set("embed", "blueprint");
  viewer.searchParams.set("blueprintUrl", "/blueprints/getting-started-tutorial.json");
  viewer.searchParams.set("showBase", "0");
  viewer.searchParams.set("warmupSeconds", "0");
  const channel = "industrial-planner:blueprint";
  let requestNumber = 0;

  iframe.addEventListener("load", () => {
    controls.disabled = true;
    iframe.contentWindow.postMessage({ channel, version: 1, type: "connect" }, viewer.origin);
  });
  window.addEventListener("message", event => {
    if (event.source !== iframe.contentWindow || event.origin !== viewer.origin) return;
    const message = event.data;
    if (message?.channel !== channel || message.version !== 1) return;
    if (message.state) {
      controls.disabled = !message.state.ready;
      view.value = message.state.view;
      animations.checked = message.state.animations;
    }
    if (message.type === "error") {
      errorText.textContent = message.error.message;
      errorText.hidden = false;
    } else if (message.type === "ready" || message.type === "result") {
      errorText.hidden = true;
    }
  });
  function command(name, parameters = {}) {
    iframe.contentWindow.postMessage({
      channel, version: 1, type: "command",
      requestId: String(++requestNumber), command: name, ...parameters,
    }, viewer.origin);
  }
  document.querySelector("#blueprint-start").onclick = () => command("start");
  document.querySelector("#blueprint-pause").onclick = () => command("pause");
  view.onchange = () => command("setView", { value: view.value });
  animations.onchange = () => command("setAnimations", { value: animations.checked });
  iframe.src = viewer.href;
</script>
```

每条命令提供不同的非空 `requestId`（最多 128 字符）；命令成功返回 `result`，失败返回 `error`，均携带原 `requestId`。不应向嵌入页发送任意内部动作；仅支持下表中的命令。

| `command` | 参数与效果 |
| --- | --- |
| `start` | 开始仿真；暂停时继续已有进度 |
| `pause` | 暂停仿真 |
| `setView` | `value: "3d-top"` 或 `"blueprint"` |
| `setAnimations` | `value: true` 或 `false` |
| `zoom` | `step: number`，正数放大、负数缩小，绝对值不超过 12 |
| `pan` | `dx`、`dy` 为客户端像素位移，各自绝对值不超过 10,000 |

`ready`、`state` 和 `result` 携带 `state`，包含 `ready`、`runningState`（`stop`／`start`／`pause`）、`tickNumber`、`view`、`animations`、`viewport`。连接后每 500 ms 回传当前状态；`error` 携带 `{ code, message }`，启动加载失败时可能没有 `requestId`。显示选项切换不重载 iframe，也不重置仿真进度。

## 使用边界

- 蓝图仅载入内存，不保存或覆盖用户主站的基地、蓝图库和偏好。换图时更新 iframe 的 URL，会创建新的运行会话。
- 首版使用单基地、无限供电及现有默认自然资源供给规则，不恢复用户个人库存或运行快照；蓝图缺少必要的输入连接时，可能无法持续生产。
- 单个文件解压后不超过 4 MiB，JSON 嵌套不超过 64 层，文件加载超时为 30 秒。画布实体不超过 20,000，格点坐标绝对值不超过 100,000。
- 父页面应通过 HTTP(S) 提供。嵌入页只接受直接父页面并绑定其来源；若使用 `sandbox`，需保留 `allow-scripts allow-same-origin`，不支持不透明来源的消息连接。
- 不主动注册、更新或安装 PWA，也不弹安装提示。当前 iframe 有可用 Service Worker 时自然使用其缓存；浏览器可能隔离第三方缓存，因此用户安装过主站 PWA 并不保证第三方页面能离线打开。
- 每个实例有独立的仿真 Worker 和渲染资源，同时嵌入多个大蓝图会增加 CPU、内存与 GPU 开销。
