# 设备对账脚本

本技能提供两类只读对账：

- `src/scripts/compare-exported-devices.mjs` 对账 raw building、语义变体、项目实体映射和 building 级名称。
- `.agents/skills/unpack-data-analysis/scripts/audit-port-orientations.ts` 对账解包逻辑端口与 registry 默认朝向。

两者用途不同。设备变体对账通过，不代表端口朝向或具体变体端口子集一致；端口朝向审计也不负责生成或修改 registry。

## 端口朝向审计

```bash
./node_modules/.bin/tsx --tsconfig tsconfig.app.json \
  .agents/skills/unpack-data-analysis/scripts/audit-port-orientations.ts \
  <raw-table 来源目录 | legacy json-export 文件> [--all] [--json]
```

- 必须显式传入已经固定版本的来源，不能让脚本自行选择或静默回退。
- raw-table 来源读取并校验 `FactoryBuildingTable`；legacy 来源只使用受限映射。
- 默认输出需要旋转、旋转对称和无法匹配的记录；`--all` 同时输出唯一 0° 匹配。
- `--json` 输出完整机器可读结果。
- 脚本只读，不修改 registry、蓝图、基地文档或视觉资源。

脚本固定执行以下逻辑：

1. 通过 `alter:` tag、已知历史别名或同名 ID，把 registry 实体映射到 `FactoryBuildingTable`。
2. 对解包端口统一应用 `localCellX = width - 1 - position.x`、`localCellY = position.z`。
3. 以方向角色、`isPipe` 和坐标构造多重集；registry 变体可以是 building 全部端口的子集。
4. 按项目 `GridRotation` 约定枚举四个顺时针正交旋转，并同时核对旋转后的占地尺寸。
5. 输出 `changed`、`unchanged`、`symmetric` 或 `unresolved`。唯一匹配角 `A` 表示“解包标准端口 → 当前 registry”；registry 修正角为 `-A mod 360`，既有蓝图和基地文档的旋转迁移量为 `+A mod 360`。`symmetric` 和 `unresolved` 必须单独调查。

端口角点的 `edge` 不作为独立匹配键：用户维护的 registry 已保证端口相对布局正确，设备整体旋转时坐标和 `edge` 必须一起旋转；解包 `rotation.y` 不能为角点提供稳定的一一方向映射。

## 设备变体对账

```bash
node src/scripts/compare-exported-devices.mjs \
  <raw-table 来源目录 | legacy json-export 文件> [--all-exported] [--help]
```

- 必须显式传入 raw-table 来源目录或 legacy JSON 文件。
- 默认只对账当前 registry 已覆盖的 raw building 家族。
- `--all-exported` 对账全部具备 buildingItem 映射、变体证据和可解析名称的 raw building。
- `--help` / `-h` 打印帮助。

raw-table 来源固定读取：

- `FactoryBuildingTable`
- `FactoryBuildingItemTable`
- `FactoryMachineCraftTable`
- `FactoryMachineCrafterTable`
- `I18nTextTable_CN`
- `I18nTextTable_EN`

legacy 来源读取同名的受限映射；报告权威级别仍为 `legacy-lossy`。

### Raw building 到项目变体

raw 的一个 building 可以对应多个项目实体。转换必须先建立语义变体，再解析项目 ID：

1. `FactoryBuildingItemTable` 建立物品 ID → `buildingId` 映射。
2. `FactoryMachineCrafterTable[buildingId].modeMap` 提供配方语义变体：
   - `modeName` 是语义变体名，对应项目 `alter-variant:`；
   - 非空 `groupName` 是配方组 ID，对应 `FactoryMachineCraftTable.formulaGroupId`；空字符串表示该 mode 没有制造配方组，但 mode 仍然有效；
   - `isEnvMode` 标记环境模式。
3. `FactoryMachineCraftTable` 按 `formulaGroupId` 提供每个语义变体的配方 ID；当前 `recipe-definition.ts` 中同配方 ID 的 `machineId` 用于证明项目实体实际覆盖哪些 raw mode。一个项目实体可以覆盖多个 raw mode。
4. `FactoryBuildingTable.rendererTemplateMap` 只给 `modeMap` 中已存在的语义 mode 补充 template ID，不能把同 mode 的多个 renderer template 展开成多个项目设备。仅当 building 没有任何 `modeMap` 语义变体时，renderer mode 才作为回退变体来源。
5. 项目实体通过以下规则映射：
   - `alter:<buildingId 或 buildingItemId>` 解析 raw building；
   - `alter-variant:<modeName>` 解析语义变体；
   - 没有 `alter:` 时，实体 ID 或 buildingItem ID 可以直接匹配 raw building；
   - raw building 只有一个语义变体时，该变体无条件视为默认，不受 `defaultRendererTemplate` 的 mode 名影响；
   - 多语义变体且没有 `alter-variant:` 时，使用唯一默认 renderer mode；
   - 无论默认映射为何，只要 raw mode 的配方 ID 在当前 registry 中归属于该项目实体，该实体同时覆盖该 raw mode；其余情况输出“无法解析”或“项目缺少的 raw 变体”。

`furnance_1`、`planter_1` 是必须覆盖的回归案例：它们的 `rendererTemplateMap` 只有 `normal`，但 `FactoryMachineCrafterTable.modeMap` 同时包含 `normal` 和 `liquid`；项目分别拆为普通实体与液体实体。

### 稳定 ID 与名称

- `(buildingId, modeName)` 是 raw 对账主键，不是项目稳定 ID。
- 项目稳定 ID 以 registry 为准。不得从 mode 机械生成 `{buildingId}_{mode}`，也不得根据 renderer template 分组序号生成项目 ID。
- `FactoryBuildingTable.name.id` 是 building 级名称引用。通过无损 ID 查询中英文 i18n 后，与映射到该 building 的项目实体名称比较。
- raw 没有变体专属名称时，不得人工拼接“(液体)”“(气体)”等后缀并作为权威名称。
- 超过 5 个字的 raw 中文建筑名称需要特殊审阅。只有脚本中显式记录项目实体 ID、当前中文、raw 中文和用户审阅理由的精确例外可以保留；不得按长度自动忽略差异。当前已审阅例外为 `log_hongs_bus` 的“存取线基段”与 `log_hongs_bus_source` 的“存取线源桩”，均由用户明确压缩为 5 个字。

### 报告分类

脚本输出字段级结果，不把修改伪装成删除/新增：

- `名称修改`：项目实体已匹配 raw 语义变体，但中英文名称与 building 级 raw i18n 不同。
- `已审阅名称例外`：项目中文与 raw 中文不同，但精确命中用户批准的显示名压缩记录；该分类不导致命令失败。英文差异、当前中文或 raw 中文再次变化时仍归入 `名称修改`。
- `项目缺少的 raw 变体`：`modeMap` 或 renderer 提供了语义变体，当前 registry 没有实体映射。
- `缺少 raw 证据的项目变体`：registry 的 `alter-variant:` 在该 raw building 的变体集合中不存在。
- `重复映射的项目变体`：多个项目实体映射到同一 `(buildingId, modeName)`。
- `无法解析的项目映射`：`alter:` 无法解析，或多变体 building 缺少可唯一确定 mode 的 tag / 默认 renderer。

除 `已审阅名称例外` 外，任一分类非空时命令以不一致状态退出；脚本只读，不自动修改 registry 或 i18n。

## 限制

- 设备变体对账证明的是 building、mode、配方组引用和项目实体映射，不证明具体配方内容一致。配方输入、输出、数量和时间需另读 `FactoryMachineCraftTable` 及关联子表。
- 多变体端口子集没有直接编码在 `rendererTemplateMap` 中；必须结合配方物态、`isPipe` 和 registry 端口子集按 [端口坐标与变体规则](port-coordinates.md) 审计。
- raw 来源必须通过 `source-manifest.json` 的路径与 SHA-256 校验；legacy 只支持技能文档列出的有限映射。
- `entity-definition.ts` 结构或 `alter:` / `alter-variant:` 约定变化时必须同步更新解析器与测试。
- `recipe-definition.ts` 的配方 ID 或 `machineId` 归属变化时必须同步验证多 mode 覆盖结果；不得为已由配方归属证明的 mode 增加逐设备例外。
