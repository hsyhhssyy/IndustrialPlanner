---
name: generic-issue-log-analysis
description: 分析 IndustrialPlanner 仓库可直接访问的公开 GitHub issue、评论和附件并提出修复建议时使用；私有 issue、仅要求实现修复或不涉及本仓库 issue 的一般排障不得使用。
---

# 公开 Issue 分析

## 能做什么

- 按 [分析流程](references/workflow.md) 获取 issue 现场并回溯当前代码。
- 按 [证据规则](references/evidence-policy.md) 判断根因和置信度，并按 [输出格式](references/output-format.md) 汇报。

## 不能做什么

- 不得引用或依赖 `.temp/json-export.json`、`.docs/` 等私有数据，也不得未经单独授权读取其他 branch、worktree 或历史 tag。
- 不得把猜测写成最终结论，不得在用户只要求分析时实现修复。
