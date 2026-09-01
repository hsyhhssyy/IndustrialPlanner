# 项目数据更新 Checklist

取得并校验解包数据后，必须针对当前任务逐项判断。输出状态统一为：`需更新`、`无变化`、`不适用`、`阻塞`。不能只复制路径清单；每个 `需更新` 项应给出 raw table 证据和稳定 ID。

## 1. 来源与比较基线

- [ ] 记录来源类型、权威级别、完整版本 ID、游戏版本、hotfix 和来源路径。
- [ ] 列出本次读取的 raw table 与 SHA-256。
- [ ] 明确比较基线；跨版本比较不得把两个来源或两个 hotfix 混成同一快照。
- [ ] 若使用 legacy，标明 `legacy-lossy`，列出本次无法验证的字段和表。
- [ ] 检查新增、修改、删除记录；删除必须区分“来源确实删除”和“本次缺表”。

## 2. 物品

- [ ] 根据 `FactoryItemTable`、`ItemTable` 检查稳定物品 ID、类型、堆叠/容量、领域属性和名称引用。
- [ ] 核对 `src/registry/item-definition.ts`。
- [ ] 核对 `src/shared/i18n/zh-cn/registry.ts` 与 `src/shared/i18n/en-us/registry.ts`。
- [ ] 带 `container:` 与 `container-item:` tag 的物品按项目组合命名规则核对：通过灌装与拆解配方确认 raw 成品映射，验证“容器名称（内容物名称）”，不与 raw 罐装成品通用名直接比较。
- [ ] 缺少直接语言条目与名称文本不同必须分开报告；运行时默认语言回退不得归入该语言的名称差异。
- [ ] 核对 `public/item-icons/` 中新增、替换和废弃图标。
- [ ] 若涉及调度券，核对 `调度券地区:*` 与 `调度券价值:*` tags，不能只根据物品名称推断地区或价值。

## 3. 配方

- [ ] 根据 `FactoryMachineCraftTable` 及关联 craft 子表核对配方 ID、时间、输入、输出、数量和 mode。
- [ ] 精确保留已审阅的水泵能力合并：项目 `water_pump_1` 有意合并 raw `pump_1` 与 `pump_2`，因此 `r_pump_acid_basic` 应与 `pump_2` 的沉积酸抽取能力核对，不得按 `water_pump_1 -> pump_1` 单一别名误报；其他配方字段仍需逐项核对。
- [ ] 核对 `src/registry/recipe-definition.ts`。
- [ ] 核对设备可用配方组、变体 mode 和多产物共享语义。
- [ ] 区分正式删除、活动限时、版本门控和本次来源缺失。

## 4. 设备、端口与变体

- [ ] 根据 `FactoryBuildingItemTable` 建立物品 ID → `buildingId` 映射。
- [ ] 根据 `FactoryMachineCrafterTable.modeMap` 建立 raw building → 语义变体 → `formulaGroupId` 映射；不得只使用 renderer mode。
- [ ] 根据 `FactoryMachineCraftTable` 的配方 ID 与当前 `recipe-definition.ts.machineId` 核对项目实体覆盖的全部 raw mode；不得假设一项目实体只能映射一个 mode。
- [ ] 根据 `FactoryBuildingTable` 核对占地、`needPower`、`powerConsume`、类型、端口和 `rendererTemplateMap`。
- [ ] 按 [端口坐标与变体规则](port-coordinates.md) 核对端口角色、`isPipe`、坐标和默认朝向。
- [ ] 核对 `src/registry/entity-definition.ts`。
- [ ] 核对 `src/registry/entity-variant-definition.ts`。
- [ ] 核对 `src/registry/logistics-definition-ids.ts`。
- [ ] 核对设备中英文 registry i18n。
- [ ] 核对脚本报告中的已审阅名称例外；超过 5 个字的 raw 中文建筑名称必须人工审阅，只有实体 ID、当前中文和 raw 中文均精确匹配的用户批准记录可以保留。
- [ ] 多变体设备必须区分 building 的全部潜在端口与具体 mode 使用的端口子集。

## 5. 视觉资源

- [ ] 逻辑端口或默认朝向变更后，核对 `public/3d-top-view/`。
- [ ] 核对 `public/blueprint-view/` 的 sprite 与 mask。
- [ ] 核对 `public/device-icons/` 与 `public/device-avatar/`。
- [ ] 核对 renderer 输出、sprite 预处理方向和 `spriteOffset`。
- [ ] 需要同步资源时检查 `src/scripts/sync-device-sprites.mjs`。
- [ ] 视觉结果只能验收逻辑修改，不能反向否定已经唯一确定的 raw 端口对账。

## 6. 聚落、区域与模块配平

- [ ] 根据 `SettlementBasicDataTable` 核对聚落等级、交易物品、调度券价值和版本门控。
- [ ] 根据 `DomainDataTable` 核对区域 ID，不自行翻译或根据显示名猜测。
- [ ] 核对 `src/registry/base-definition.ts`。
- [ ] 核对 `src/registry/item-definition.ts` 中地区调度券 tags。
- [ ] 核对 `public/module-balancing/version-resources/` 的版本资源。

## 7. 兼容、迁移与验证

- [ ] 稳定 ID、默认朝向或语义变化时判断是否需要存档迁移。
- [ ] 判断是否需要 Blueprint schema / 内容迁移，并区分 registry 修正角与文档迁移角。
- [ ] 更新受影响的 registry、数据转换和脚本测试。
- [ ] 运行对应只读对账脚本；存在 `symmetric` 或 `unresolved` 时不得自动修改数据。
- [ ] 按项目测试规范执行验证；涉及视觉行为时再执行所需 Screen Profile 验收。
- [ ] 最终报告按“新增 / 修改 / 删除 / 未支持 / 仅视觉变化”汇总，并列出仍需人工复核项。
