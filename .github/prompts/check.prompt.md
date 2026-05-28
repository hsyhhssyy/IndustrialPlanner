---
description: "对当前工作区执行完整的代码质量检查（eslint、tsc、test、build、test:blueprint），并以表格汇总未通过的测试"
argument-hint: "[额外说明...]"
agent: "agent"
---
请按照如下顺序检查当前工作区代码，注意不要根据测试结果进行任何修改：

1. 执行 `npx eslint . --ext .ts,.tsx` 并输出有问题的结果。
2. 执行 `npx tsc -b --noEmit`
3. 执行 `npm run test`（该测试耗时较长，等待输出时不设置超时）
4. 执行 `npm run build`
5. 执行 `npm run test:blueprint`

全部完成后，以表格形式输出未通过的测试，包含：
- 测试内容（测试用例名称）
- 测试的项目（所属测试文件或模块）
- 对应的结果（失败原因摘要）
