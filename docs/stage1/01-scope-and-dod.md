# 01 范围与完成定义（Scope & DoD）

## 1. 目标声明

Stage1 的目标是交付“可编辑 + 可仿真 + 可观察”的工业系统最小闭环，覆盖 `originium_ore -> originium_powder` 基础产线。

用户必须能够：

- 放置设备、旋转设备、拖拽移动、框选移动、删除设备
- 绘制传送带，并自动创建 `splitter` / `merger` / `bridge`
- 启动/退出仿真，切换 `1x/2x/4x/16x`
- 查看库存、产消速率、设备状态与停机原因

## 2. Stage1 冻结清单

### 2.1 设备类型（11 类）

- `pickup_port_3x1`
- `crusher_3x3`
- `power_pole_2x2`
- `storage_box_3x3`
- `filler_6x4`
- `belt_straight_1x1`
- `belt_turn_cw_1x1`
- `belt_turn_ccw_1x1`
- `splitter_1x1`
- `merger_1x1`
- `bridge_1x1`

### 2.2 物品与配方

- 物品：`originium_ore`, `originium_powder`
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
- **运行时类型**：每个设备类型必须声明 `runtimeKind`（`processor/storage/conveyor/junction`）
- **停机状态**：`stallReason != NONE`

## 4. DoD（完成标志）

以下全部满足，Stage1 才可判定完成：

1. 可搭建并稳定运行 `originium_ore -> originium_powder` 产线
2. 增减设备后，统计面板产量变化方向与幅度符合预期
3. 缺料、堵塞、重叠等停机原因可被明确识别并展示
4. 能看到矿物相关统计与设备运行状态（按当前项目口径呈现）
5. 退出仿真后，运行态数据完全清理（进度、系统外库存、临时状态）

补充说明：`filler_6x4` 在 Stage1 可放置、可旋转，用于编辑态与旋转测试，不参与功能生产。

## 5. 范围守卫（防止需求漂移）

开发过程中出现以下诉求，统一归档 Stage2+ Backlog，不纳入 Stage1：

- 新设备或新配方扩展
- 管道与流体系统
- 智能寻路、自动纠错连接
- 运行期高级可视化（动画层、图表层、高级筛选）
