# Stage1 首批配置总表（Frozen）

说明：本表用于实现对齐，整合“建筑、物品、配方、物流与供电参数”。当前执行阶段为 Stage1 Phase1。

| 类别 | ID | 名称 | 尺寸/形态 | 输入 | 输出 | 核心规则 | Stage1状态 | 阶段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 物品 | `originium_ore` | 源石矿 | - | 仅物品取货口外部输入 | 可作为配方输入 | 不允许任何配方产出 | 启用 | Phase1 |
| 物品 | `originium_powder` | 原矿粉末 | - | 配方产出 | 可作为后续配方输入/统计项 | 首批由粉碎机配方产出 | 启用 | Phase1 |
| 建筑 | `pickup_port_3x1` | 物品取货口 | 3x1 | 外部系统 | 中间格唯一出口 | 长边必须贴工业区边缘，否则无效 | 启用 | Phase1 |
| 建筑 | `crusher_3x3` | 粉碎机 | 3x3 | 一整边3个输入口 | 对边3个输出口 | 可选配方执行生产 | 启用 | Phase1 |
| 建筑 | `power_pole_2x2` | 供电桩 | 2x2 | - | 供电覆盖 | 以供电桩中心为基准8x8矩形，建筑任一格落入即有电 | 启用 | Phase1 |
| 建筑 | `storage_box_3x3` | 物流存储箱 | 3x3 | 一整边输入 | 对边输出 + 系统外提交 | 可配置每分钟提交系统外 | 启用 | Phase1 |
| 建筑 | `filler_6x4` | 灌装机 | 6x4 | 6个输入口（长边） | 6个输出口（对侧长边） | 长边端口成组定义 | 启用 | Phase1 |
| 配方 | `r_crusher_originium_powder_basic` | 原矿粉碎（基础） | 2秒/周期 | 1×`originium_ore` | 1×`originium_powder` | 粉碎机执行；数据基准为1x | 启用 | Phase1 |
| 配方（兼容） | `r_future_dual_output` | 未来双产物示例 | 6秒/周期 | 2×`originium_ore` | 1×`originium_powder`（`out_main`）+ 1×`slag`（`out_side`） | 双产物+指定出口，需兼容读取/存档 | 兼容未启用 | Phase2+ |
| 物流规则 | `belt_cell_cross` | 传送带交叉 | 单格节点 | 两组对向入口 | 两组对向出口 | 两路直行互不干扰 | 启用 | Phase1 |
| 物流规则 | `belt_cell_split` | 传送带分流 | 单格节点 | 1入口 | 3出口 | 左/中/右顺序轮询（顺时针定义） | 启用 | Phase1 |
| 物流规则 | `belt_cell_merge` | 传送带汇流 | 单格节点 | 3入口 | 1出口 | 左/中/右顺序轮询（顺时针定义） | 启用 | Phase1 |
| 物流参数 | `belt_speed` | 传送带速度 | 常量 | - | - | 固定每2秒移动1格 | 启用 | Phase1 |
| 仿真参数 | `sim_speed_levels` | 倍速档位 | 常量 | - | - | `0/1/2/4`（暂停/1x/2x/4x） | 启用 | Phase1 |

## 备注

- 多产物配方在 Stage1 仅兼容，不参与生产结算。
- 首批业务闭环为：`originium_ore -> originium_powder`。