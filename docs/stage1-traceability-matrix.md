# Stage1 需求追踪矩阵（Draft）

| 原始需求 | 细化文档条目 | 验收项 |
| --- | --- | --- |
| 左中右三栏分区 | `stage1-prd-refined.md` / FR-LAYOUT-01 | AC-00 |
| 右侧上下分区信息 | `stage1-prd-refined.md` / FR-LAYOUT-02 | AC-00 |
| 放置机器 | `stage1-prd-refined.md` / FR-CANVAS-02 | AC-01 |
| 拖入放置/拖出删除 | `stage1-prd-refined.md` / FR-CANVAS-02 | 回归：新建/删除机器 |
| 拖拽/框选移动 | `stage1-prd-refined.md` / FR-CANVAS-02 | 回归：画布操作 |
| 删除机器 | `stage1-prd-refined.md` / FR-CANVAS-03 | 回归：新建/删除机器 |
| 缩放平移 | `stage1-prd-refined.md` / FR-CANVAS-04 | 性能基线：交互流畅 |
| 整格缩放与最小全图 | `stage1-prd-refined.md` / FR-CANVAS-04 | AC-00 |
| 选中工具条与 R 旋转 | `stage1-prd-refined.md` / FR-CANVAS-05 | AC-06 |
| 建筑重叠红色提示与停机 | `stage1-prd-refined.md` / FR-CANVAS-06 | AC-03B |
| 连接创建 | `stage1-prd-refined.md` / FR-EDGE-01 | AC-01 |
| 物流模式（管道/传送带）绘制 | `stage1-prd-refined.md` / FR-EDGE-01 | AC-04B |
| 禁止 out->out / in->in | `stage1-prd-refined.md` / FR-EDGE-02 | AC-04 |
| 删除连接 | `stage1-prd-refined.md` / FR-EDGE-03 | 回归：创建/删除连接 |
| Tick 仿真 | `stage1-prd-refined.md` / FR-SIM-01 | AC-01, AC-02 |
| 矿电无限但统计消耗 | `stage1-prd-refined.md` / FR-SIM-02 | AC-01 |
| 首批物品冻结（源石矿/原矿粉末） | `stage1-prd-refined.md` / FR-SIM-02C | AC-15, AC-16 |
| 每种物品多配方支持 | `stage1-prd-refined.md` / FR-SIM-02A | AC-13 |
| 双产物配方兼容（暂不执行） | `stage1-prd-refined.md` / FR-SIM-02B | AC-14 |
| 缺料状态 | `stage1-prd-refined.md` / FR-SIM-03 | AC-03 |
| 重叠停机结算禁用 | `stage1-prd-refined.md` / FR-SIM-03 | AC-03B |
| 暂停/1x/2x/4x 速率控制 | `stage1-prd-refined.md` / FR-SIM-04 | AC-02B |
| 物品取货口边缘有效摆放 | `stage1-prd-refined.md` / FR-BUILD-01 | AC-08 |
| 粉碎机三进三出边布局 | `stage1-prd-refined.md` / FR-BUILD-02 | AC-12 |
| 供电桩中心 8x8 矩形覆盖供电 | `stage1-prd-refined.md` / FR-BUILD-03 | AC-10 |
| 物流存储箱系统外出货 | `stage1-prd-refined.md` / FR-BUILD-04 | AC-11 |
| 灌装机 6 入 6 出端口 | `stage1-prd-refined.md` / FR-BUILD-05 | AC-12 |
| 传送带不重叠与三种交汇 | `stage1-prd-refined.md` / FR-BELT-01 | AC-09 |
| 传送带交叉直行互不干扰 | `stage1-prd-refined.md` / FR-BELT-02 | AC-09 |
| 分流左中右轮询（顺时针） | `stage1-prd-refined.md` / FR-BELT-03 | AC-09 |
| 汇流左中右轮询（顺时针） | `stage1-prd-refined.md` / FR-BELT-04 | AC-09 |
| 传送带速度每2秒1格 | `stage1-prd-refined.md` / FR-BELT-05 | AC-17 |
| 全局库存 | `stage1-prd-refined.md` / FR-INV-01 | AC-01, AC-05 |
| 重置库存 | `stage1-prd-refined.md` / FR-INV-02 | AC-05 |
| 统计面板 | `stage1-prd-refined.md` / FR-PANEL-01 | AC-01, AC-02 |
| 选中建筑详情面板 | `stage1-prd-refined.md` / FR-PANEL-02 | AC-06 |
| 基础操作集合 | `stage1-prd-refined.md` / FR-OPS-01 | 回归清单 |
| localStorage 存档 | `stage1-prd-refined.md` / NFR-02 | 回归：存档恢复 |
| 50 台机器可用 | `stage1-prd-refined.md` / NFR-03 | 性能基线 |
| 当前不采用游戏引擎 | `stage1-prd-refined.md` / NFR-04 | AC-07 |

## 待补充映射（下一轮讨论）

- 重置库存是否清空累计统计，需补充一致性验收项。
