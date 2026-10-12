# 蓝图嵌入接入指南

[返回 README](../../README.md#蓝图嵌入)

通过 iframe 在自己的网站展示蓝图，复用主站的画布与仿真能力。嵌入页支持鼠标和触摸平移、缩放，但不能编辑；运行、暂停、显示模式和设备动画可由父页面控制，按钮的位置和样式由接入方决定。

## 嵌入画布

下面使用 `https://endfield.amiyabot.com/` 和主站公共蓝图作为示例：

```html
<iframe
  title="蓝图查看器"
  src="https://endfield.amiyabot.com/?embed=blueprint&amp;blueprintUrl=%2Fblueprints%2Fgetting-started-tutorial.json&amp;view=3d-top&amp;animations=0&amp;autoplay=0"
  style="width: 100%; height: 480px; border: 0"
></iframe>
```

设置 iframe 的宽高即可决定画布尺寸。以上示例加载后保持停止状态；若需要自动运行，将 `autoplay` 改为 `1`。

## URL 参数

| 参数 | 取值 | 默认值 |
| --- | --- | --- |
| `embed` | 固定为 `blueprint`，启用只读嵌入模式 | 必填 |
| `blueprintUrl` | 蓝图 JSON **文件的 URL**，不是 JSON 正文 | 必填 |
| `view` | `3d-top` 或 `blueprint` | `3d-top` |
| `animations` | `1` 播放设备动画，`0` 关闭 | `0` |
| `autoplay` | `1` 就绪后开始仿真，`0` 等待外部命令 | `0` |

使用 `URLSearchParams.set()` 传入原始文件地址，由浏览器完成外层编码，不要先手动转义再传入。相对地址以嵌入页为基准；例如 `/blueprints/getting-started-tutorial.json` 指向 `https://endfield.amiyabot.com/blueprints/getting-started-tutorial.json`。

外部蓝图应使用可直接 GET 的 HTTPS 地址，且服务器须通过 CORS 允许 `https://endfield.amiyabot.com` 读取。请求不携带登录凭据。设备动画开关独立于仿真运行；蓝图外观沿用静态设备图像，关闭设备动画也不会暂停仿真。

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
- 文件解压后不超过 4 MiB、实体不超过 20,000、JSON 嵌套不超过 64 层、格点坐标绝对值不超过 100,000；文件加载超时为 30 秒。
- 父页面应通过 HTTP(S) 提供。嵌入页只接受直接父页面并绑定其来源；若使用 `sandbox`，需保留 `allow-scripts allow-same-origin`，不支持不透明来源的消息连接。
- 不主动注册、更新或安装 PWA，也不弹安装提示。当前 iframe 有可用 Service Worker 时自然使用其缓存；浏览器可能隔离第三方缓存，因此用户安装过主站 PWA 并不保证第三方页面能离线打开。
- 每个实例有独立的仿真 Worker 和渲染资源，同时嵌入多个大蓝图会增加 CPU、内存与 GPU 开销。
