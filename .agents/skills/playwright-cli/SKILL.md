---
name: playwright-cli
description: 需要用真实浏览器导航网页、交互表单、测试 Web UI、截图、调试或提取页面数据时使用；纯静态代码分析、单元测试或不需要浏览器交互的信息查询不得使用。
---

# Playwright CLI 浏览器自动化

## 能做什么

- 常规浏览器操作读取 [命令参考](references/commands.md)。
- 按任务直接读取专项说明：[请求模拟](references/request-mocking.md)、[执行 Playwright 代码](references/running-code.md)、[会话管理](references/session-management.md)、[存储状态](references/storage-state.md)、[测试生成](references/test-generation.md)、[Tracing](references/tracing.md)、[视频录制](references/video-recording.md)。

## 不能做什么

- 不得把测试中间产物写到 `.temp/playwright-test` 之外，也不得占用项目禁止的 5173 端口。
- 不得把开发期间的临时自动化直接当作正式回归测试；创建正式测试文件时必须同时使用 `test-writing` skill。
