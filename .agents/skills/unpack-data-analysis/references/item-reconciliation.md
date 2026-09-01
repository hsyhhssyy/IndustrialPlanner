# 物品名称对账

使用以下脚本对账项目物品名称与 raw `ItemTable`：

```bash
node .agents/skills/unpack-data-analysis/scripts/audit-item-names.mjs \
  <raw-table 来源目录> [--all] [--json]
```

脚本必须显式接收已经固定版本并通过 manifest/hash 校验的 raw-table 来源。物品名称需要 `ItemTable`、`FactoryMachineCraftTable`、`I18nTextTable_CN` 与 `I18nTextTable_EN`，因此不支持缺少这些表的 legacy json-export。

## 为什么使用独立脚本

现有 `compare-exported-devices.mjs` 与 `audit-port-orientations.ts` 只处理设备、变体和端口，不解析 `ITEM_DEFINITIONS`、`ItemTable` 或容器关系；临时命令容易把缺少直接英文翻译和项目组合命名误报为 raw 名称差异。因此采用独立物品对账脚本，复用现有无损 raw-table 加载器，并固定以下分类语义。

## 普通物品

- 项目物品 ID 直接匹配 `ItemTable` ID。
- 中文和英文只在项目 registry 存在对应语言的直接条目时与 raw i18n 比较。
- 缺少直接条目必须归入“缺少直接 registry 翻译”，不得把运行时回退文本当成该语言的名称，也不得归入“名称修改”。

## 项目组合命名物品

同时带有以下两个 tag 的物品属于项目组合命名物品：

- `container:<容器物品 ID>`
- `container-item:<内容物物品 ID>`

游戏 raw 数据只为罐装成品提供容器通用名，没有稳定的“容器 + 内容物”显示名规范。项目以 `(containerId, contentItemId)` 作为组合语义，并使用自己的显示名规则：

- 中文：`容器名称（内容物名称）`
- 英文：`Container Name (Content Name)`

对账必须：

1. 从 `FactoryMachineCraftTable` 找到“容器 + 内容物 → 罐装成品”的灌装配方；
2. 用“罐装成品 → 容器 + 内容物”的拆解配方反向确认同一映射；
3. 使用项目 `container:` 与 `container-item:` 指向的 registry 名称验证组合名；
4. 不得把项目组合名与 raw 罐装成品的通用显示名直接比较。

raw ID 与项目稳定 ID 可以不同，例如 raw 液体瓶使用 `item_fbottle_*`，项目使用可读的组合稳定 ID。不得依靠字符串替换猜映射；以正反配方和两个 tag 为准。

## 报告分类

- `名称修改`：仅普通物品的直接 registry 翻译与 raw i18n 不同。
- `项目组合命名不一致`：项目罐装名称不符合容器与内容物组合规则。
- `无法解析的容器映射`：tag 不完整、项目组件缺失、正反配方不闭合或一组语义映射多个 raw 成品。
- `缺少 raw 证据的项目物品`：普通项目物品 ID 不存在于 `ItemTable`。
- `缺少直接 registry 翻译`：项目对应语言没有直接条目；这不是名称差异。
- `项目组合命名验证通过`：组合语义和所有可用的直接翻译符合项目规则；`--all` 输出明细。
