# Stage3 开发文档集（承接 Stage2 冻结未实现项）

Stage3 用于承接 Stage2 冻结后未落地能力，原则为“契约先行、口径一致、可回归、可回滚”。

## 阶段定位

- 来源：Stage2 冻结移交
- 启动日期：2026-02-26
- 阶段目标：补齐 Stage2 历史草案中未落地的高优先级能力

## Stage3 主目标

1. 电力模型补齐
   - 引入设备 `powerDemand/powerSupply`
   - 引入净功率计算
   - 引入即时/10 分钟/1 小时统计（标准秒）
   - 运行语义改造为“缺电不降速不停机，接网前置仍保留”

2. 流体网络规则补齐
   - 连通管道本体等效容量：`2 × 管道长度`
   - 单液体锁定（传染）
   - 系统与连通储液罐排空后切换液体

3. 抽水泵口径补齐
   - 输出效率由领域模型配置提供并参与吞吐
   - 与地区放置规则、接网口径联合验证

4. 瓶装液体交互与执行补齐
   - 通用列表隐藏组合项
   - 专用选择器（瓶型 + 液体）
   - 单展示多展开执行口径一致

5. 反应池槽位模型对齐
   - 从“5 共享槽位”升级到“3 固体 + 2 液体独立槽位”

## 文档索引

1. `00-change-log-and-goals-stage3.md`
2. `01-scope-and-dod-stage3.md`
3. `02-design-delta-stage3.md`
4. `03-migration-guide-stage2-to-stage3.md`
5. `04-api-and-contract-changes-stage3.md`
6. `05-regression-test-plan-stage3.md`
7. `06-risk-and-rollback-stage3.md`
8. `07-release-notes-stage3.md`

## 与 Stage2 的边界

- Stage2：冻结，不再新增需求。
- Stage3：仅承接 Stage2 未落地条目，不反向修改 Stage2 冻结验收结论。
