# Playwright CLI 安装与分辨率使用指南

> 适用环境：Linux（本项目当前开发环境）
> 目标：安装并配置 `playwright-cli`，确保可以打开网页、并按指定分辨率（如 `1920x1080`）执行截图。

---

## 1. 背景与命令区分

在 Playwright 生态中，常见有两套命令：

1. `playwright`（来自 `playwright` 包）
   - 常用于测试运行：`playwright test`、`playwright show-report` 等。
2. `playwright-cli`（来自 `@playwright/cli` 包）
   - 常用于终端交互自动化（open / click / type / snapshot / screenshot）。

注意：历史包 `playwright-cli`（同名老包）已废弃，建议使用 `@playwright/cli`。

---

## 2. 前置条件

- Node.js 18+（建议 Node.js 20+）
- 可以访问 npm 源
- Linux 环境下具备安装系统依赖权限（`install-deps` 可能需要 sudo）

建议先在项目根目录执行：

```bash
cd /home/coder/IndustrialPlanner
```

---

## 3. 安装步骤（推荐顺序）

### 3.1 初始化 Playwright CLI 工作区

```bash
npx -y @playwright/cli install
```

预期结果：
- 初始化工作区（会生成 `.playwright/cli.config.json`）
- 自动下载浏览器运行时（通常是 Chromium 通道）

### 3.2 安装 Linux 浏览器依赖（关键）

```bash
npx -y playwright install-deps chromium
```

说明：
- 这是 Linux 常见关键步骤。
- 如果缺少系统库，浏览器会启动失败，典型报错类似：
  - `error while loading shared libraries: libnspr4.so: cannot open shared object file`

### 3.3 验证命令可用

```bash
npx -y @playwright/cli --help
```

可看到 `open`、`resize`、`screenshot`、`snapshot`、`eval`、`close` 等命令即表示可用。

---

## 4. 打开网页（最小可用示例）

### 4.1 打开本地页面

```bash
npx -y @playwright/cli -s=demo open http://127.0.0.1:5173
```

说明：
- `-s=demo` 表示使用命名会话，方便后续命令复用同一浏览器上下文。
- 若本地服务未启动，会出现页面无法访问错误；先确认开发服务端口可用。

### 4.2 验证当前页面信息

```bash
npx -y @playwright/cli -s=demo eval "() => ({ href: location.href, title: document.title })"
```

---

## 5. 指定分辨率（以 1920x1080 为例）

### 5.1 调整视口分辨率

```bash
npx -y @playwright/cli -s=demo resize 1920 1080
```

### 5.2 截图到指定路径

```bash
mkdir -p .temp
npx -y @playwright/cli -s=demo screenshot --filename=.temp/playwright-cli-1920x1080.png
```

### 5.3（可选）快速校验 PNG 头部宽高

当系统没有 `file` / `xxd` / `python` 库时，可用 `od` 读取 PNG 头：

```bash
od -An -t x1 -N 32 .temp/playwright-cli-1920x1080.png
```

如果出现：
- `00 00 07 80`（十六进制）=> 宽 `1920`
- `00 00 04 38`（十六进制）=> 高 `1080`

则说明截图分辨率正确。

---

## 6. 会话管理与清理

### 6.1 关闭当前会话

```bash
npx -y @playwright/cli -s=demo close
```

### 6.2 查看会话列表

```bash
npx -y @playwright/cli list
```

### 6.3 清理全部会话（谨慎）

```bash
npx -y @playwright/cli close-all
```

---

## 7. 常见问题与处理

### Q1：提示 `Chromium distribution 'chrome' is not found`

原因：系统未安装 Google Chrome，且命令尝试使用 `chrome` 通道。

处理：
1. 优先执行初始化：
   ```bash
   npx -y @playwright/cli install
   ```
2. 如仍失败，检查 `cli.config.json` 的浏览器配置是否正确。

### Q2：提示 `Browser "chromium" is not installed`

原因：`playwright-cli` 的浏览器运行时尚未完成初始化。

处理：
```bash
npx -y @playwright/cli install
```

### Q3：提示共享库缺失（例如 `libnspr4.so`）

原因：Linux 系统依赖未安装完整。

处理：
```bash
npx -y playwright install-deps chromium
```

### Q4：网页打不开 `http://127.0.0.1:5173`

原因：本地开发服务未启动或端口不对。

处理：
1. 先启动前端服务（例如 `npm run dev`）。
2. 在终端确认端口可访问后再执行 `open`。

---

## 8. 一键复现实验脚本（可选）

```bash
cd /home/coder/IndustrialPlanner && \
  npx -y @playwright/cli install && \
  npx -y playwright install-deps chromium && \
  npx -y @playwright/cli -s=demo open http://127.0.0.1:5173 && \
  npx -y @playwright/cli -s=demo resize 1920 1080 && \
  mkdir -p .temp && \
  npx -y @playwright/cli -s=demo screenshot --filename=.temp/playwright-cli-1920x1080.png && \
  npx -y @playwright/cli -s=demo close
```

---

## 9. 建议实践

- 回归测试主流程优先用 `playwright test`（可维护、可集成 CI）。
- 探索式联调、快速验页面状态可用 `playwright-cli`。
- 建议固定会话命名规则（如 `-s=smoke`, `-s=debug`, `-s=auth`），便于团队协作。
