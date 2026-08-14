# Playwright CLI 命令参考

## 目录

- [项目输出目录](#项目输出目录)
- [快速开始](#快速开始)
- [核心命令](#核心命令)
- [导航](#导航)
- [键盘和鼠标](#键盘和鼠标)
- [截图和 PDF](#截图和-pdf)
- [标签页](#标签页)
- [存储](#存储)
- [网络和 DevTools](#网络和-devtools)
- [启动参数](#启动参数)
- [快照](#快照)
- [浏览器会话](#浏览器会话)
- [本地执行回退](#本地执行回退)
- [常见流程](#常见流程)

## 项目输出目录

在项目内执行时，所有文件型输出必须写入 `.temp/playwright-test/`。会自动生成 trace、日志或视频的会话必须通过配置指定输出目录，例如创建临时配置 `.temp/playwright-test/cli.config.json`：

```json
{
  "outputDir": ".temp/playwright-test",
  "outputMode": "stdout"
}
```

启动会话时加载该配置：

```bash
playwright-cli open --config=.temp/playwright-test/cli.config.json
```

## 快速开始

```bash
playwright-cli open
playwright-cli goto https://playwright.dev
playwright-cli click e15
playwright-cli type "page.click"
playwright-cli press Enter
playwright-cli screenshot --filename=.temp/playwright-test/page.png
playwright-cli close
```

每条命令后会返回当前页面快照和可交互元素 ref。优先使用快照理解页面，只有需要视觉证据时才截图。

## 核心命令

```bash
playwright-cli open
playwright-cli open https://example.com/
playwright-cli goto https://playwright.dev
playwright-cli type "search query"
playwright-cli click e3
playwright-cli dblclick e7
playwright-cli fill e5 "user@example.com"
playwright-cli drag e2 e8
playwright-cli hover e4
playwright-cli select e9 "option-value"
playwright-cli upload ./document.pdf
playwright-cli check e12
playwright-cli uncheck e12
playwright-cli snapshot
playwright-cli snapshot --filename=.temp/playwright-test/after-click.md
playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5
playwright-cli dialog-accept
playwright-cli dialog-accept "confirmation text"
playwright-cli dialog-dismiss
playwright-cli resize 1920 1080
playwright-cli close
```

## 导航

```bash
playwright-cli go-back
playwright-cli go-forward
playwright-cli reload
```

## 键盘和鼠标

```bash
playwright-cli press Enter
playwright-cli press ArrowDown
playwright-cli keydown Shift
playwright-cli keyup Shift
playwright-cli mousemove 150 300
playwright-cli mousedown
playwright-cli mousedown right
playwright-cli mouseup
playwright-cli mouseup right
playwright-cli mousewheel 0 100
```

## 截图和 PDF

所有项目内输出必须写入 `.temp/playwright-test/`。

```bash
playwright-cli screenshot e5 --filename=.temp/playwright-test/element.png
playwright-cli screenshot --filename=.temp/playwright-test/page.png
playwright-cli pdf --filename=.temp/playwright-test/page.pdf
```

## 标签页

```bash
playwright-cli tab-list
playwright-cli tab-new
playwright-cli tab-new https://example.com/page
playwright-cli tab-close
playwright-cli tab-close 2
playwright-cli tab-select 0
```

## 存储

项目内状态文件必须写入 `.temp/playwright-test/`。

```bash
playwright-cli state-save .temp/playwright-test/auth.json
playwright-cli state-load .temp/playwright-test/auth.json
playwright-cli cookie-list
playwright-cli cookie-list --domain=example.com
playwright-cli cookie-get session_id
playwright-cli cookie-set session_id abc123
playwright-cli cookie-set session_id abc123 --domain=example.com --httpOnly --secure
playwright-cli cookie-delete session_id
playwright-cli cookie-clear
playwright-cli localstorage-list
playwright-cli localstorage-get theme
playwright-cli localstorage-set theme dark
playwright-cli localstorage-delete theme
playwright-cli localstorage-clear
playwright-cli sessionstorage-list
playwright-cli sessionstorage-get step
playwright-cli sessionstorage-set step 3
playwright-cli sessionstorage-delete step
playwright-cli sessionstorage-clear
```

## 网络和 DevTools

```bash
playwright-cli route "**/*.jpg" --status=404
playwright-cli route "https://api.example.com/**" --body='{"mock": true}'
playwright-cli route-list
playwright-cli unroute "**/*.jpg"
playwright-cli unroute
playwright-cli console
playwright-cli console warning
playwright-cli requests
playwright-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
playwright-cli tracing-start
playwright-cli tracing-stop
playwright-cli video-start .temp/playwright-test/video.webm
playwright-cli video-stop
```

## 启动参数

```bash
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox
playwright-cli open --browser=webkit
playwright-cli open --browser=msedge
playwright-cli open --extension
playwright-cli open --persistent
playwright-cli open --profile=.temp/playwright-test/profile
playwright-cli open --config=.temp/playwright-test/cli.config.json
playwright-cli close
playwright-cli delete-data
```

## 快照

不需要落盘时，让快照直接返回到标准输出。快照属于工作流交付物时才显式指定文件名，并写入 `.temp/playwright-test/`。

```text
> playwright-cli goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.temp/playwright-test/page-2026-02-14T19-22-42-679Z.md)
```

可以随时执行：

```bash
playwright-cli snapshot
```

## 浏览器会话

```bash
playwright-cli -s=mysession open example.com --persistent
playwright-cli -s=mysession open example.com --profile=.temp/playwright-test/profile
playwright-cli -s=mysession click e6
playwright-cli -s=mysession close
playwright-cli -s=mysession delete-data
playwright-cli list
playwright-cli close-all
playwright-cli kill-all
```

## 本地执行回退

全局 `playwright-cli` 不可用时，可以使用 `npx playwright-cli`：

```bash
npx playwright-cli open https://example.com
npx playwright-cli click e1
```

## 常见流程

表单提交：

```bash
playwright-cli open https://example.com/form
playwright-cli snapshot
playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password123"
playwright-cli click e3
playwright-cli snapshot
playwright-cli close
```

多标签页：

```bash
playwright-cli open https://example.com
playwright-cli tab-new https://example.com/other
playwright-cli tab-list
playwright-cli tab-select 0
playwright-cli snapshot
playwright-cli close
```

调试：

```bash
playwright-cli open https://example.com
playwright-cli tracing-start
playwright-cli click e4
playwright-cli fill e7 "test"
playwright-cli console
playwright-cli requests
playwright-cli tracing-stop
playwright-cli close
```
