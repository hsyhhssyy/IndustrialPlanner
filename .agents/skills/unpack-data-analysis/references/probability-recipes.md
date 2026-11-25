# 概率配方与 byproduct 语义

分析 `FactoryMachineCraftTable` 中 `byproduct.prob > 0` 的配方，或把这类解包数据换算为项目 `RecipeDefinition` 时，必须先读本页。

## 1. 固定来源与版本

按 [数据源选择与 Raw Table 契约](data-sources.md) 固定单一来源与完整版本 ID，获取 `FactoryMachineCraftTable`。报告必须给出 manifest 中的来源 URL 与 SHA-256；不得使用 `latest`。

## 2. 表结构

```json
{
  "id": "gas_reactor_gas_copper_bright_clear_1",
  "machineId": "gas_reactor_1",
  "totalProgress": 12000,
  "ingredients": [{ "group": [{ "count": 1, "id": "item_gas_copper_enr_heng" }, { "count": 1, "id": "item_gas_xiranite_enr_heng" }] }],
  "outcomes": [{ "group": [{ "count": 2, "id": "item_gas_copper_bright_clear" }] }],
  "byproduct": { "count": 2, "id": "item_gas_copper_bright_turbid", "prob": 50 }
}
```

只有 `byproduct.prob > 0` 的条目带概率；无概率条目固定为 `{ "count": 0, "id": "", "prob": 0 }`。

## 3. 正确语义：互斥结果分支

`byproduct.prob > 0` 时：

- `outcomes` 与 `byproduct` 是**互斥**的两种结果，一次生产只产出其中一种。
- `prob` 是 `byproduct` 分支的占比（百分数），剩余 `100 - prob` 归 `outcomes` 分支。
- **`outcomes` 不是必出产物**，它只是另一分支的产物。

字段名 `byproduct`（副产物）与 `prob`（概率）会诱导“主产物必出 + 概率追加副产物”的解读，**该解读错误**。禁止按字段名推断语义。

## 4. 证据等级

| 证据 | 结论 |
| --- | --- |
| 游戏实测（用户口径，2026-11-25） | 气体反应炉产出清型与浊型辉铜气各 50%，无必出产物 |
| 解包数据 | `1.7.2@12026241-3` 全表仅 1 条 `byproduct.prob > 0` 记录，表内无法自我交叉验证 |

结论权威来源是游戏实测，解包只提供数值。因为样本量只有 1 条，**不得**从单条记录归纳规则，也不得在无实测支持时把该语义外推到未来新增的概率配方；新版本出现 `prob > 0` 条目却与实测冲突时，以实测为准并重新核对本页。

## 5. 换算到项目 RecipeDefinition

项目 `RecipeDefinition` 没有副产物分支字段，`probability` 表达的是候选权重，因此换算规则为：

- 为每个结果分支各建一条独立配方，`probability` 取该分支占比（如各 `0.5`）。
- 两条配方的 `inputs`、`durationSeconds`、`machineId`、`recipeType` 保持一致。
- 同一 channel 按权重择一命中时，原料只消耗一次，产物只按命中分支产出，与解包互斥语义等价。
- 不得把 `outcomes` 建成无条件配方、把 `byproduct` 建成 `probability` 配方，那会同时产出两个分支。
- 不得把 `prob` 直接当作“额外产出概率”或对产物数量做期望值折算。

## 6. 禁止事项

- 不得把 `byproduct` 解读为“主产物必出后的追加产出”。
- 不得只用 `outcomes` 建模并丢弃 `byproduct`，除非用户明确同意放弃该分支产物。
- 不得用 `outcomes` 分支覆盖率为 100% 之类的推断替代游戏实测。
- 不得因该语义存在就假定所有设备都有概率行为；概率语义只在 `prob > 0` 时成立。
