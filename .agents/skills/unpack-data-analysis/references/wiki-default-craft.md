# Wiki 默认配方核对

用于核对游戏内百科为某个物品指定的默认生产方式，以及项目 `src/registry/wiki-default-craft-definition.ts` 的规范化映射。该表只提供“物品 → 首选 craft 引用”，不提供所有候选配方的完整排序。

## 1. 固定并获取 AKEData 版本

先按 [数据源选择与 Raw Table 契约](data-sources.md) 固定完整版本 ID，不得使用 `latest`。获取以下三张表：

```bash
node .agents/skills/unpack-data-analysis/scripts/fetch-akedata-tables.mjs \
  --version <完整版本 ID> \
  --table WikiDefaultCraftTable \
  --table FactoryMachineCraftTable \
  --table FactoryItemTable
```

报告必须列出 `source-manifest.json` 中这三张表的来源 URL 与 SHA-256。若 AKEData 版本没有 `WikiDefaultCraftTable`，状态为“阻塞”，不得从游戏观感、项目 registry 或其他版本补造该表。

## 2. 解释表结构

`WikiDefaultCraftTable` 的 raw 结构是对象：

```json
{
  "<itemId>": "<sourceCraftId>"
}
```

- key 是百科目标物品 ID，必须能在当前版本物品表中确认。
- value 是百科使用的 raw craft 引用，命名为 `sourceCraftId`。
- `sourceCraftId` 不保证一定是 `FactoryMachineCraftTable` 的记录 ID；自然资源泵等条目可能使用百科伪 craft ID。
- JSON 键顺序不是配方优先级，也不能用于推断未入表候选之间的顺序。

## 3. 逐项核对

对 `WikiDefaultCraftTable` 的每个键值对执行：

1. 在 `FactoryItemTable` 中确认 `itemId` 存在；若项目物品采用规范化稳定 ID，再按既有物品对账规则证明映射。
2. 在 `FactoryMachineCraftTable` 中精确查找 `sourceCraftId`。
3. 若找到真实 craft：
   - 核对其产物包含目标 `itemId`；
   - 项目 `recipeId` 原则上应与 `sourceCraftId` 相同；不同则必须给出独立、可复核的稳定 ID 映射依据；
   - 配方时间、输入、输出和设备归属仍按普通配方流程核对，不能由 Wiki 默认关系代替。
4. 若未找到真实 craft：
   - 先记录为“百科伪 craft 引用”，不能误报为 AKEData 缺配方，也不能凭字符串猜项目 ID；
   - 在 `src/registry/wiki-default-craft-definition.ts` 中保留原始 `sourceCraftId`，另设项目 `recipeId`；
   - 核对该项目配方确实产出目标 `itemId`。采集型别名还必须验证零原料、对应泵/收集器设备及物态一致；
   - 明确报告：AKEData 只证明百科伪 craft 引用，项目 `recipeId` 是经审阅的本地规范化映射，不是 raw craft ID。
5. 检查同一 `itemId` 是否重复、项目映射是否缺项，以及项目 `recipeId` 是否不存在或不产出目标物品；任一情况都标记“需更新”或“阻塞”。

## 4. 跨版本与项目对账

跨版本时按 key 比较 `WikiDefaultCraftTable`：

- 新 key：新增百科默认关系；
- value 改变：默认 craft 发生变化；
- key 删除：来源已取消该默认关系；
- 仅 `FactoryMachineCraftTable` 内容变化：默认关系未变，但配方内容需要按普通配方更新流程复核。

项目对账输出至少包含：

| 字段 | 含义 |
| --- | --- |
| `itemId` | Wiki 表目标物品 |
| `sourceCraftId` | Wiki 表原始 value，必须原样保留 |
| `referenceKind` | `factory-craft` 或 `wiki-pseudo-craft` |
| `recipeId` | 项目规范化配方 ID |
| `outputsTarget` | 项目配方是否产出目标物品 |
| `status` | `一致`、`需更新` 或 `阻塞` |

最终结论必须把两类证据分开：

- `WikiDefaultCraftTable` 证明哪个 craft 引用是游戏百科默认；
- 项目共享比较器决定 Wiki 默认之外的本地展示/规划顺序。

不得声称 AKEData 已证明“其余配方按 ID、产量或原料数排序”，除非另有独立 raw 字段或游戏实测证据。
