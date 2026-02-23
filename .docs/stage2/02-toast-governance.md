# Stage2-02 Toast 降噪规范与落地表

## 1. 目的

在不损失可用性的前提下，降低高频提示噪音，避免“每一步都弹提示”。

适用范围：

- Stage2 新增交互（规划器、蓝图分享/导入等）
- Stage1 仍在维护的编辑器链路（放置、拖拽、快捷键）

---

## 2. 分级标准（强约束）

### 2.1 必须提示（保留 Toast）

仅在以下场景允许弹出：

1. **失败且需用户修正**
   - 例如：越界、规则冲突、导入 JSON 非法、剪贴板不可用
2. **异常或环境限制**
   - 例如：文件读取失败、权限失败
3. **不可见结果的关键完成反馈**
   - 例如：导入成功、删除成功（当画面变化不明显）

### 2.2 可静默（不提示）

以下场景默认不弹：

- 可见且可预期的状态切换（选中、武装、放置成功、取消武装）
- 用户连续高频操作中每一步都可从界面直接观察结果

### 2.3 合并与节流（建议）

- 同类型 warning 在短时间窗口内去重（建议 500ms）
- 同原因重复报错只保留首条
- 批处理操作优先“合并反馈”而非逐条反馈

---

## 3. 当前落地表（2026-02-23）

说明：

- **现状**：当前代码是否触发该提示
- **建议级别**：保留 / 静默 / 合并
- **落地动作**：本轮结论

| 键 | 文案（zh-CN） | 触发点（概览） | 现状 | 建议级别 | 落地动作 |
| --- | --- | --- | --- | --- | --- |
| toast.outOfLot | 位置不合法，超出可建造区域。 | 放置/拖拽非法 | 触发 | 保留 | 保留 |
| toast.invalidPlacementFallback | 当前位置不满足放置规则。 | 放置/拖拽非法兜底 | 触发 | 保留 | 保留 |
| toast.rule.pickupRequiresBus | 取货口必须紧贴存取线基段放置。 | 放置规则失败 | 触发 | 保留 | 保留 |
| toast.rule.wulingOnly | 该设备只能在武陵地图放置。 | 放置规则失败 | 触发 | 保留 | 保留 |
| toast.blueprintNoSelection | 请先框选至少一个设备后再保存蓝图。 | 保存蓝图/无蓝图放置 | 触发 | 保留 | 保留 |
| toast.blueprintSaved | 蓝图已保存：{name}（{count} 个设备） | 保存蓝图成功 | 触发 | 保留 | 保留 |
| toast.blueprintSaveFailed | 蓝图保存失败，请重试。 | 保存蓝图异常 | 触发 | 保留 | 保留 |
| toast.blueprintNameRequired | 蓝图名称不能为空。 | 新建/重命名校验 | 触发 | 保留 | 保留 |
| toast.blueprintRenamed | 蓝图已重命名：{name} | 重命名成功 | 触发 | 可选保留 | 保留（低频） |
| toast.blueprintSharedClipboard | 蓝图已复制到剪贴板：{name} | 分享到剪贴板成功 | 触发 | 保留 | 保留 |
| toast.blueprintSharedFile | 蓝图文件已下载：{name} | 分享到文件成功 | 触发 | 保留 | 保留 |
| toast.blueprintShareUnsupported | 当前环境不支持剪贴板分享。 | 剪贴板不可用 | 触发 | 保留 | 保留 |
| toast.blueprintShareFailed | 蓝图分享失败，请检查浏览器剪贴板权限。 | 剪贴板写入失败 | 触发 | 保留 | 保留 |
| toast.blueprintImportEmpty | 导入内容为空。 | 文本导入空输入 | 触发 | 保留 | 保留 |
| toast.blueprintImportInvalidJson | 导入失败：不是有效的 JSON。 | 文本导入解析失败 | 触发 | 保留 | 保留 |
| toast.blueprintImportInvalidPayload | 导入失败：蓝图数据格式不正确。 | 文本/文件导入结构非法 | 触发 | 保留 | 保留 |
| toast.blueprintImportFileFailed | 读取蓝图文件失败。 | 文件读取异常 | 触发 | 保留 | 保留 |
| toast.blueprintImported | 蓝图已导入：{name}（{count} 个设备） | 导入成功 | 触发 | 保留 | 保留 |
| toast.blueprintDeleted | 蓝图已删除：{name} | 删除蓝图成功 | 触发 | 可选保留 | 保留（低频） |
| toast.blueprintCopyNeedsMultiSelect | 请先多选至少 2 个建筑，再按 Ctrl+C。 | Ctrl+C 蓝图复制前置条件不满足 | 触发 | 保留 | 保留 |
| toast.blueprintClipboardReady | 已复制 {count} 个建筑，左键放置，右键取消。 | Ctrl+C 生成临时蓝图成功 | 触发 | 保留 | 保留 |
| toast.blueprintClipboardCancelled | 已取消临时蓝图放置。 | 临时蓝图右键取消 | 触发 | 静默 | **建议移除** |
| toast.blueprintDisarmed | 已取消蓝图放置。 | 蓝图 Esc 取消武装 | 触发 | 静默 | **建议移除** |
| toast.blueprintArmed | 已进入蓝图放置：{name} | 进入蓝图武装 | 未触发（已移除调用） | 静默 | 已移除调用，建议后续删文案键 |
| toast.blueprintPlaced | 蓝图已放置：{name}（{count} 个设备） | 蓝图落地成功 | 未触发（已移除调用） | 静默 | 已移除调用，建议后续删文案键 |
| toast.blueprintSelected | 已选择蓝图：{name} | 选择蓝图 | 未触发 | 静默 | 建议删文案键 |
| toast.blueprintShared | 蓝图分享成功：{name} | 泛化分享成功 | 未触发 | 静默（冗余） | 建议删文案键 |

---

## 4. 实施规则（Stage2 起）

1. 新增交互前先判断“结果是否已被界面直接表达”。若是，默认不加 toast。
2. 同一功能链路最多保留一个成功提示。
3. warning/error 必须可定位到可修复动作。
4. 提示文案要短句、动作导向，避免教学式长句。

---

## 5. 待办（建议）

1. 移除未被调用的 toast 文案键：
   - `toast.blueprintArmed`
   - `toast.blueprintPlaced`
   - `toast.blueprintSelected`
   - `toast.blueprintShared`
2. 移除高频取消提示调用：
   - `toast.blueprintClipboardCancelled`
   - `toast.blueprintDisarmed`
3. 为高频 warning 增加 500ms 去重窗口（可选）。
