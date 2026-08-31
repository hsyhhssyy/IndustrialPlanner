# 数据源选择与 Raw Table 契约

## 选择流程

1. 用户已明确指定来源时直接使用，不重复询问。
2. 用户未指定时，使用客户端的结构化提问能力选择：
   - `AKEData`：公开第三方 raw-table 服务，项目首选外部格式；
   - `本地 Raw Table`：手动解包生成的同构 `TableCfg` 目录；
   - `旧版 json-export`：只为迁移保留的低权威、可能有损来源。
3. 在提供 `AskQuestion` 的客户端必须调用 `AskQuestion`；没有该名称的客户端使用等价结构化问题，再无结构化能力时才用普通文本询问。
4. 选择 AKEData 后，如果用户没有指定完整版本 ID，先列出版本并再次询问。禁止把 `latest` 作为分析期间可漂移的版本。
5. 一次任务只使用一个来源和一个版本。缺表、网络失败、manifest/hash 错误时停止并报告，不静默切换来源。

建议问题的选项保持互斥，并明确 legacy 风险：

| 选项 | 适用情况 | 权威级别 |
| --- | --- | --- |
| AKEData | 没有本地 raw table，或需要公开版本 | `raw-table` |
| 本地 Raw Table | 已有对应游戏版本的手动解包 | `raw-table` |
| 旧版 json-export | 只需复核旧数据能覆盖的端口/设备字段 | `legacy-lossy` |

AKEData 是项目采用的外部 raw-table 参考来源，不是游戏官方发布渠道。报告中应写“项目权威 raw 格式”，不能写“官方数据”。

## AKEData 获取

先列出 manifest 中的完整版本：

```bash
node .agents/skills/unpack-data-analysis/scripts/fetch-akedata-tables.mjs \
  --list-versions
```

得到用户确认的版本后，只获取当前任务需要的表：

```bash
node .agents/skills/unpack-data-analysis/scripts/fetch-akedata-tables.mjs \
  --version 1.4.4@9599201-14 \
  --table FactoryBuildingTable \
  --table FactoryBuildingItemTable
```

默认输出到 `.temp/unpack/akedata/<完整版本 ID>/`。脚本会：

1. 读取 `https://data.akedata.wiki/manifest.json`；
2. 验证版本 ID 存在并使用版本自己的 `tableCfgPath`；
3. 校验返回内容是 JSON；
4. 把表原始字节写入 `TableCfg/<TableName>.json`；
5. 在 `source-manifest.json` 记录来源 URL、游戏版本、hotfix、获取时间和 SHA-256；
6. 默认复用同版本且 hash 一致的缓存，只有显式 `--refresh` 才重新获取。

禁止直接抓取 `latest` 后开始分析。manifest 的 `latest` 只能帮助发现版本，最终输入必须固定为 `versions[].id`。

## 本地 Raw Table

本地提供方应输出：

```text
<source-root>/
├── source-manifest.json
└── TableCfg/
    ├── FactoryBuildingTable.json
    ├── FactoryBuildingItemTable.json
    └── ...
```

`source-manifest.json` 最低契约：

```json
{
  "schemaVersion": 1,
  "source": "local",
  "sourceVersion": "1.4.4@9599201-14",
  "gameVersion": "1.4.4",
  "hotfixVersion": "9599201-14",
  "exportedAt": "2026-08-31T00:00:00.000Z",
  "tables": {
    "FactoryBuildingTable": {
      "file": "TableCfg/FactoryBuildingTable.json",
      "sha256": "<64 位小写十六进制>"
    }
  }
}
```

每个 manifest 表条目的路径必须精确为 `TableCfg/<TableName>.json`，表文件保持 AKEData raw schema，不得加入 `_name`、统计数据或其他派生字段。来源加载器会逐表核对路径和 SHA-256。

本地导出器必须在写 JSON 前保留 Int64。若导出器运行在 JavaScript 环境，Int64 应在进入 `number` 前保留原始 token、字符串或 `bigint`；不能先舍入再改成字符串。

## Legacy json-export

旧 `.temp/json-export.json` 是人工聚合和格式化结果，只提供四个已确认的过渡映射：

| Legacy 路径 | 分析表名 |
| --- | --- |
| `buildings.buildingTable` | `FactoryBuildingTable` |
| `buildings.buildingItemTable` | `FactoryBuildingItemTable` |
| `recipes` | `FactoryMachineCraftTable` |
| `buildings.machineCrafterTable` | `FactoryMachineCrafterTable` |

该映射只用于既有端口和设备分析，不声明与 raw table 完全等价。请求其他表时加载器必须失败；不得返回空表、推导表或把 `items` / `recipes` 等聚合结果冒充原始表。

## Raw table 任务路由

| 任务 | 首选原始表 |
| --- | --- |
| 设备占地、供电、端口、renderer mode | `FactoryBuildingTable` |
| 制造设备语义变体与配方组 | `FactoryMachineCrafterTable.modeMap` |
| 建筑物品到设备 ID | `FactoryBuildingItemTable` |
| renderer template 细节 | `FactoryBuildingRendererTemplateTable`，并结合 `FactoryBuildingTable.rendererTemplateMap` |
| 工厂物品 | `FactoryItemTable`、`ItemTable` |
| 制造配方 | `FactoryMachineCraftTable` 及相关 Factory craft 子表 |
| 聚落等级与交易 | `SettlementBasicDataTable` |
| 区域 ID 与名称引用 | `DomainDataTable` |
| 中文 / 英文文本 | `I18nTextTable_CN`、`I18nTextTable_EN` |

## 无损读取与来源报告

AKEData raw JSON 会把 Int64 写成未加引号的 JSON number。项目加载器使用 Node 22 `JSON.parse` reviver 的 `context.source`，把超出安全整数范围的整数保留为原始十进制字符串；禁止绕过该加载器后再保存解析结果。

每次分析先报告：

- `kind`：`akedata`、`local` 或 `legacy-json-export`；
- `authority`：`raw-table` 或 `legacy-lossy`；
- `sourceVersion`、游戏版本与 hotfix；
- 来源目录 / 文件；
- 实际读取的表及 manifest SHA-256。

下游分析可以创建派生视图，但不能覆盖或改写 `TableCfg` 文件。
