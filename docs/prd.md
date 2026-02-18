# 终末地集成工业系统仿真器

# Product Requirements Document（PRD）

## Stage1 冻结版（完整规格）

---

# 0. Background

## 0.1 项目背景

本项目用于模拟《明日方舟：终末地》中的“集成工业系统”，构建一个规则显式、可计算、可扩展的工业仿真软件。

本项目定位为：

> 工业系统仿真与规则验证工具
> 而非原创工业游戏

本项目目标：

* 对终末地工业规则进行结构化建模
* 实现端口级显式连接
* 实现离散 Tick 仿真
* 保持架构可扩展至自动求解与流体工业

本项目：

* 不依赖游戏源码
* 不进行视觉资产复刻
* 不包含商业发行目标
* 专注规则与仿真一致性

---

## 0.2 技术约束

* 纯前端实现
* 不依赖后端服务
* 可离线运行
* 使用浏览器原生 Web 技术
* 使用 localStorage 进行存档
* 可部署至 GitHub Pages
* 不使用游戏引擎

---

## 0.3 阶段规划

### Stage1（当前阶段）

* 建立稳定的工业建模框架
* 验证端口邻接规则
* 实现基础闭环产线
* 建立统一运行时状态模型

### Stage2

* 增加更多配方
* 启用多产物配方
* 引入更复杂输入组合

### Stage3

* 自动产线布局计算
* 目标产量反推设备数量
* 图搜索 / 优化算法

### Stage4

* 引入管道系统
* 引入液体工业
* 扩展流体仿真模型

---

# 1. Stage1 范围定义

## 1.1 阶段目标

用户可以：

* 放置设备
* 旋转设备
* 拖拽移动设备
* 框选移动
* 删除设备
* 绘制传送带
* 自动创建分流/汇流/桥接节点
* 运行仿真
* 查看库存与统计
* 识别停机原因

---

## 1.2 冻结清单

### 设备（11类）

* pickup_port_3x1
* crusher_3x3
* power_pole_2x2
* storage_box_3x3
* filler_6x4
* belt_straight_1x1
* belt_turn_cw_1x1
* belt_turn_ccw_1x1
* splitter_1x1
* merger_1x1
* bridge_1x1

### 物品

* originium_ore
* originium_powder

### 启用配方

* r_crusher_originium_powder_basic

---

## 1.3 不包含

* 自动布局
* 寻路
* 局部库存延迟
* 物流延迟建模
* 多产物实际结算

---

# 2. 核心建模原则（冻结）

---

## 2.1 全设备化建模

* 工业区内所有对象均为设备实例
* 传送带每格为设备
* splitter/merger/bridge 必须为显式设备
* 禁止隐式节点
* 禁止“动态连接对象”

---

## 2.2 领域模型必须声明 runtimeKind

每个设备类型必须声明：

```
runtimeKind:
  - processor
  - storage
  - conveyor
  - junction
```

运行时状态由 runtimeKind 决定。

---

# 3. 端口模型（冻结）

---

## 3.1 端口几何定义

端口不是点，不是格子。

端口定义为：

> 设备占据的某个格子的某一条边

字段：

* localCellX
* localCellY
* edge（N / S / E / W）
* direction（Input / Output）
* allowedItems（mode + whitelist）
* allowedTypes

---

## 3.2 旋转规则

* 仅提供 0° 布局
* 运行时按 90° 旋转
* 围绕几何中心
* 端口 edge 同步旋转
* 设备名称不旋转

---

## 3.3 连接成立条件

连接成立必须满足：

1. 两端口处于同一公共边
2. edge 相对
3. 一入一出
4. 物品类型兼容

系统不存在寻路。

---

## 3.4 统一端口握手协议

所有设备必须实现：

* canReceive(port, item)
* receive(port, item)
* canSend(port, item)
* send(port)

---

# 4. 运行时状态模型

---

## 4.1 所有设备统一字段

* progress01 ∈ [0,1]
* stallReason
* isStalled = stallReason != NONE

---

## 4.2 stallReason 枚举

* NONE
* NO_POWER（无供电覆盖/供电异常）
* OVERLAP
* NO_INPUT
* OUTPUT_BLOCKED
* CONFIG_ERROR

---

# 5. 设备运行模型

---

## 5.1 processor（生产设备）

* inputBuffer
* outputBuffer
* progress01 表示生产周期

输入端口共用 inputBuffer
输出端口共用 outputBuffer

---

## 5.2 conveyor / junction

* slot（容量=1）
* progress01 表示运输进度

---

# 6. 传送带双区间进度模型（冻结）

---

## 6.1 进度划分

progress01 ∈ [0,1]

* 入口段：0 ~ 0.5
* 出口段：0.5 ~ 1.0

---

## 6.2 入口段规则

* 只要 slot != null
* progress 可推进至 ≤ 0.5
* 不依赖下游可接收

---

## 6.3 出口段规则

* 仅当下游在 Commit 后将有容量
* 才允许 progress > 0.5

---

## 6.4 中心停靠点

* 下游不可接收时
* progress 停在 0.5

---

# 7. 两阶段更新机制（防奇偶交替）

---

每 tick：

### Phase A：Plan

* 计算哪些设备将在本 tick 末交接
* 计算下游是否将腾出容量
* 预留接收权（reservation）

### Phase B：Commit

* 更新 progress
* 执行交接
* 更新 slot

下游可接收定义：

* 当前空
* 或本 tick 末将腾空
* 且入口未被其他设备预留

---

# 8. UI 与交互系统（完整描述）

---

## 8.1 页面布局

* 左侧：工具栏
* 中央：工业区网格
* 右侧：信息面板
* 顶部：仿真控制条

---

## 8.2 四模式编辑

### 选择模式

* 单击选择设备
* 再次点击空白取消选择
* 拖拽移动
* 框选移动
* R 键旋转

### 放置模式

* 选择设备类型
* 点击网格左上角放置

### 物流模式

* 子模式：传送带
* 按住左键拖拽铺设
* 仅支持格线方向
* 不允许单格铺设
* 起点必须为：

  * 设备输出端口
  * 空地
  * 传送带（自动创建 splitter）
* 终点必须为：

  * 设备输入端口
  * 空地
  * 传送带（自动创建 merger）
* 跨直线带自动创建 bridge
* 禁止跨拐角带

### 删除模式

* 单格删除
* 删除整条联通带
* 联通采用 4 邻接
* 经过 bridge 的两条交叉通道独立判定与删除

---

## 8.3 仿真控制

* 开始仿真
* 退出仿真
* 1x / 2x / 4x / 16x
* 顶栏提示信息（用于反馈当前可操作状态）

退出仿真：

* 清空运行态
* 清空系统外库存
* 清空设备进度

---

# 9. 库存系统

---

## 9.1 系统外仓库

* 无限容量
* originium_ore 无限

---

# 10. 统计面板

---

必须显示：

* 当前库存
* 每分钟产量
* 每分钟消耗
* 设备状态

排序：

* 矿物优先
* 其余按 itemId 字母序

---

# 11. UX 冻结规则

* 设备粗边框矩形
* 箭头表示端口方向
* 名称居中显示
* 停机显示红框与图标
* 未选择物品显示 “?”

---

# 12. 非功能需求

* 纯前端实现
* localStorage 存档
* 无后端依赖
* 可部署 GitHub Pages
* 不依赖游戏引擎

---

# 13. 完成标志（DoD）

满足：

1. 可搭建 originium_ore → originium_powder 产线
2. 增减设备可改变产量
3. 缺料提示明确
4. 可见矿物产消统计与设备状态

补充说明：

* filler_6x4 在当前阶段可放置、可旋转，用于编辑与旋转测试，不参与功能生产。
