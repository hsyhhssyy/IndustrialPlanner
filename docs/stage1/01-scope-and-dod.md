# 01 范围与完成定义（Scope & DoD）

## 1. 目标声明

Stage1 的目标是交付“可编辑 + 可仿真 + 可观察”的工业系统最小闭环，覆盖 `item_originium_ore -> item_originium_powder` 基础产线。

用户必须能够：

- 放置设备、旋转设备、拖拽移动、框选移动、删除设备
- 绘制传送带，并自动创建 `splitter` / `merger` / `bridge`
- 启动/退出仿真，切换 `1x/2x/4x/16x`
- 查看库存、产消速率、设备状态与停机原因
- 在中文/英文之间切换界面语言（左上角入口）

地块规格（当前实现）：`60x60` 与 `40x40`。

## 2. Stage1 冻结清单

### 2.1 设备类型（10 类）

- `item_port_unloader_1`
- `item_port_grinder_1`
- `item_port_power_diffuser_1`
- `item_port_storager_1`
- `belt_straight_1x1`
- `belt_turn_cw_1x1`
- `belt_turn_ccw_1x1`
- `item_log_splitter`
- `item_log_converger`
- `item_log_connector`

### 2.2 物品与配方

- 物品：`item_originium_ore`, `item_originium_powder`
- 配方：`r_crusher_originium_powder_basic`

### 2.3 明确不做

- 自动布局与产线自动求解
- 路径搜索
- 局部库存延迟/物流延迟建模
- 多产物结算

## 3. 术语与约束

- **设备实例**：工业区中的一切对象（含传送带格子与 junction）
- **端口**：设备某占格的某条边，不是点对象
- **连接**：仅当端口共享公共边、方向相对、一入一出、物品兼容
- **孤立物流**：允许空地到空地铺设传送带，视为合法编辑结果
- **运行时类型**：每个设备类型必须声明 `runtimeKind`（`processor/storage/conveyor/junction`）
- **供电需求**：每个设备类型必须声明 `requiresPower`（是否需要供电）
- Stage1 供电口径：仅 `item_port_grinder_1` 需要供电，其他设备不需要
- **停机状态**：`stallReason != NONE`
- **标准秒**：统一时间术语，表示“与仿真倍速无关的规则时间单位”。当 `tickRate=20` 时，`1 标准秒 = 20 tick`，`1 标准分钟 = 1200 tick`。

统计口径补充：

- 取货口从仓库取货，且可选择任意已定义物品（包括 `item_originium_powder`）。
- 存储箱是否将库存提交到仓库由用户配置项控制，默认提交（开启）；开启后按仿真时间每 1 秒批量提交一次该存储箱内所有物品。
- 统计仅反映仓库内物品总量与变化速率，不随当前地图设备增减直接变化。
- `/min` 按仿真时间计算，不受倍速按钮影响。
- 每次进入仿真前，仓库库存重置为统一初始值：`item_originium_ore=∞`，其他物品=`0`。
- 退出仿真时清空仓库物品数量与统计快照。

配置校验口径补充：

- `CONFIG_ERROR` 类问题统一在“进入仿真”时校验并立即标记，不延后到运行中触发。

## 4. DoD（完成标志）

以下全部满足，Stage1 才可判定完成：

1. 可搭建并稳定运行 `item_originium_ore -> item_originium_powder` 产线
2. 统计面板可稳定反映仓库物品总量与变化速率
3. 缺料、堵塞、重叠等停机原因可被明确识别并展示
4. 能看到仓库统计与设备运行状态（按当前项目口径呈现）
5. 退出仿真后，运行态数据完全清理（进度、仓库统计快照、临时状态）
6. 支持中英文语言切换，且刷新后保持上次语言选择

补充说明：`filler_6x4` 已移出 Stage1 冻结范围，不纳入实现与测试。

## 5. 范围守卫（防止需求漂移）

开发过程中出现以下诉求，统一归档 Stage2+ Backlog，不纳入 Stage1：

- 新设备或新配方扩展
- 管道与流体系统
- 智能寻路、自动纠错连接
- 运行期高级可视化（动画层、图表层、高级筛选）
