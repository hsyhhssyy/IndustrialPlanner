# Stage1 需求追踪矩阵（Draft）

| 原始需求 | 细化文档条目 | 验收项 |
| --- | --- | --- |
| 左中右三栏分区 | `stage1-prd-refined.md` / FR-LAYOUT-01 | AC-00 |
| 右侧上下分区信息 | `stage1-prd-refined.md` / FR-LAYOUT-02 | AC-00 |
| 顶部仿真控制条 | `stage1-prd-refined.md` / FR-LAYOUT-04 | AC-02B |
| 地块尺寸选择（60/80/100） | `stage1-prd-refined.md` / FR-LAYOUT-03 | AC-00, AC-05B |
| 放置机器 | `stage1-prd-refined.md` / FR-CANVAS-02 | AC-01 |
| 放置模式点击放置/删除模式删除 | `stage1-prd-refined.md` / FR-CANVAS-02 | 回归：新建/删除机器 |
| 拖拽/框选移动 | `stage1-prd-refined.md` / FR-CANVAS-02 | 回归：画布操作 |
| 删除机器 | `stage1-prd-refined.md` / FR-CANVAS-03 | 回归：新建/删除机器 |
| 缩放平移 | `stage1-prd-refined.md` / FR-CANVAS-04 | 性能基线：交互流畅 |
| 连续缩放与最小全图 | `stage1-prd-refined.md` / FR-CANVAS-04 | AC-00 |
| 选中工具条与 R 旋转 | `stage1-prd-refined.md` / FR-CANVAS-05 | AC-06 |
| 建筑仅90°旋转与端口相对保持 | `stage1-prd-refined.md` / FR-CANVAS-05 | AC-06 |
| 端口单朝向配置与旋转自动计算 | `stage1-prd-refined.md` / FR-CANVAS-05 | AC-06B |
| 建筑重叠红色提示与停机 | `stage1-prd-refined.md` / FR-CANVAS-06 | AC-03B |
| 连接创建 | `stage1-prd-refined.md` / FR-EDGE-01 | AC-01 |
| 物流模式（管道占位/传送带可用）绘制 | `stage1-prd-refined.md` / FR-EDGE-01 | AC-04B |
| 传送带绘制起止规则与禁回头 | `stage1-prd-refined.md` / FR-EDGE-01A | AC-09 |
| 禁止 out->out / in->in | `stage1-prd-refined.md` / FR-EDGE-02 | AC-04 |
| 删除连接 | `stage1-prd-refined.md` / FR-EDGE-03 | 回归：创建/删除连接 |
| 传送带逐格/联通删除 | `stage1-prd-refined.md` / FR-EDGE-03A | 回归：创建/删除连接 |
| 联通删除无需二次确认 | `stage1-prd-refined.md` / FR-EDGE-03A | AC-09 |
| 联通删除采用4邻接 | `stage1-prd-refined.md` / FR-EDGE-03A | AC-09 |
| Tick 仿真 | `stage1-prd-refined.md` / FR-SIM-01 | AC-01, AC-02 |
| 仿真频率固定 10Hz | `stage1-prd-refined.md` / FR-SIM-01 | AC-05C |
| Phase1 tick 顺序冻结（先推进再结算检查） | `stage1-simulation-spec.md` / 4.每tick结算顺序 | AC-13B |
| 矿电无限但统计消耗 | `stage1-prd-refined.md` / FR-SIM-02 | AC-01 |
| 首批物品冻结（源石矿/原矿粉末） | `stage1-prd-refined.md` / FR-SIM-02C | AC-15, AC-16 |
| 外部仓库回取规则 | `stage1-prd-refined.md` / FR-SIM-02D | AC-18 |
| 外部仓库无手动清空 | `stage1-prd-refined.md` / FR-SIM-02D | AC-20 |
| 每种物品多配方自动决策 | `stage1-prd-refined.md` / FR-SIM-02A | AC-13 |
| 同机型输入必须唯一匹配（0或多匹配报错） | `stage1-prd-refined.md` / FR-SIM-02A | AC-13 |
| 双产物配方兼容（暂不执行） | `stage1-prd-refined.md` / FR-SIM-02B | AC-14 |
| 缺料状态 | `stage1-prd-refined.md` / FR-SIM-03 | AC-03 |
| 重叠停机结算禁用 | `stage1-prd-refined.md` / FR-SIM-03 | AC-03B |
| 开始仿真/退出仿真与1x/2x/4x速率控制 | `stage1-prd-refined.md` / FR-SIM-04 | AC-02B |
| 开始仿真/退出仿真模式切换 | `stage1-prd-refined.md` / FR-SIM-04 | AC-02B |
| 退出仿真清空全部运行态内容 | `stage1-prd-refined.md` / FR-SIM-04 | AC-02B, AC-05 |
| 仿真模式锁编辑 | `stage1-prd-refined.md` / FR-SIM-04 | AC-02C |
| 物品取货口边缘有效摆放 | `stage1-prd-refined.md` / FR-BUILD-01 | AC-08 |
| 取货口方向字段为可选实现项 | `stage1-data-dictionary.md` / 2.8A PickupPortConfig | AC-08 |
| 粉碎机三进三出边布局 | `stage1-prd-refined.md` / FR-BUILD-02 | AC-12 |
| 供电桩中心 12x12 矩形覆盖供电 | `stage1-prd-refined.md` / FR-BUILD-03 | AC-10 |
| 供电覆盖坐标公式 `(x-5,y-5)` + `12x12` | `stage1-prd-refined.md` / FR-BUILD-03 | AC-10 |
| 物流存储箱系统外出货 | `stage1-prd-refined.md` / FR-BUILD-04 | AC-11 |
| 灌装机 6 入 6 出端口 | `stage1-prd-refined.md` / FR-BUILD-05 | AC-12 |
| 传送带不重叠与桥接/分流/汇流 | `stage1-prd-refined.md` / FR-BELT-01 | AC-09 |
| 传送带交叉直行互不干扰 | `stage1-prd-refined.md` / FR-BELT-02 | AC-09 |
| 分流单入多出判定 | `stage1-prd-refined.md` / FR-BELT-03 | AC-09 |
| 汇流多入单出判定 | `stage1-prd-refined.md` / FR-BELT-04 | AC-09 |
| 删除建筑保留传送带 | `stage1-prd-refined.md` / FR-CANVAS-03 | AC-09B |
| 传送带速度每2秒1格 | `stage1-prd-refined.md` / FR-BELT-05 | AC-17 |
| 全局库存 | `stage1-prd-refined.md` / FR-INV-01 | AC-01, AC-05 |
| 重置库存 | `stage1-prd-refined.md` / FR-INV-02 | AC-05 |
| 地块切换存档副作用 | `stage1-prd-refined.md` / FR-OPS-02 | AC-05B |
| 统计面板 | `stage1-prd-refined.md` / FR-PANEL-01 | AC-01, AC-02 |
| 右上仓库存量与每分钟产消 | `stage1-prd-refined.md` / FR-PANEL-01 | AC-19 |
| 右上仓库物品排序规则 | `stage1-prd-refined.md` / FR-PANEL-01 | AC-19 |
| 选中建筑详情面板 | `stage1-prd-refined.md` / FR-PANEL-02 | AC-06 |
| 取货口右下详情选品出货 | `stage1-prd-refined.md` / FR-PANEL-02 | AC-08 |
| 取货口未选图标默认`?` | `stage1-prd-refined.md` / FR-PANEL-02 | AC-08 |
| 基础操作集合 | `stage1-prd-refined.md` / FR-OPS-01 | 回归清单 |
| localStorage 存档 | `stage1-prd-refined.md` / NFR-02 | 回归：存档恢复 |
| Phase1暂不做性能基线验收 | `stage1-prd-refined.md` / NFR-03 | 验收总则 |
| 当前不采用游戏引擎 | `stage1-prd-refined.md` / NFR-04 | AC-07 |
| Phase1简化建筑视觉 | `stage1-prd-refined.md` / FR-UX-01 | AC-06 |
| 停机图标+红框提示 | `stage1-prd-refined.md` / FR-UX-02 | AC-10 |

## 待补充映射（下一轮讨论）

- 重置库存是否清空累计统计，需补充一致性验收项。
