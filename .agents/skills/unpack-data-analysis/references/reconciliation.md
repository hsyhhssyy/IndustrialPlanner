# 设备对账脚本

本技能提供两类只读对账：

- `src/scripts/compare-exported-devices.mjs` 对账设备 ID、名称和 renderer mode。
- `.agents/skills/unpack-data-analysis/scripts/audit-port-orientations.ts` 对账解包逻辑端口与 registry 默认朝向。

两者用途不同。设备记录对账通过，不代表端口朝向一致；端口朝向审计也不负责生成或修改 registry。

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

## 设备记录对账

`src/scripts/compare-exported-devices.mjs` 根据解包来源生成期望的设备 ID、中英文名称，并与当前 `entity-definition.ts` 和 i18n 翻译对账，输出应新增、应移除的设备清单。

raw-table 来源读取：

- `FactoryBuildingTable`
- `FactoryBuildingItemTable`
- `I18nTextTable_CN`
- `I18nTextTable_EN`

名称通过 `FactoryBuildingTable.name.id` 的无损字符串查找 i18n 表，不依赖 raw table 中不存在的 `_name` / `_nameEn`。legacy 来源继续读取已有派生名称，但报告权威级别固定为 `legacy-lossy`。

### 运行

```bash
node src/scripts/compare-exported-devices.mjs \
  <raw-table 来源目录 | legacy json-export 文件> [--all-exported] [--help]
```

- 必须显式传入 raw-table 来源目录或 legacy JSON 文件。
- `--all-exported`：对账全部具备 buildingItem 映射、renderer template 和可解析名称的设备；默认只对账当前 registry 覆盖的原始设备族。raw 来源中 `name.id=0` 的隐藏记录不参与设备名称对账。
- `--help` / `-h`：打印帮助。

### 核心逻辑

1. 解析 `FactoryBuildingTable` 的 `rendererTemplateMap`，提取 mode 和分组序号。
2. 从 `FactoryBuildingItemTable` 建立物品 ID 到设备 ID 的映射。
3. raw 来源通过 `name.id` 查询中英文原始 i18n 表；legacy 来源从 `_name` / `_nameEn` 或 `i18n.buildings` 读取派生名称。
4. 按 mode 生成设备 ID 和名称：

| mode | deviceId 格式 | 中文后缀 | 英文后缀 |
| --- | --- | --- | --- |
| `normal` | `{buildingId}` | 无 | 无 |
| `gas` | `{buildingId}_gas` | (气体) | (Gas) |
| `liquid` | `{buildingId}_liquid` | (液体) | (Liquid) |
| `gastrans` | `{buildingId}_gastrans` | (气体) | (Gas) |
| `liquidtrans` | `{buildingId}_liquidtrans` | (液体) | (Liquid) |
| `solidtrans` | `{buildingId}_solidtrans` | (固体) | (Solid) |
| `gasliquid` | `{buildingId}_gasliquid` | (气液) | (Gas/Liquid) |

同名 mode 有多个变体时，deviceId 追加 `_{groupIndex}`。

5. 使用 TypeScript Compiler API 解析 `entity-definition.ts` 中 `createEntityDefinition` 调用的 `id`、`nameKey`、`tags`，以及 i18n `REGISTRY` 翻译条目。
6. 通过 `alter:` / `alter-variant:` tag 把当前实体映射回原始设备 ID 和 mode，再执行对账。

### 输出示例

```markdown
# 设备导出对账

- 解包来源：kind=akedata, authority=raw-table, version=1.4.4@9599201-14, path=.temp/unpack/akedata/1.4.4@9599201-14
- 对账范围：当前 registry 已覆盖的原始设备族
- 原始设备族：42
- 当前设备记录：128
- 期望设备记录：130
- 结果：不一致

## 应移除的设备（0）

（无）

## 应新增的设备（2）

| id | 中文 | 英文 | 原始设备 ID | mode | template ID |
| --- | --- | --- | --- | --- | --- |
| furnace_1_gas | 精炼炉(气体) | Furnace (Gas) | furnace_1 | gas | gas__1 |
| planter_1_liquid | 种植机(液体) | Planter (Liquid) | planter_1 | liquid | liquid__1 |
```

## 限制

- 两个脚本都依赖 raw table 文件名和 tag 约定；`entity-definition.ts` 结构、历史别名或 `alter:` 规则变化时必须同步更新。
- raw 来源必须通过 `source-manifest.json` 的路径与 SHA-256 校验；legacy 只支持技能文档列出的有限映射。
- `generateDeviceI18n` 使用固定后缀，不能覆盖需要特殊命名的设备。
- 多变体的端口子集没有直接编码在 `rendererTemplateMap` 中；脚本以 registry 当前端口作为候选子集，因此会识别整体旋转，但不会证明某变体是否遗漏了端口。
- 脚本只对账，不自动修改源文件。
