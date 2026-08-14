---
name: full-check
description: 用户要求完整代码质量检查，或要求测试但未明确指定单一测试集时使用；用户明确指定单一测试集、仅需编写测试或只需分析检查结果时不得使用。
---

# 完整代码质量检查

## 能做什么

- 按 [完整检查执行规范](references/execution.md) 运行 eslint、tsc、test、build、e2e 和 test:blueprint。
- 按 [检查报告格式](references/report-format.md) 汇总结果和失败测试。

## 不能做什么

- 不得自行缩小检查范围、拼写底层检查命令或绕过 `scripts/check/full-check.sh`。
- 不得根据检查结果修改业务代码、测试代码或配置，也不得删除检查产物。
