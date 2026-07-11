import type { AppLocale } from "@/domain/app/types/app-types";

export type MessageKey =
  | "app.title"
  | "mode.edit"
  | "action.start"
  | "action.stop"
  | "action.pause"
  | "action.resume"
  | "action.step"
  | "action.undo"
  | "action.redo"
  | "action.zoomIn"
  | "action.zoomOut"
  | "action.open"
  | "action.close"
  | "action.cancel"
  | "action.confirm"
  | "action.expand"
  | "action.collapse"
  | "dialog.maximize"
  | "dialog.restore"
  | "action.exit"
  | "action.deemphasizePipe"
  | "action.showPipe"
  | "action.deemphasizeBelt"
  | "action.showBelt"
  | "action.switchToNormalMarquee"
  | "action.switchToReverseMarquee"
  | "action.switchTheme"
  | "action.enterFullscreen"
  | "action.exitFullscreen"
  | "action.deleteSelection"
  | "action.removeLinks"
  | "action.removeLink"
  | "action.applyValue"
  | "action.rotatePlacement"
  | "action.rotateView"
  | "action.continuousPlacement"
  | "action.cancelContinuousPlacement"
  | "action.rotateSelection"
  | "action.cancelPlacement"
  | "action.confirmPlacement"
  | "action.cancelMove"
  | "action.rotateMove"
  | "action.confirmMove"
  | "action.toggleValue"
  | "action.clearPatch"
  | "action.saveBlueprint"
  | "action.copySelection"
  | "workbench.button.select"
  | "workbench.button.batchSelect"
  | "workbench.button.beltDraw"
  | "workbench.button.pipeDraw"
  | "toolbar.tools"
  | "toolbar.views"
  | "toolbar.canvasTopLeftCorner"
  | "toolbar.canvasRightDock"
  | "toolbar.canvasBottomLeft"
  | "toolbar.canvasBottomLeftSecondary"
  | "tool.select"
  | "tool.place"
  | "tool.belt"
  | "tool.pipe"
  | "tool.link"
  | "tool.inspect"
  | "tool.move"
  | "tool.marquee"
  | "view.library"
  | "view.inspector"
  | "view.diagnostics"
  | "leftDock.currentMode"
  | "leftDock.activeTool"
  | "activeTool.select"
  | "activeTool.move"
  | "activeTool.marquee"
  | "activeTool.blueprint-placement"
  | "activeTool.single-placement"
  | "activeTool.logistics-placement"
  | "activeTool.dark-pipe-link"
  | "leftDock.title"
  | "leftDock.collapsed"
  | "rightDock.title"
  | "rightDock.collapsed"
  | "rightDock.base"
  | "rightDock.power"
  | "workbench.power.covered"
  | "workbench.power.clearOverride"
  | "workbench.powerValue.covered"
  | "rightDock.selection"
  | "rightDock.simulation"
  | "warehouseStats.title"
  | "warehouseStats.dialogTitle"
  | "warehouseStats.runToView"
  | "warehouseStats.empty"
  | "warehouseStats.noResults"
  | "warehouseStats.item"
  | "warehouseStats.produced"
  | "warehouseStats.consumed"
  | "warehouseStats.stock"
  | "warehouseStats.more"
  | "warehouseStats.search"
  | "warehouseStats.pin"
  | "warehouseStats.unpin"
  | "warehouseStats.pinnedCount"
  | "section.configFields"
  | "section.runtimeDetails"
  | "section.runtimePatch"
  | "section.diagnostics"
  | "section.quickActions"
  | "section.connections"
  | "label.definition"
  | "label.entityId"
  | "label.mode"
  | "label.currentTickSnapshot"
  | "label.runtime"
  | "label.position"
  | "label.rotation"
  | "label.links"
  | "label.items"
  | "label.recipes"
  | "label.definitions"
  | "label.noSelection"
  | "label.multiSelectionSummary"
  | "label.noConfigFields"
  | "label.noConnections"
  | "label.runtimeDetailPlaceholder"
  | "label.noDiagnostics"
  | "label.documentValue"
  | "label.effectiveValue"
  | "label.runtimePatch"
  | "label.runtimePatchNone"
  | "label.runtimePatchDisabled"
  | "label.runtimePatchClearsOnExit"
  | "label.touchPlacementHint"
  | "inspector.slotConfig.group"
  | "inspector.slotConfig.selectItem"
  | "inspector.slotConfig.clearSlot"
  | "inspector.slotConfig.capacity"
  | "inspector.slotConfig.locked"
  | "inspector.warehouseItemLink.description"
  | "inspector.warehouseItemLink.selectItem"
  | "inspector.submitToWarehouse.label"
  | "inspector.submitToWarehouse.countdown"
  | "status.ready"
  | "status.edit"
  | "statusBar.mode"
  | "statusBar.view"
  | "statusBar.running"
  | "statusBar.copyright"
  | "statusBar.icpFiling"
  | "statusBar.githubRepo"
  | "statusBar.trademarkNotice"
  | "statusBar.locale"
  | "statusBar.theme"
  | "statusBar.tool"
  | "statusBar.speed"
  | "statusBar.entities"
  | "statusBar.links"
  | "statusBar.compile"
  | "statusBar.diagnostics"
  | "statusBar.tick"
  | "statusBar.simHz"
  | "statusBar.selection"
  | "statusBar.none"
  | "topBar.zoom"
  | "topBar.speed"
  | "topBar.controls"
  | "topBar.language"
  | "topBar.theme"
  | "topBar.device"
  | "topBar.screen"
  | "topBar.leftPanel"
  | "topBar.rightPanel"
  | "topBar.settings"
  | "topBar.switchToOldVersion"
  | "settingsDialog.title"
  | "settingsDialog.groups"
  | "settingsAction.resetOperationAndShortcuts"
  | "settingsAction.resetOperationAndShortcutsConfirm"
  | "settingsAction.resetAllSettings"
  | "settingsAction.resetAllSettingsConfirm"
  | "encyclopediaPicker.title.item"
  | "encyclopediaPicker.title.entity"
  | "encyclopediaPicker.title.entry"
  | "toolboxDialog.title"
  | "toolboxDialog.tab.itemEncyclopedia"
  | "toolboxDialog.tab.productionPlanning"
  | "toolboxDialog.tab.moduleBalancing"
  | "toolboxDialog.empty"
  | "toolboxDialog.maximize"
  | "toolboxDialog.restore"
  | "toolboxDialog.dockToBottom"
  | "toolboxDialog.undock"
  | "toolboxDialog.collapseBottomDock"
  | "toolboxDialog.expandBottomDock"
  | "toolboxDialog.resizeBottomDock"
  | "debugLogDialog.title"
  | "debugLogDialog.empty"
  | "debugLogDialog.copy"
  | "debugLogDialog.copied"
  | "debugLogDialog.maximize"
  | "debugLogDialog.restore"
  | "debugLogDialog.export"
  | "debugLogDialog.exporting"
  | "debugLogDialog.clear"
  | "debugLogDialog.guidance"
  | "helpDialog.title"
  | "helpDialog.description"
  | "helpDialog.tab.gettingStarted"
  | "helpDialog.tab.shortcuts"
  | "helpDialog.tab.featureGuide"
  | "helpDialog.tab.versionUpdates"
  | "helpDialog.empty"
  | "helpDialog.maximize"
  | "helpDialog.restore"
  | "feedbackDialog.title"
  | "feedbackDialog.intro"
  | "feedbackDialog.github.title"
  | "feedbackDialog.github.description"
  | "feedbackDialog.github.note"
  | "feedbackDialog.github.action"
  | "feedbackDialog.bilibili.title"
  | "feedbackDialog.bilibili.description"
  | "feedbackDialog.bilibili.note"
  | "feedbackDialog.bilibili.action"
  | "settingsGroup.system"
  | "settingsGroup.systemDescription"
  | "settingsGroup.display"
  | "settingsGroup.displayDescription"
  | "settingsGroup.displaySystem"
  | "settingsGroup.displaySystemDescription"
  | "settingsGroup.game"
  | "settingsGroup.gameDescription"
  | "settingsGroup.arknightsOperation"
  | "settingsGroup.arknightsOperationDescription"
  | "settingsGroup.shortcuts"
  | "settingsGroup.shortcutsDescription"
  | "settingsGroup.other"
  | "settingsGroup.otherDescription"
  | "settingsGroup.operation"
  | "settingsGroup.operationDescription"
  | "settingsGroup.debug"
  | "settingsGroup.debugDescription"
  | "settingsField.system-language"
  | "settingsField.system-languageDescription"
  | "settingsField.system-theme"
  | "settingsField.system-themeDescription"
  | "settingsField.game-arknights-operation-mode"
  | "settingsField.game-arknights-operation-modeDescription"
  | "settingsField.game-arknights-immediate-move"
  | "settingsField.game-arknights-immediate-moveDescription"
  | "settingsField.game-arknights-copy-while-moving"
  | "settingsField.game-arknights-copy-while-movingDescription"
  | "settingsField.game-arknights-immediate-marquee"
  | "settingsField.game-arknights-immediate-marqueeDescription"
  | "settingsField.game-arknights-allow-empty-logistics-endpoints"
  | "settingsField.game-arknights-allow-empty-logistics-endpointsDescription"
  | "settingsField.game-arknights-auto-create-splitters-and-convergers"
  | "settingsField.game-arknights-auto-create-splitters-and-convergersDescription"
  | "settingsField.game-arknights-selection-right-dock-sync"
  | "settingsField.game-arknights-selection-right-dock-syncDescription"
  | "settingsField.game-arknights-inspector-open-on-second-click"
  | "settingsField.game-arknights-inspector-open-on-second-clickDescription"
  | "settingsField.shortcut-place-conveyor"
  | "settingsField.shortcut-place-conveyorDescription"
  | "settingsField.shortcut-place-pipe"
  | "settingsField.shortcut-place-pipeDescription"
  | "settingsField.shortcut-resources-power"
  | "settingsField.shortcut-resources-powerDescription"
  | "settingsField.shortcut-warehouse"
  | "settingsField.shortcut-warehouseDescription"
  | "settingsField.shortcut-basic-production"
  | "settingsField.shortcut-basic-productionDescription"
  | "settingsField.shortcut-synthesis"
  | "settingsField.shortcut-synthesisDescription"
  | "settingsField.shortcut-save-blueprint"
  | "settingsField.shortcut-save-blueprintDescription"
  | "settingsField.shortcut-return-select"
  | "settingsField.shortcut-return-selectDescription"
  | "settingsField.shortcut-rotate"
  | "settingsField.shortcut-rotateDescription"
  | "settingsField.shortcut-switch-device-mode"
  | "settingsField.shortcut-switch-device-modeDescription"
  | "settingsField.shortcut-delete-device"
  | "settingsField.shortcut-delete-deviceDescription"
  | "settingsField.shortcut-move-selection"
  | "settingsField.shortcut-move-selectionDescription"
  | "settingsField.shortcut-copy-selection"
  | "settingsField.shortcut-copy-selectionDescription"
  | "settingsField.shortcut-paste-selection"
  | "settingsField.shortcut-paste-selectionDescription"
  | "settingsField.shortcut-undo"
  | "settingsField.shortcut-undoDescription"
  | "settingsField.shortcut-redo"
  | "settingsField.shortcut-redoDescription"
  | "settingsField.shortcut-toggle-placement-panel"
  | "settingsField.shortcut-toggle-placement-panelDescription"
  | "settingsField.shortcut-toggle-blueprint-panel"
  | "settingsField.shortcut-toggle-blueprint-panelDescription"
  | "settingsField.shortcut-toggle-history-panel"
  | "settingsField.shortcut-toggle-history-panelDescription"
  | "settingsField.shortcut-toggle-base-panel"
  | "settingsField.shortcut-toggle-base-panelDescription"
  | "settingsField.shortcut-rotate-viewport"
  | "settingsField.shortcut-rotate-viewportDescription"
  | "settingsField.game-use-blueprint-style-device-images"
  | "settingsField.game-use-blueprint-style-device-imagesDescription"
  | "settingsField.game-use-inspector-panel"
  | "settingsField.game-use-inspector-panelDescription"
  | "settingsField.game-show-hotkeys"
  | "settingsField.game-show-hotkeysDescription"
  | "settingsField.game-always-show-grid-lines"
  | "settingsField.game-always-show-grid-linesDescription"
  | "settingsField.game-show-grass-background"
  | "settingsField.game-show-grass-backgroundDescription"
  | "settingsField.game-show-device-names"
  | "settingsField.game-show-device-namesDescription"
  | "settingsField.game-show-device-icons"
  | "settingsField.game-show-device-iconsDescription"
  | "settingsField.other-toolbox-show-all-activity-content"
  | "settingsField.other-toolbox-show-all-activity-contentDescription"
  | "settingsField.other-debug-mode"
  | "settingsField.other-debug-modeDescription"
  | "settingsField.debug-show-fps"
  | "settingsField.debug-show-fpsDescription"
  | "settingsField.debug-show-gesture-diagnostics-window"
  | "settingsField.debug-show-gesture-diagnostics-windowDescription"
  | "settingsOption.languageZhHans"
  | "settingsOption.languageEnglish"
  | "settingsOption.ayuLight"
  | "settingsOption.ayuDark"
  | "settingsOption.followSystem"
  | "settingsOption.enabled"
  | "settingsOption.disabled"
  | "settingsKeybinding.awaitingInput"
  | "settingsKeybinding.conflictTitle"
  | "settingsKeybinding.conflictMessage"
  | "settingsKeybinding.conflictReplace"
  | "settingsKeybinding.conflictCancel"
  | "device.mobile"
  | "device.tablet"
  | "device.desktop"
  | "screen.portrait"
  | "screen.landscape"
  | "screen.square"
  | "locale.zh-CN"
  | "locale.en-US"
  | "mutability.document-only"
  | "mutability.runtime-mutable"
  | "mutability.recompile-required"
  | "uiGroup.beltLogistics"
  | "uiGroup.pipeLogistics"
  | "uiGroup.resourcePower"
  | "uiGroup.warehouse"
  | "uiGroup.basicProduction"
  | "uiGroup.advancedManufacturing"
  | "registry.entity.item_port_filling_pd_mc_1.name"
  | "registry.entity.item_port_gas_diffuser_1.name"
  | "registry.entity.item_port_gas_storager_1.name"
  | "registry.entity.item_port_gas_collector_1.name"
  | "registry.entity.item_port_solid_gas_converter_1.name"
  | "registry.entity.item_port_gas_reactor_1.name"
  | "registry.entity.item_port_liquid_gas_converter_1.name"
  | "registry.item.item_gas_inert.name"
  | "registry.item.item_gas_xiranite.name"
  | "registry.recipe.r_xiranite_oven_xiranite_powder_from_carbon_mtl_and_water_in_inert_gas_basic.name"
  | "registry.recipe.r_gas_diffuser_inert_gas_environment_basic.name"
  | "uiGroup.hidden"
  | "encyclopedia.searchPlaceholder"
  | "encyclopedia.category.all"
  | "encyclopedia.category.items"
  | "encyclopedia.category.entities"
  | "encyclopedia.filter.excludeBottledLiquid"
  | "encyclopedia.group.asInput"
  | "encyclopedia.group.asOutput"
  | "encyclopedia.group.liquidFilling"
  | "encyclopedia.group.liquidDismantle"
  | "encyclopedia.group.asMachine"
  | "encyclopedia.noResults"
  | "encyclopedia.noRecipes"
  | "encyclopedia.back"
  | "encyclopedia.home"
  | "encyclopedia.viewDetails"
  | "encyclopedia.entityLabel"
  | "encyclopedia.itemLabel"
  | "encyclopedia.filter.label"
  | "encyclopedia.recentItems";

const MESSAGES: Record<AppLocale, Record<string, string>> = {
  "zh-CN": {
    "app.title": "终末地工业系统仿真器",
    "mode.edit": "放置模式",
    "action.start": "开始仿真",
    "action.stop": "停止仿真",
    "action.pause": "暂停",
    "action.resume": "继续",
    "action.step": "单步",
    "action.undo": "撤销",
    "action.redo": "重做",
    "action.zoomIn": "放大",
    "action.zoomOut": "缩小",
    "action.open": "打开",
    "action.close": "关闭",
    "action.cancel": "取消",
    "action.confirm": "确认",
    "action.expand": "展开",
    "action.collapse": "折叠",
    "dialog.maximize": "最大化",
    "dialog.restore": "还原",
    "action.exit": "退出",
    "action.deemphasizePipe": "弱化管道",
    "action.showPipe": "显示管道",
    "action.deemphasizeBelt": "弱化传送带",
    "action.showBelt": "显示传送带",
    "action.switchToNormalMarquee": "切换到正选",
    "action.switchToReverseMarquee": "切换到反选",
    "action.switchTheme": "切换主题",
    "action.enterFullscreen": "进入全屏",
    "action.exitFullscreen": "退出全屏",
    "action.deleteSelection": "删除选中",
    "action.removeLinks": "删除链接",
    "action.removeLink": "移除链接",
    "action.applyValue": "应用",
    "action.rotatePlacement": "旋转",
    "action.rotateView": "旋转视角",
    "action.continuousPlacement": "连续放置",
    "action.cancelContinuousPlacement": "取消连续放置",
    "action.rotateSelection": "旋转",
    "action.saveBlueprint": "保存蓝图",
    "action.copySelection": "复制选中",
    "workbench.button.select": "选择",
    "workbench.button.batchSelect": "批量选择",
    "workbench.button.beltDraw": "铺设传送带",
    "workbench.button.pipeDraw": "铺设管道",
    "action.cancelPlacement": "取消",
    "action.confirmPlacement": "确认放置",
    "action.cancelMove": "取消移动",
    "action.rotateMove": "旋转",
    "action.confirmMove": "确认移动",
    "action.toggleValue": "切换",
    "action.clearPatch": "清除覆盖",
    "toolbar.tools": "工具",
    "toolbar.views": "视图",
    "toolbar.canvasTopLeftCorner": "画布左上角工具栏",
    "toolbar.canvasRightDock": "画布右侧工具栏",
    "toolbar.canvasBottomLeft": "画布左下角工具栏",
    "toolbar.canvasBottomLeftSecondary": "画布左下角辅助工具栏",
    "tool.select": "选择",
    "tool.place": "放置",
    "tool.belt": "传送带",
    "tool.pipe": "管道",
    "tool.link": "链接",
    "tool.inspect": "观察",
    "tool.move": "移动",
    "tool.marquee": "框选",
    "view.library": "左侧面板",
    "view.inspector": "右侧面板",
    "view.diagnostics": "诊断",
    "leftDock.currentMode": "当前面板",
    "leftDock.activeTool": "当前工具",
    "activeTool.select": "选择",
    "activeTool.move": "移动",
    "activeTool.marquee": "框选",
    "activeTool.blueprint-placement": "蓝图放置",
    "activeTool.single-placement": "单次放置",
    "activeTool.logistics-placement": "物流铺设",
    "activeTool.dark-pipe-link": "暗线链接",
    "leftDock.title": "左侧上下文面板",
    "leftDock.collapsed": "面板",
    "rightDock.title": "右侧检视面板",
    "rightDock.collapsed": "检视",
    "rightDock.base": "基地",
    "rightDock.power": "电力",
    "workbench.power.covered": "强制电力消耗",
    "workbench.power.clearOverride": "清除强制消耗",
    "workbench.powerValue.covered": "按真实值",
    "rightDock.selection": "设备属性",
    "rightDock.simulation": "仿真",
    "warehouseStats.title": "仓库统计",
    "warehouseStats.dialogTitle": "仓库统计详情",
    "warehouseStats.runToView": "请运行仿真",
    "warehouseStats.empty": "暂无仓库变化",
    "warehouseStats.noResults": "没有匹配的物品",
    "warehouseStats.item": "物品",
    "warehouseStats.produced": "产出/分",
    "warehouseStats.consumed": "消耗/分",
    "warehouseStats.stock": "库存",
    "warehouseStats.more": "更多",
    "warehouseStats.search": "搜索物品",
    "warehouseStats.pin": "置顶",
    "warehouseStats.unpin": "取消置顶",
    "warehouseStats.pinnedCount": "已置顶",
    "section.configFields": "配置字段",
    "label.recipes": "配方",
    "label.definitions": "定义",
    "label.noSelection": "未选中对象",
    "label.multiSelectionSummary": "多选当前只显示共享操作；单对象详情会在缩成单选后显示。",
    "label.noConfigFields": "当前脚手架还没有可配置字段。",
    "label.noConnections": "当前对象没有显式链接。",
    "label.runtimeDetailPlaceholder": "运行态 query lane 会在这里显示更细的按需读取结果。",
    "label.noDiagnostics": "当前没有诊断信息。",
    "label.documentValue": "文档基线",
    "label.effectiveValue": "当前生效值",
    "label.runtimePatch": "运行态覆盖",
    "label.runtimePatchNone": "无",
    "label.runtimePatchDisabled": "该字段不能在仿真态做临时覆盖。",
    "label.runtimePatchClearsOnExit": "退出仿真会清空全部运行态覆盖，不会写回文档。",
    "label.touchPlacementHint": "拖动虚影后点击确认完成放置。",
    "inspector.slotConfig.group": "槽位组",
    "inspector.slotConfig.selectItem": "选择物品",
    "inspector.slotConfig.clearSlot": "清空槽位",
    "inspector.slotConfig.capacity": "容量",
    "inspector.slotConfig.locked": "锁定",
    "inspector.warehouseItemLink.description": "为每个槽位选择从仓库取出的物品。",
    "inspector.warehouseItemLink.selectItem": "选择仓库物品",
    "inspector.warehouseItemLink.ignoreStock": "无限物品",
    "inspector.submitToWarehouse.label": "无线提交到仓库",
    "inspector.submitToWarehouse.countdown": "下次提交倒计时",
    "status.ready": "Stage1 工作台脚手架已就绪。",
    "status.edit": "编辑态聚焦文档事实与编译产物。",
    "statusBar.mode": "当前模式",
    "statusBar.view": "当前视图",
    "statusBar.running": "仿真占位中",
    "statusBar.copyright": "终末地工业系统仿真器",
    "statusBar.icpFiling": "粤ICP备2021107697号-1",
    "statusBar.githubRepo": "GitHub 仓库",
    "statusBar.trademarkNotice": "明日方舟：终末地是鹰角网络的商标。本工具与鹰角网络无关，未获其认可。图片和数据资源来自明日方舟：终末地游戏数据，版权归鹰角网络所有。",
    "statusBar.locale": "语言",
    "statusBar.theme": "主题",
    "statusBar.tool": "工具",
    "statusBar.speed": "速率",
    "statusBar.entities": "实体",
    "statusBar.links": "链接",
    "statusBar.compile": "编译版本",
    "statusBar.diagnostics": "诊断",
    "statusBar.tick": "Tick",
    "statusBar.simHz": "仿真频率",
    "statusBar.selection": "当前选中",
    "statusBar.none": "无",
    "topBar.zoom": "缩放",
    "topBar.speed": "速率",
    "topBar.controls": "运行控制",
    "topBar.language": "语言",
    "topBar.theme": "主题",
    "topBar.device": "设备",
    "topBar.screen": "屏幕",
    "topBar.leftPanel": "左侧",
    "topBar.rightPanel": "右侧",
    "topBar.settings": "设置",
    "topBar.switchToOldVersion": "返回旧版",
    "settingsDialog.title": "设置",
    "settingsDialog.groups": "设置分组",
    "settingsAction.resetOperationAndShortcuts": "重置操作方式与快捷键",
    "settingsAction.resetOperationAndShortcutsConfirm": "确定要将操作方式与快捷键恢复为默认设置吗？",
    "settingsAction.resetAllSettings": "重置设置",
    "settingsAction.resetAllSettingsConfirm": "确定要将所有设置恢复为默认值吗？",
    "encyclopediaPicker.title.item": "选择物品",
    "encyclopediaPicker.title.entity": "选择设备",
    "encyclopediaPicker.title.entry": "选择物品或设备",
    "toolboxDialog.title": "工具箱",
    "toolboxDialog.tab.itemEncyclopedia": "物品百科",
    "toolboxDialog.tab.productionPlanning": "产线规划",
    "toolboxDialog.tab.moduleBalancing": "模块配平",
    "toolboxDialog.empty": "当前没有可显示的工具箱内容。",
    "toolboxDialog.maximize": "最大化工具箱",
    "toolboxDialog.restore": "还原工具箱",
    "toolboxDialog.dockToBottom": "停靠到底部",
    "toolboxDialog.undock": "取消停靠",
    "toolboxDialog.collapseBottomDock": "折叠工具箱",
    "toolboxDialog.expandBottomDock": "展开工具箱",
    "toolboxDialog.resizeBottomDock": "调整工具箱高度",
    "debugLogDialog.title": "调试日志",
    "debugLogDialog.empty": "当前还没有捕获到调试日志。",
    "debugLogDialog.copy": "复制日志",
    "debugLogDialog.copied": "已复制",
    "debugLogDialog.maximize": "最大化调试日志",
    "debugLogDialog.restore": "还原调试日志",
    "debugLogDialog.export": "导出日志文件",
    "debugLogDialog.exporting": "正在导出…",
    "debugLogDialog.clear": "清空日志",
    "debugLogDialog.guidance": "如果你在使用中遇到了问题，请点击上方「导出日志文件」按钮，将下载的文件发送给技术支持。",
    "moduleBalancing.canvas": "画布",
    "moduleBalancing.newCanvas": "新建画布",
    "moduleBalancing.deleteCanvas": "删除画布",
    "moduleBalancing.canvasPlaceholder": "画布名称",
    "moduleBalancing.stage": "阶段",
    "moduleBalancing.newStage": "新建阶段",
    "moduleBalancing.clearStage": "清空阶段",
    "moduleBalancing.systemInput": "系统输入",
    "moduleBalancing.addInput": "添加输入物品",
    "moduleBalancing.removeInput": "移除输入",
    "moduleBalancing.warehouseCapacity": "仓库容量",
    "moduleBalancing.warehouseCapacityHint": "留空不计算",
    "moduleBalancing.surplus": "结余",
    "moduleBalancing.deficit": "缺口",
    "moduleBalancing.balanced": "持平",
    "moduleBalancing.summary": "最终汇总",
    "moduleBalancing.warehouseAnalysis": "仓库分析",
    "moduleBalancing.dispatchTicketTitle": "调度券产量",
    "moduleBalancing.dispatchTicketTotal": "总调度券生产速度",
    "moduleBalancing.dispatchTicketUnit": "调度券",
    "moduleBalancing.overflowTime": "爆仓",
    "moduleBalancing.exhaustTime": "耗尽",
    "moduleBalancing.after": "后",
    "moduleBalancing.systemModules": "系统模块",
    "moduleBalancing.customModules": "自定义模块",
    "moduleBalancing.recipes": "配方",
    "moduleBalancing.modules": "模块",
    "moduleBalancing.newModule": "新建模块",
    "moduleBalancing.editModule": "编辑模块",
    "moduleBalancing.deleteModule": "删除模块",
    "moduleBalancing.moduleName": "模块名称",
    "moduleBalancing.moduleColor": "颜色",
    "moduleBalancing.moduleIcon": "图标",
    "moduleBalancing.moduleNotes": "备注",
    "moduleBalancing.moduleNotesPlaceholder": "可填写该模块的补充说明…",
    "moduleBalancing.inputItems": "输入",
    "moduleBalancing.outputItems": "输出",
    "moduleBalancing.addInputItem": "添加输入",
    "moduleBalancing.addOutputItem": "添加输出",
    "moduleBalancing.moduleLibrary": "模块库",
    "moduleBalancing.canvasInput": "画布输入",
    "moduleBalancing.stageDetail": "详情",
    "moduleBalancing.saveAsModule": "保存为模块",
    "moduleBalancing.saveModule": "保存模块",
    "moduleBalancing.addToStage": "添加模块",
    "moduleBalancing.editQuantity": "编辑数量",
    "moduleBalancing.quantity": "数量",
    "moduleBalancing.confirmAdd": "确认添加",
    "moduleBalancing.confirmEdit": "确认修改",
    "moduleBalancing.deleteFromStage": "删除模块",
    "moduleBalancing.searchModules": "搜索模块...",
    "moduleBalancing.searchItems": "搜索物品...",
    "moduleBalancing.expandDetails": "展开详情",
    "moduleBalancing.collapseDetails": "收起",
    "moduleBalancing.nItemsMore": "+{n}项展开",
    "moduleBalancing.emptyPorts": "暂无物品",
    "moduleBalancing.none": "无",
    "moduleBalancing.noStages": "还没有阶段",
    "moduleBalancing.noSummary": "添加输入或模块后显示汇总",
    "productionPlanning.targets": "目标",
    "productionPlanning.addTarget": "添加目标",
    "productionPlanning.supplies": "供给",
    "productionPlanning.addSupply": "添加供给",
    "productionPlanning.calculate": "计算",
    "productionPlanning.modify": "返回修改",
    "productionPlanning.emptyLines": "暂无条目",
    "productionPlanning.perMinute": "每分钟",
    "productionPlanning.infinite": "无穷",
    "productionPlanning.infiniteNaturalDisabled": "自然资源不可设置无穷",
    "productionPlanning.remove": "移除",
    "productionPlanning.sourcePolicy": "来源策略",
    "productionPlanning.naturalResources": "基础资源",
    "productionPlanning.byproductUse": "使用副产物",
    "productionPlanning.byproductDump": "倾倒副产物",
    "productionPlanning.externalSupply": "外部供应",
    "productionPlanning.selfProduce": "自行生产",
    "productionPlanning.displayMode": "展示模式",
    "productionPlanning.viewMode": "视图",
    "productionPlanning.modeItem": "物品",
    "productionPlanning.modeDevice": "设备",
    "productionPlanning.viewTree": "树状图",
    "productionPlanning.viewFlow": "流程图",
    "productionPlanning.noTargets": "选择目标后显示产线",
    "productionPlanning.noResult": "计算完成后显示结果",
    "productionPlanning.noSummary": "选择目标后显示汇总",
    "productionPlanning.noRecipes": "暂无生产步骤",
    "productionPlanning.summary": "汇总",
    "productionPlanning.recipes": "配方",
    "productionPlanning.recipeCount": "配方数",
    "productionPlanning.totalItems": "物品数",
    "productionPlanning.missingRate": "缺口",
    "productionPlanning.demand": "需求",
    "productionPlanning.supply": "供给",
    "productionPlanning.produced": "产出",
    "productionPlanning.missing": "缺口",
    "productionPlanning.recipe": "配方",
    "productionPlanning.autoRecipe": "自动",
    "productionPlanning.addRecipe": "添加配方",
    "productionPlanning.recipeStatusEmptyHint": "暂无配方，添加后可在此查看运行进度",
    "productionPlanning.autoRecipeReadonly": "自动配方，不可移除",
    "productionPlanning.chooseRecipe": "选择配方",
    "productionPlanning.manualOnly": "手动选择",
    "productionPlanning.duration": "时间",
    "productionPlanning.devices": "设备",
    "productionPlanning.deviceCount": "设备数",
    "productionPlanning.second_short": "秒",
    "productionPlanning.cycles": "循环",
    "productionPlanning.inputs": "输入",
    "productionPlanning.outputs": "输出",
    "productionPlanning.requiredInputs": "需要输入",
    "productionPlanning.totalOutputs": "总计产出",
    "productionPlanning.inputSources": "原料来自",
    "productionPlanning.outputTargets": "产物去往",
    "productionPlanning.none": "无",
    "productionPlanning.unresolved": "未满足",
    "productionPlanning.blockedCycle": "循环阻塞",
    "productionPlanning.cycleSource": "增殖循环",
    "productionPlanning.infiniteSource": "无限来源",
    "productionPlanning.supplied": "已供给",
    "productionPlanning.node": "节点",
    "productionPlanning.rate": "速率",
    "productionPlanning.status": "状态",
    "productionPlanning.shared": "共享",
    "productionPlanning.byproduct": "副产物",
    "productionPlanning.producedBy": "生产自",
    "productionPlanning.usedBy": "消耗于",
    "productionPlanning.coverDemand": "补足供给",
    "productionPlanning.removeExternalSupply": "移除外部供给",
    "productionPlanning.resetLayout": "重置布局",
    "helpDialog.title": "帮助",
    "helpDialog.description": "多个帮助主题会在这里按标签页组织。",
    "helpDialog.tab.gettingStarted": "新手入门",
    "helpDialog.tab.shortcuts": "操作说明",
    "helpDialog.tab.featureGuide": "功能介绍",
    "helpDialog.tab.versionUpdates": "版本更新",
    "helpDialog.empty": "当前没有可显示的帮助内容。",
    "helpDialog.maximize": "最大化帮助",
    "helpDialog.restore": "还原帮助",
    "feedbackDialog.title": "问题反馈",
    "feedbackDialog.intro": "请选择反馈渠道。GitHub 支持上传图片、日志和更长的描述；Bilibili 更方便、更容易被看到，也更适合国内用户快速反馈。",
    "feedbackDialog.github.title": "GitHub 反馈",
    "feedbackDialog.github.description": "适合复杂问题、仿真异常、布局错误和需要精确复现步骤的情况。",
    "feedbackDialog.github.note": "可以附带截图、日志和更长的说明，后续整理和追踪也更方便。",
    "feedbackDialog.github.action": "前往 GitHub",
    "feedbackDialog.bilibili.title": "Bilibili 反馈",
    "feedbackDialog.bilibili.description": "适合快速留言、补充现象或提出简单建议。",
    "feedbackDialog.bilibili.note": "更方便、更快被看到，也更适合国内用户直接反馈。",
    "feedbackDialog.bilibili.action": "前往 Bilibili",
    "settingsGroup.system": "系统",
    "settingsGroup.systemDescription": "语言、主题与全局界面偏好。",
    "settingsGroup.display": "显示",
    "settingsGroup.displayDescription": "图像输出与帧率表现相关设置。",
    "settingsGroup.displaySystem": "显示与系统",
    "settingsGroup.displaySystemDescription": "语言、主题与显示设置。",
    "settingsGroup.game": "游戏",
    "settingsGroup.gameDescription": "显示风格调整",
    "settingsGroup.arknightsOperation": "鹰角操作模式",
    "settingsGroup.arknightsOperationDescription": "与鹰角操作模式附加行为相关的选项。",
    "settingsGroup.shortcuts": "快捷键",
    "settingsGroup.shortcutsDescription": "编辑当前可自定义的快捷键设置。",
    "settingsGroup.other": "其他",
    "settingsGroup.otherDescription": "其他功能与设置",
    "settingsGroup.operation": "操作",
    "settingsGroup.operationDescription": "调整仿真工具中的操作逻辑。可以选择与游戏操作习惯对齐或开启增强选项。",
    "settingsGroup.debug": "调试",
    "settingsGroup.debugDescription": "一系列用于调试的设置内容。",
    "settingsField.system-language": "选择语言/Choose Language",
    "settingsField.system-languageDescription": "切换界面语言。",
    "settingsField.system-theme": "主题",
    "settingsField.system-themeDescription": "选择界面主题。",
    "settingsField.game-arknights-operation-mode": "鹰角网络操作模式",
    "settingsField.game-arknights-operation-modeDescription": "使用和游戏内一致的操作模式和快捷键；当前版本暂不可修改。",
    "settingsField.game-arknights-immediate-move": "立即移动",
    "settingsField.game-arknights-immediate-moveDescription": "从已选择的设备拖动时，立即触发移动而不需要长按。",
    "settingsField.game-arknights-copy-while-moving": "移动时复制",
    "settingsField.game-arknights-copy-while-movingDescription": "开启后，移动设备时按住 Ctrl 点击可在当前位置复制，触控工具栏也会显示复制按钮。",
    "settingsField.game-arknights-immediate-marquee": "立即框选",
    "settingsField.game-arknights-immediate-marqueeDescription": "仅鼠标模式有效，从画布空白处开始拖动时，立即开始框选而不需要长按。",
    "settingsField.game-arknights-allow-empty-logistics-endpoints": "物流允许以空地为起点",
    "settingsField.game-arknights-allow-empty-logistics-endpointsDescription": "开启后，布设传送带和管道时可以从空地起笔，否则只能从有出口的设备起笔。",
    "settingsField.game-arknights-auto-create-splitters-and-convergers": "自动创建分/汇流",
    "settingsField.game-arknights-auto-create-splitters-and-convergersDescription": "传送带/管道绘制到交汇处时，自动创建分流器和汇流器。",
    "settingsField.game-arknights-selection-right-dock-sync": "右侧面板与选择联动",
    "settingsField.game-arknights-selection-right-dock-syncDescription": "开启\"使用右侧面板显示设备属性\"后有效，在选择设备时如果面板未展开则自动展开面板。",
    "settingsField.game-arknights-inspector-open-on-second-click": "再次点击打开设备属性",
    "settingsField.game-arknights-inspector-open-on-second-clickDescription": "开启后，首次点击设备只会选中；再次点击已选中设备时才打开属性面板。",
    "settingsField.shortcut-place-conveyor": "布设传送带",
    "settingsField.shortcut-place-conveyorDescription": "设置布设传送带的快捷键。",
    "settingsField.shortcut-place-pipe": "布设管道",
    "settingsField.shortcut-place-pipeDescription": "设置布设管道的快捷键。",
    "settingsField.shortcut-resources-power": "资源与电力",
    "settingsField.shortcut-resources-powerDescription": "设置资源与电力的快捷键。",
    "settingsField.shortcut-warehouse": "仓库存取",
    "settingsField.shortcut-warehouseDescription": "设置仓库存取的快捷键。",
    "settingsField.shortcut-basic-production": "基础生产",
    "settingsField.shortcut-basic-productionDescription": "设置基础生产的快捷键。",
    "settingsField.shortcut-synthesis": "合成制造",
    "settingsField.shortcut-synthesisDescription": "设置合成制造的快捷键。",
    "settingsField.shortcut-save-blueprint": "保存蓝图",
    "settingsField.shortcut-save-blueprintDescription": "设置将当前选中实体保存为蓝图的快捷键。",
    "settingsField.shortcut-return-select": "返回选择模式",
    "settingsField.shortcut-return-selectDescription": "设置返回选择模式的快捷键。",
    "settingsField.shortcut-rotate": "旋转",
    "settingsField.shortcut-rotateDescription": "设置旋转预览设备的快捷键。",
    "settingsField.shortcut-switch-device-mode": "切换设备模式",
    "settingsField.shortcut-switch-device-modeDescription": "设置切换当前设备变体的快捷键。",
    "settingsField.shortcut-delete-device": "删除设备",
    "settingsField.shortcut-delete-deviceDescription": "设置删除选中设备的快捷键。",
    "settingsField.shortcut-move-selection": "移动选区",
    "settingsField.shortcut-move-selectionDescription": "设置移动选中设备的快捷键。",
    "settingsField.shortcut-copy-selection": "复制选区",
    "settingsField.shortcut-copy-selectionDescription": "设置复制选中设备的快捷键。",
    "settingsField.shortcut-paste-selection": "粘贴选区",
    "settingsField.shortcut-paste-selectionDescription": "设置粘贴已复制设备的快捷键。",
    "settingsField.shortcut-undo": "撤销",
    "settingsField.shortcut-undoDescription": "设置撤销操作的快捷键。",
    "settingsField.shortcut-redo": "重做",
    "settingsField.shortcut-redoDescription": "设置重做操作的快捷键。",
    "settingsField.shortcut-toggle-placement-panel": "放置模式面板",
    "settingsField.shortcut-toggle-placement-panelDescription": "设置打开/关闭放置模式面板的快捷键。",
    "settingsField.shortcut-toggle-blueprint-panel": "蓝图模式面板",
    "settingsField.shortcut-toggle-blueprint-panelDescription": "设置打开/关闭蓝图模式面板的快捷键。",
    "settingsField.shortcut-toggle-history-panel": "操作历史面板",
    "settingsField.shortcut-toggle-history-panelDescription": "设置打开/关闭操作历史面板的快捷键。",
    "settingsField.shortcut-toggle-base-panel": "基地面板",
    "settingsField.shortcut-toggle-base-panelDescription": "设置打开/关闭基地面板的快捷键。",
    "settingsField.shortcut-rotate-viewport": "旋转画布",
    "settingsField.shortcut-rotate-viewportDescription": "设置旋转画布视角的快捷键。",
    "settingsField.game-use-blueprint-style-device-images": "使用蓝图样式的设备图片",
    "settingsField.game-use-blueprint-style-device-imagesDescription": "使用蓝图样式显示设备图片，不会提高性能。",
    "settingsField.game-use-inspector-panel": "使用右侧面板显示设备属性",
    "settingsField.game-use-inspector-panelDescription": "开启后改为使用右侧面板而不是对话框进行设备设置。",
    "settingsField.game-show-hotkeys": "显示快捷键",
    "settingsField.game-show-hotkeysDescription": "在界面按钮上展示对应的快捷键提示。",
    "settingsField.game-always-show-grid-lines": "总是显示网格线",
    "settingsField.game-always-show-grid-linesDescription": "开启后总是显示网格线；关闭后仅在特定模式显示附近的网格线。",
    "settingsField.game-show-grass-background": "草地背景",
    "settingsField.game-show-grass-backgroundDescription": "在画布背景使用草地贴图。",
    "settingsField.game-show-device-names": "显示设备名称",
    "settingsField.game-show-device-namesDescription": "在设备上显示名称文本。",
    "settingsField.game-show-device-icons": "显示设备图标",
    "settingsField.game-show-device-iconsDescription": "在设备上显示图标；开启蓝图样式设备图片时会锁定为开启。",
    "settingsField.other-toolbox-show-all-activity-content": "工具箱显示所有活动内容",
    "settingsField.other-toolbox-show-all-activity-contentDescription": "开启后，工具箱会无视活动设置展示所有物品和配方。",
    "settingsField.other-debug-mode": "调试模式",
    "settingsField.other-debug-modeDescription": "打开调试模式",
    "settingsField.debug-show-fps": "显示 FPS/TPS",
    "settingsField.debug-show-fpsDescription": "开启后在画布左上角显示可折叠的 FPS/TPS 指示面板。",
    "settingsField.debug-show-gesture-diagnostics-window": "显示手势测试窗口",
    "settingsField.debug-show-gesture-diagnostics-windowDescription": "显示用于测试鼠标键盘操作的调试工具",
    "settingsOption.languageZhHans": "中文(简体)",
    "settingsOption.languageEnglish": "English (AI Translate)",
    "settingsOption.frameRate30": "30",
    "settingsOption.ayuLight": "Ayu Light",
    "settingsOption.ayuDark": "Ayu Dark",
    "settingsOption.followSystem": "跟随系统",
    "settingsOption.enabled": "已开启",
    "settingsOption.disabled": "已关闭",
    "settingsKeybinding.awaitingInput": "按任意键...",
    "settingsKeybinding.conflictTitle": "快捷键冲突",
    "settingsKeybinding.conflictMessage": "您选择的快捷键 {newKey} 正在被 {conflictLabel} 使用，是否更换？",
    "settingsKeybinding.conflictReplace": "更换",
    "settingsKeybinding.conflictCancel": "取消",
    "device.mobile": "手机",
    "device.tablet": "平板",
    "device.desktop": "电脑",
    "screen.portrait": "竖屏",
    "screen.landscape": "横屏",
    "screen.square": "近方形",
    "locale.zh-CN": "中文",
    "locale.en-US": "English (AI Translate)",
    "mutability.document-only": "仅文档态",
    "mutability.runtime-mutable": "运行态可改",
    "mutability.recompile-required": "需要重编译",
    "uiGroup.beltLogistics": "传送带物流",
    "uiGroup.pipeLogistics": "管道物流",
    "uiGroup.resourcePower": "资源与电力",
    "uiGroup.warehouse": "仓库存取",
    "uiGroup.basicProduction": "基础生产",
    "uiGroup.advancedManufacturing": "合成制造",
    "registry.entity.item_port_filling_pd_mc_1.name": "灌装机",
    "registry.entity.item_port_gas_diffuser_1.name": "气体扩散机",
    "registry.entity.item_port_gas_storager_1.name": "储气罐",
    "registry.entity.item_port_gas_collector_1.name": "气体收集泵",
    "registry.entity.item_port_solid_gas_converter_1.name": "固气转化机",
    "registry.entity.item_port_gas_reactor_1.name": "气体反应炉",
    "registry.entity.item_port_liquid_gas_converter_1.name": "液气转化机",
    "registry.item.item_gas_inert.name": "惰气",
    "registry.item.item_gas_xiranite.name": "息壤气",
    "registry.recipe.r_xiranite_oven_xiranite_powder_from_carbon_mtl_and_water_in_inert_gas_basic.name": "惰气炼息壤",
    "registry.recipe.r_gas_diffuser_inert_gas_environment_basic.name": "惰气扩散",
    "uiGroup.hidden": "隐藏设备",
    "encyclopedia.searchPlaceholder": "搜索物品或设备…",
    "encyclopedia.category.all": "全部",
    "encyclopedia.category.items": "物品",
    "encyclopedia.category.entities": "设备",
    "encyclopedia.filter.excludeBottledLiquid": "排除瓶装液体",
    "encyclopedia.group.asInput": "作为原料",
    "encyclopedia.group.asOutput": "作为产物",
    "encyclopedia.group.liquidFilling": "液体装瓶",
    "encyclopedia.group.liquidDismantle": "液体拆瓶",
    "encyclopedia.group.asMachine": "适用机器",
    "encyclopedia.noResults": "未找到匹配项",
    "encyclopedia.noRecipes": "暂无相关配方",
    "encyclopedia.back": "返回",
    "encyclopedia.home": "百科",
    "encyclopedia.viewDetails": "查看详情",
    "encyclopedia.entityLabel": "设备",
    "encyclopedia.itemLabel": "物品",
    "encyclopedia.filter.label": "筛选",
    "encyclopedia.recentItems": "最近搜索",
  },
  "en-US": {
    "app.title": "Endfield Industrial System Simulator",
    "mode.edit": "Edit",
    "action.start": "Start",
    "action.stop": "Stop",
    "action.pause": "Pause",
    "action.resume": "Resume",
    "action.step": "Step",
    "action.undo": "Undo",
    "action.redo": "Redo",
    "action.zoomIn": "Zoom In",
    "action.zoomOut": "Zoom Out",
    "action.open": "Open",
    "action.close": "Close",
    "action.cancel": "Cancel",
    "action.confirm": "Confirm",
    "action.expand": "Expand",
    "action.collapse": "Collapse",
    "dialog.maximize": "Maximize",
    "dialog.restore": "Restore",
    "action.exit": "Exit",
    "action.deemphasizePipe": "De-emphasize Pipes",
    "action.showPipe": "Show Pipes",
    "action.deemphasizeBelt": "De-emphasize Belts",
    "action.showBelt": "Show Belts",
    "action.switchToNormalMarquee": "Switch to Normal Marquee",
    "action.switchToReverseMarquee": "Switch to Reverse Marquee",
    "action.switchTheme": "Switch Theme",
    "action.enterFullscreen": "Enter Fullscreen",
    "action.exitFullscreen": "Exit Fullscreen",
    "action.deleteSelection": "Delete Selection",
    "action.removeLinks": "Remove Links",
    "action.removeLink": "Remove Link",
    "action.applyValue": "Apply",
    "action.rotatePlacement": "Rotate",
    "action.rotateView": "Rotate View",
    "action.continuousPlacement": "Continuous placement",
    "action.cancelContinuousPlacement": "Cancel continuous placement",
    "action.rotateSelection": "Rotate",
    "action.saveBlueprint": "Save Blueprint",
    "action.copySelection": "Copy Selection",
    "workbench.button.select": "Select",
    "workbench.button.batchSelect": "Batch Select",
    "workbench.button.beltDraw": "Draw Belt",
    "workbench.button.pipeDraw": "Draw Pipe",
    "action.cancelPlacement": "Cancel",
    "action.confirmPlacement": "Confirm Placement",
    "action.cancelMove": "Cancel Move",
    "action.rotateMove": "Rotate",
    "action.confirmMove": "Confirm Move",
    "action.toggleValue": "Toggle",
    "action.clearPatch": "Clear Patch",
    "toolbar.tools": "Tools",
    "toolbar.views": "Views",
    "toolbar.canvasTopLeftCorner": "Canvas Top Left Corner Toolbar",
    "toolbar.canvasRightDock": "Canvas Right Dock Toolbar",
    "toolbar.canvasBottomLeft": "Canvas Bottom Left Toolbar",
    "toolbar.canvasBottomLeftSecondary": "Canvas Bottom Left Secondary Toolbar",
    "tool.select": "Select",
    "tool.place": "Place",
    "tool.belt": "Belt",
    "tool.pipe": "Pipe",
    "tool.link": "Link",
    "tool.inspect": "Inspect",
    "tool.move": "Move",
    "tool.marquee": "Marquee",
    "view.library": "Left Panel",
    "view.inspector": "Right Panel",
    "view.diagnostics": "Diagnostics",
    "leftDock.currentMode": "Panel",
    "leftDock.activeTool": "Tool",
    "activeTool.select": "Select",
    "activeTool.move": "Move",
    "activeTool.marquee": "Marquee",
    "activeTool.blueprint-placement": "Blueprint Placement",
    "activeTool.single-placement": "Single Placement",
    "activeTool.logistics-placement": "Logistics Placement",
    "activeTool.dark-pipe-link": "Dark Pipe Link",
    "leftDock.title": "Left Context Panel",
    "leftDock.collapsed": "Library",
    "rightDock.title": "Right Inspector Panel",
    "rightDock.collapsed": "Inspector",
    "rightDock.base": "Base",
    "rightDock.power": "Power",
    "workbench.power.covered": "Forced Load",
    "workbench.power.clearOverride": "Clear Forced Load",
    "workbench.powerValue.covered": "Auto (real value)",
    "rightDock.selection": "Device Properties",
    "rightDock.simulation": "Simulation",
    "warehouseStats.title": "Warehouse Stats",
    "warehouseStats.dialogTitle": "Warehouse Stats",
    "warehouseStats.runToView": "Start simulation to view",
    "warehouseStats.empty": "No warehouse changes",
    "warehouseStats.noResults": "No matching items",
    "warehouseStats.item": "Item",
    "warehouseStats.produced": "Produced/min",
    "warehouseStats.consumed": "Consumed/min",
    "warehouseStats.stock": "Stock",
    "warehouseStats.more": "More",
    "warehouseStats.search": "Search items",
    "warehouseStats.pin": "Pin",
    "warehouseStats.unpin": "Unpin",
    "warehouseStats.pinnedCount": "Pinned",
    "section.configFields": "Config Fields",
    "section.runtimeDetails": "Runtime Details",
    "section.runtimePatch": "Runtime Patch",
    "section.diagnostics": "Diagnostics",
    "section.quickActions": "Quick Actions",
    "section.connections": "Connections",
    "label.definition": "Definition",
    "label.entityId": "Entity ID",
    "label.mode": "Mode",
    "label.currentTickSnapshot": "Current Tick Read Model",
    "label.runtime": "Runtime",
    "label.position": "Position",
    "label.rotation": "Rotation",
    "label.links": "Links",
    "label.items": "Items",
    "label.recipes": "Recipes",
    "label.definitions": "Definitions",
    "label.noSelection": "No Selection",
    "label.multiSelectionSummary": "Multiple selection currently shows shared actions only; narrow it to one entity for detailed fields.",
    "label.noConfigFields": "No configurable fields in the scaffold yet.",
    "label.noConnections": "No explicit links on the current selection.",
    "label.runtimeDetailPlaceholder": "The runtime query lane will populate richer on-demand details here.",
    "label.noDiagnostics": "No diagnostics at the moment.",
    "label.documentValue": "Document Baseline",
    "label.effectiveValue": "Effective Value",
    "label.runtimePatch": "Runtime Patch",
    "label.runtimePatchNone": "None",
    "label.runtimePatchDisabled": "This field cannot be overridden during simulation.",
    "label.runtimePatchClearsOnExit": "Leaving simulation clears runtime patches and keeps the document unchanged.",
    "label.touchPlacementHint": "Drag the ghost, then tap confirm to place it.",
    "inspector.slotConfig.group": "Slot Group",
    "inspector.slotConfig.selectItem": "Select Item",
    "inspector.slotConfig.clearSlot": "Clear Slot",
    "inspector.slotConfig.capacity": "Capacity",
    "inspector.slotConfig.locked": "Locked",
    "inspector.warehouseItemLink.description": "Choose a warehouse item for each slot.",
    "inspector.warehouseItemLink.selectItem": "Select Warehouse Item",
    "inspector.warehouseItemLink.ignoreStock": "Unlimited",
    "inspector.submitToWarehouse.label": "Wireless Submit to Warehouse",
    "inspector.submitToWarehouse.countdown": "Next Submit Countdown",
    "status.ready": "Stage1 workbench scaffold is ready.",
    "status.edit": "Edit mode focuses on document facts and compiled topology.",
    "statusBar.mode": "Mode",
    "statusBar.view": "View",
    "statusBar.running": "Simulation Stub",
    "statusBar.copyright": "Endfield Industrial System Simulator",
    "statusBar.icpFiling": "Yue ICP 2021107697-1",
    "statusBar.githubRepo": "GitHub Repository",
    "statusBar.trademarkNotice": "Arknights: Endfield is a trademark of Hypergryph. This tool is not affiliated with or endorsed by Hypergryph. Image and data assets are sourced from Arknights: Endfield game data, copyright Hypergryph.",
    "statusBar.locale": "Locale",
    "statusBar.theme": "Theme",
    "statusBar.tool": "Tool",
    "statusBar.speed": "Speed",
    "statusBar.entities": "Entities",
    "statusBar.links": "Links",
    "statusBar.compile": "Compile",
    "statusBar.diagnostics": "Diagnostics",
    "statusBar.tick": "Tick",
    "statusBar.simHz": "Sim Hz",
    "statusBar.selection": "Selection",
    "statusBar.none": "None",
    "topBar.zoom": "Zoom",
    "topBar.speed": "Speed",
    "topBar.controls": "Controls",
    "topBar.language": "Language",
    "topBar.theme": "Theme",
    "topBar.device": "Device",
    "topBar.screen": "Screen",
    "topBar.leftPanel": "Left",
    "topBar.rightPanel": "Right",
    "topBar.settings": "Settings",
    "topBar.switchToOldVersion": "Switch to Old Version",
    "settingsDialog.title": "Settings",
    "settingsDialog.groups": "Setting Groups",
    "settingsAction.resetOperationAndShortcuts": "Reset Operation Mode & Shortcuts",
    "settingsAction.resetOperationAndShortcutsConfirm": "Are you sure you want to reset operation mode and shortcuts to defaults?",
    "settingsAction.resetAllSettings": "Reset Settings",
    "settingsAction.resetAllSettingsConfirm": "Are you sure you want to reset all settings to defaults?",
    "encyclopediaPicker.title.item": "Select Item",
    "encyclopediaPicker.title.entity": "Select Device",
    "encyclopediaPicker.title.entry": "Select Item or Device",
    "toolboxDialog.title": "Toolbox",
    "toolboxDialog.tab.itemEncyclopedia": "Item Encyclopedia",
    "toolboxDialog.tab.productionPlanning": "Production Planning",
    "toolboxDialog.tab.moduleBalancing": "Module Balancing",
    "toolboxDialog.empty": "There is no toolbox content to show right now.",
    "toolboxDialog.maximize": "Maximize Toolbox",
    "toolboxDialog.restore": "Restore Toolbox",
    "toolboxDialog.dockToBottom": "Dock to Bottom",
    "toolboxDialog.undock": "Undock",
    "toolboxDialog.collapseBottomDock": "Collapse Toolbox",
    "toolboxDialog.expandBottomDock": "Expand Toolbox",
    "toolboxDialog.resizeBottomDock": "Resize Toolbox",
    "debugLogDialog.title": "Debug Logs",
    "debugLogDialog.empty": "No debug logs have been captured yet.",
    "debugLogDialog.copy": "Copy Logs",
    "debugLogDialog.copied": "Copied",
    "debugLogDialog.maximize": "Maximize Debug Logs",
    "debugLogDialog.restore": "Restore Debug Logs",
    "debugLogDialog.export": "Export Log File",
    "debugLogDialog.exporting": "Exporting…",
    "debugLogDialog.clear": "Clear Logs",
    "debugLogDialog.guidance": "If you are experiencing issues, click \"Export Log File\" above and send the downloaded file to technical support.",
    "moduleBalancing.canvas": "Canvas",
    "moduleBalancing.newCanvas": "New Canvas",
    "moduleBalancing.deleteCanvas": "Delete Canvas",
    "moduleBalancing.canvasPlaceholder": "Canvas name",
    "moduleBalancing.stage": "Stage",
    "moduleBalancing.newStage": "New Stage",
    "moduleBalancing.clearStage": "Clear Stage",
    "moduleBalancing.systemInput": "System Input",
    "moduleBalancing.addInput": "Add Input Item",
    "moduleBalancing.removeInput": "Remove Input",
    "moduleBalancing.warehouseCapacity": "Warehouse Capacity",
    "moduleBalancing.warehouseCapacityHint": "Blank to skip",
    "moduleBalancing.surplus": "Surplus",
    "moduleBalancing.deficit": "Deficit",
    "moduleBalancing.balanced": "Balanced",
    "moduleBalancing.summary": "Final Summary",
    "moduleBalancing.warehouseAnalysis": "Warehouse Analysis",
    "moduleBalancing.dispatchTicketTitle": "Dispatch Tickets",
    "moduleBalancing.dispatchTicketTotal": "Total Dispatch Rate",
    "moduleBalancing.dispatchTicketUnit": "tickets",
    "moduleBalancing.overflowTime": "Fill",
    "moduleBalancing.exhaustTime": "Empty",
    "moduleBalancing.after": "until",
    "moduleBalancing.systemModules": "System Modules",
    "moduleBalancing.customModules": "Custom Modules",
    "moduleBalancing.recipes": "Recipes",
    "moduleBalancing.modules": "Modules",
    "moduleBalancing.newModule": "New Module",
    "moduleBalancing.editModule": "Edit Module",
    "moduleBalancing.deleteModule": "Delete Module",
    "moduleBalancing.moduleName": "Module Name",
    "moduleBalancing.moduleColor": "Color",
    "moduleBalancing.moduleIcon": "Icon",
    "moduleBalancing.moduleNotes": "Notes",
    "moduleBalancing.moduleNotesPlaceholder": "Optional notes for this module…",
    "moduleBalancing.inputItems": "Inputs",
    "moduleBalancing.outputItems": "Outputs",
    "moduleBalancing.addInputItem": "Add Input",
    "moduleBalancing.addOutputItem": "Add Output",
    "moduleBalancing.moduleLibrary": "Module Library",
    "moduleBalancing.canvasInput": "Canvas Input",
    "moduleBalancing.stageDetail": "Details",
    "moduleBalancing.saveAsModule": "Save as Module",
    "moduleBalancing.saveModule": "Save Module",
    "moduleBalancing.addToStage": "Add Module",
    "moduleBalancing.editQuantity": "Edit Quantity",
    "moduleBalancing.quantity": "Quantity",
    "moduleBalancing.confirmAdd": "Confirm Add",
    "moduleBalancing.confirmEdit": "Confirm Edit",
    "moduleBalancing.deleteFromStage": "Remove Module",
    "moduleBalancing.searchModules": "Search modules...",
    "moduleBalancing.searchItems": "Search items...",
    "moduleBalancing.expandDetails": "Expand Details",
    "moduleBalancing.collapseDetails": "Collapse",
    "moduleBalancing.nItemsMore": "+{n} more",
    "moduleBalancing.emptyPorts": "No items yet",
    "moduleBalancing.none": "None",
    "moduleBalancing.noStages": "No stages yet",
    "moduleBalancing.noSummary": "Add inputs or modules to see the summary",
    "productionPlanning.targets": "Targets",
    "productionPlanning.addTarget": "Add Target",
    "productionPlanning.supplies": "Supply",
    "productionPlanning.addSupply": "Add Supply",
    "productionPlanning.calculate": "Calculate",
    "productionPlanning.modify": "Back",
    "productionPlanning.emptyLines": "No entries",
    "productionPlanning.perMinute": "Per Minute",
    "productionPlanning.infinite": "Infinite",
    "productionPlanning.infiniteNaturalDisabled": "Basic resources cannot be infinite supply",
    "productionPlanning.remove": "Remove",
    "productionPlanning.sourcePolicy": "Source Policy",
    "productionPlanning.naturalResources": "Basic Resources",
    "productionPlanning.byproductUse": "Use Byproduct",
    "productionPlanning.byproductDump": "Dump Byproduct",
    "productionPlanning.externalSupply": "External Supply",
    "productionPlanning.selfProduce": "Self-Produce",
    "productionPlanning.displayMode": "Display Mode",
    "productionPlanning.viewMode": "View",
    "productionPlanning.modeItem": "Item",
    "productionPlanning.modeDevice": "Device",
    "productionPlanning.viewTree": "Tree",
    "productionPlanning.viewFlow": "Flow",
    "productionPlanning.noTargets": "Select targets to show the production line",
    "productionPlanning.noResult": "Results appear after calculation",
    "productionPlanning.noSummary": "Select targets to show the summary",
    "productionPlanning.noRecipes": "No production steps",
    "productionPlanning.summary": "Summary",
    "productionPlanning.recipes": "Recipes",
    "productionPlanning.recipeCount": "Recipes",
    "productionPlanning.totalItems": "Items",
    "productionPlanning.missingRate": "Missing",
    "productionPlanning.demand": "Demand",
    "productionPlanning.supply": "Supply",
    "productionPlanning.produced": "Produced",
    "productionPlanning.missing": "Missing",
    "productionPlanning.recipe": "Recipe",
    "productionPlanning.autoRecipe": "Auto",
    "productionPlanning.addRecipe": "Add Recipe",
    "productionPlanning.recipeStatusEmptyHint": "No recipe yet. Add one to view progress here.",
    "productionPlanning.autoRecipeReadonly": "Auto recipe, cannot be removed",
    "productionPlanning.chooseRecipe": "Choose Recipe",
    "productionPlanning.manualOnly": "Manual",
    "productionPlanning.duration": "Time",
    "productionPlanning.devices": "Devices",
    "productionPlanning.deviceCount": "Device Count",
    "productionPlanning.second_short": "s",
    "productionPlanning.cycles": "Cycles",
    "productionPlanning.inputs": "Inputs",
    "productionPlanning.outputs": "Outputs",
    "productionPlanning.requiredInputs": "Required Inputs",
    "productionPlanning.totalOutputs": "Total Outputs",
    "productionPlanning.inputSources": "Inputs From",
    "productionPlanning.outputTargets": "Outputs To",
    "productionPlanning.none": "None",
    "productionPlanning.unresolved": "Unresolved",
    "productionPlanning.blockedCycle": "Cycle Blocked",
    "productionPlanning.cycleSource": "Growth Cycle",
    "productionPlanning.infiniteSource": "Infinite Source",
    "productionPlanning.supplied": "Supplied",
    "productionPlanning.node": "Node",
    "productionPlanning.rate": "Rate",
    "productionPlanning.status": "Status",
    "productionPlanning.shared": "Shared",
    "productionPlanning.byproduct": "Byproduct",
    "productionPlanning.producedBy": "Produced By",
    "productionPlanning.usedBy": "Used By",
    "productionPlanning.coverDemand": "Cover Demand",
    "productionPlanning.removeExternalSupply": "Remove External Supply",
    "productionPlanning.resetLayout": "Reset Layout",
    "helpDialog.title": "Help",
    "helpDialog.description": "Help topics will be organized here as multiple tabs.",
    "helpDialog.tab.gettingStarted": "Getting Started",
    "helpDialog.tab.shortcuts": "Controls",
    "helpDialog.tab.featureGuide": "Feature Guide",
    "helpDialog.tab.versionUpdates": "Version Updates",
    "helpDialog.empty": "There is no help content to show right now.",
    "helpDialog.maximize": "Maximize Help",
    "helpDialog.restore": "Restore Help",
    "feedbackDialog.title": "Feedback",
    "feedbackDialog.intro": "Choose where to send your report. GitHub is better for screenshots, logs, and longer descriptions; Bilibili is faster for quick reports and easier for users in mainland China.",
    "feedbackDialog.github.title": "GitHub Feedback",
    "feedbackDialog.github.description": "Best for complex issues, simulation mismatches, layout bugs, or anything that needs clear reproduction steps.",
    "feedbackDialog.github.note": "You can attach screenshots, logs, and longer explanations, which also makes follow-up tracking easier.",
    "feedbackDialog.github.action": "Open GitHub",
    "feedbackDialog.bilibili.title": "Bilibili Feedback",
    "feedbackDialog.bilibili.description": "Best for quick comments, brief issue reports, or simple suggestions.",
    "feedbackDialog.bilibili.note": "It is easier, more visible, and usually more convenient for domestic users.",
    "feedbackDialog.bilibili.action": "Open Bilibili",
    "settingsGroup.system": "System",
    "settingsGroup.systemDescription": "Language, theme, and global interface preferences.",
    "settingsGroup.display": "Display",
    "settingsGroup.displayDescription": "Rendering and frame rate related options.",
    "settingsGroup.displaySystem": "Display & System",
    "settingsGroup.displaySystemDescription": "Language, theme, and display settings.",
    "settingsGroup.game": "Game",
    "settingsGroup.gameDescription": "Display style adjustments",
    "settingsGroup.arknightsOperation": "Arknights Operation",
    "settingsGroup.arknightsOperationDescription": "Options for additional behaviors under Arknights operation mode.",
    "settingsGroup.shortcuts": "Keybindings",
    "settingsGroup.shortcutsDescription": "Edit the shortcut settings that are currently customizable.",
    "settingsGroup.other": "Other",
    "settingsGroup.otherDescription": "Other features and settings",
    "settingsGroup.operation": "Operation",
    "settingsGroup.operationDescription": "Adjust operational logic in the simulator. Align with game habits or enable enhanced options.",
    "settingsGroup.debug": "Debug",
    "settingsGroup.debugDescription": "A set of debug settings.",
    "settingsField.system-language": "选择语言/Choose Language",
    "settingsField.system-languageDescription": "Switch the interface language.",
    "settingsField.system-theme": "Theme",
    "settingsField.system-themeDescription": "Choose the interface theme.",
    "settingsField.game-arknights-operation-mode": "Arknights Operation Mode",
    "settingsField.game-arknights-operation-modeDescription": "Use the same operation mode and shortcuts as the game; this setting is currently unavailable.",
    "settingsField.game-arknights-immediate-move": "Immediate Move",
    "settingsField.game-arknights-immediate-moveDescription": "When dragging from a selected device, immediately trigger move without a long press.",
    "settingsField.game-arknights-copy-while-moving": "Copy While Moving",
    "settingsField.game-arknights-copy-while-movingDescription": "When enabled, Ctrl-click while moving places a copy at the current position, and touch controls show a Copy button.",
    "settingsField.game-arknights-immediate-marquee": "Immediate Marquee",
    "settingsField.game-arknights-immediate-marqueeDescription": "Mouse mode only: immediately start marquee selection when dragging from empty canvas without a long press.",
    "settingsField.game-arknights-allow-empty-logistics-endpoints": "Allow Empty Logistics Starts",
    "settingsField.game-arknights-allow-empty-logistics-endpointsDescription": "When enabled, conveyors and pipes can start from empty cells. Otherwise they must start from a device with an output.",
    "settingsField.game-arknights-auto-create-splitters-and-convergers": "Auto Create Splitters/Convergers",
    "settingsField.game-arknights-auto-create-splitters-and-convergersDescription": "Automatically create splitters and convergers when conveyors or pipes are drawn into junctions.",
    "settingsField.game-arknights-selection-right-dock-sync": "Sync Right Dock With Selection",
    "settingsField.game-arknights-selection-right-dock-syncDescription": "Effective when \"Use Right Panel For Device Properties\" is enabled. Automatically expand the right panel on selection when it is not already open.",
    "settingsField.game-arknights-inspector-open-on-second-click": "Open Inspector On Second Click",
    "settingsField.game-arknights-inspector-open-on-second-clickDescription": "When enabled, the first click only selects the device. Click the selected device again to open the properties panel.",
    "settingsField.shortcut-place-conveyor": "Place Conveyor",
    "settingsField.shortcut-place-conveyorDescription": "Set the shortcut key for placing conveyors; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-place-pipe": "Place Pipe",
    "settingsField.shortcut-place-pipeDescription": "Set the shortcut key for placing pipes; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-resources-power": "Resources & Power",
    "settingsField.shortcut-resources-powerDescription": "Set the shortcut key for resources and power; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-warehouse": "Warehouse",
    "settingsField.shortcut-warehouseDescription": "Set the shortcut key for warehouse access; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-basic-production": "Basic Production",
    "settingsField.shortcut-basic-productionDescription": "Set the shortcut key for basic production; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-synthesis": "Synthesis",
    "settingsField.shortcut-synthesisDescription": "Set the shortcut key for synthesis manufacturing; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-save-blueprint": "Save Blueprint",
    "settingsField.shortcut-save-blueprintDescription": "Set the shortcut key for saving the current selection as a blueprint; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-return-select": "Return To Select",
    "settingsField.shortcut-return-selectDescription": "Set the shortcut key for returning to select mode; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-rotate": "Rotate",
    "settingsField.shortcut-rotateDescription": "Set the shortcut key for rotating preview devices; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-switch-device-mode": "Switch Device Mode",
    "settingsField.shortcut-switch-device-modeDescription": "Set the shortcut key for switching the current device variant; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-delete-device": "Delete Device",
    "settingsField.shortcut-delete-deviceDescription": "Set the shortcut key for deleting selected devices; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-move-selection": "Move Selection",
    "settingsField.shortcut-move-selectionDescription": "Set the shortcut key for moving selected devices; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-copy-selection": "Copy Selection",
    "settingsField.shortcut-copy-selectionDescription": "Set the shortcut key for copying selected devices; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-paste-selection": "Paste Selection",
    "settingsField.shortcut-paste-selectionDescription": "Set the shortcut key for pasting copied devices; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-undo": "Undo",
    "settingsField.shortcut-undoDescription": "Set the shortcut key for undo; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-redo": "Redo",
    "settingsField.shortcut-redoDescription": "Set the shortcut key for redo; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-toggle-placement-panel": "Placement Panel",
    "settingsField.shortcut-toggle-placement-panelDescription": "Set the shortcut key for toggling the placement panel.",
    "settingsField.shortcut-toggle-blueprint-panel": "Blueprint Panel",
    "settingsField.shortcut-toggle-blueprint-panelDescription": "Set the shortcut key for toggling the blueprint panel.",
    "settingsField.shortcut-toggle-history-panel": "History Panel",
    "settingsField.shortcut-toggle-history-panelDescription": "Set the shortcut key for toggling the history panel.",
    "settingsField.shortcut-toggle-base-panel": "Base Panel",
    "settingsField.shortcut-toggle-base-panelDescription": "Set the shortcut key for toggling the base panel.",
    "settingsField.shortcut-rotate-viewport": "Rotate Viewport",
    "settingsField.shortcut-rotate-viewportDescription": "Set the shortcut key for rotating the viewport.",
    "settingsField.game-use-blueprint-style-device-images": "Use Blueprint Style Device Images",
    "settingsField.game-use-blueprint-style-device-imagesDescription": "Display device images in blueprint style; this does not improve performance.",
    "settingsField.game-use-inspector-panel": "Use Right Panel For Device Properties",
    "settingsField.game-use-inspector-panelDescription": "When enabled, use the right panel for device settings instead of a dialog.",
    "settingsField.game-always-show-grid-lines": "Always Show Grid Lines",
    "settingsField.game-always-show-grid-linesDescription": "When enabled, grid lines are always visible. When disabled, they only appear in specific modes near the current preview.",
    "settingsField.game-show-grass-background": "Grass Background",
    "settingsField.game-show-grass-backgroundDescription": "Use a grass texture on the canvas background.",
    "settingsField.game-show-device-names": "Show Device Names",
    "settingsField.game-show-device-namesDescription": "Show name labels on devices.",
    "settingsField.game-show-device-icons": "Show Device Icons",
    "settingsField.game-show-device-iconsDescription": "Show icons on devices; locked on when simplified device icons are enabled.",
    "settingsField.other-toolbox-show-all-activity-content": "Show All Activity Content in Toolbox",
    "settingsField.other-toolbox-show-all-activity-contentDescription": "When enabled, the toolbox displays all items and recipes regardless of activity settings.",
    "settingsField.game-show-hotkeys": "Show Hotkeys",
    "settingsField.game-show-hotkeysDescription": "Display shortcut key hints on interface buttons.",
    "settingsField.other-debug-mode": "Debug Mode",
    "settingsField.other-debug-modeDescription": "Enable debug mode",
    "settingsField.debug-show-fps": "Show FPS/TPS",
    "settingsField.debug-show-fpsDescription": "Show a collapsible FPS/TPS indicator panel at the top-left corner of the canvas when enabled.",
    "settingsField.debug-show-gesture-diagnostics-window": "Show Gesture Test Window",
    "settingsField.debug-show-gesture-diagnostics-windowDescription": "Show a debug tool for testing mouse and keyboard operations",
    "settingsOption.languageZhHans": "中文(简体)",
    "settingsOption.languageEnglish": "English (AI Translate)",
    "settingsOption.ayuLight": "Ayu Light",
    "settingsOption.ayuDark": "Ayu Dark",
    "settingsOption.followSystem": "Follow System",
    "settingsOption.enabled": "Enabled",
    "settingsOption.disabled": "Disabled",
    "settingsKeybinding.awaitingInput": "Press any key...",
    "settingsKeybinding.conflictTitle": "Shortcut Conflict",
    "settingsKeybinding.conflictMessage": "The shortcut {newKey} you selected is already used by {conflictLabel}. Replace it?",
    "settingsKeybinding.conflictReplace": "Replace",
    "settingsKeybinding.conflictCancel": "Cancel",
    "device.mobile": "Phone",
    "device.tablet": "Tablet",
    "device.desktop": "Desktop",
    "screen.portrait": "Portrait",
    "screen.landscape": "Landscape",
    "screen.square": "Near Square",
    "locale.zh-CN": "Chinese",
    "locale.en-US": "English (AI Translate)",
    "mutability.document-only": "Document Only",
    "mutability.runtime-mutable": "Runtime Mutable",
    "mutability.recompile-required": "Recompile Required",
    "uiGroup.beltLogistics": "Belt Logistics",
    "uiGroup.pipeLogistics": "Pipe Logistics",
    "uiGroup.resourcePower": "Resources & Power",
    "uiGroup.warehouse": "Warehouse Access",
    "uiGroup.basicProduction": "Basic Production",
    "uiGroup.advancedManufacturing": "Advanced Manufacturing",
    "registry.entity.item_port_filling_pd_mc_1.name": "Filling Unit",
    "registry.entity.item_port_gas_diffuser_1.name": "Gas Diffuser",
    "registry.entity.item_port_gas_storager_1.name": "Gas Tank",
    "registry.entity.item_port_gas_collector_1.name": "Gas Collection Pump",
    "registry.entity.item_port_solid_gas_converter_1.name": "Solid-Gas Converter",
    "registry.entity.item_port_gas_reactor_1.name": "Gas Reactor",
    "registry.entity.item_port_liquid_gas_converter_1.name": "Liquid-Gas Converter",
    "registry.item.item_gas_inert.name": "Inert Gas",
    "registry.item.item_gas_xiranite.name": "Xiranite Gas",
    "registry.recipe.r_xiranite_oven_xiranite_powder_from_carbon_mtl_and_water_in_inert_gas_basic.name": "Xiranite in Inert Gas",
    "registry.recipe.r_gas_diffuser_inert_gas_environment_basic.name": "Inert Gas Diffusion",
    "uiGroup.hidden": "Hidden Devices",
    "encyclopedia.searchPlaceholder": "Search items or devices…",
    "encyclopedia.category.all": "All",
    "encyclopedia.category.items": "Items",
    "encyclopedia.category.entities": "Devices",
    "encyclopedia.filter.excludeBottledLiquid": "Exclude Bottled Liquids",
    "encyclopedia.group.asInput": "As Input",
    "encyclopedia.group.asOutput": "As Output",
    "encyclopedia.group.liquidFilling": "Liquid Bottling",
    "encyclopedia.group.liquidDismantle": "Liquid Unbottling",
    "encyclopedia.group.asMachine": "Machines",
    "encyclopedia.noResults": "No results found",
    "encyclopedia.noRecipes": "No related recipes",
    "encyclopedia.back": "Back",
    "encyclopedia.home": "Encyclopedia",
    "encyclopedia.viewDetails": "View Details",
    "encyclopedia.entityLabel": "Device",
    "encyclopedia.itemLabel": "Item",
    "encyclopedia.filter.label": "Filter",
    "encyclopedia.recentItems": "Recent",
  },
};

export const DEFAULT_LOCALE: AppLocale = "zh-CN";

export const SUPPORTED_LOCALES: AppLocale[] = ["zh-CN", "en-US"];

export function lookupMessageText(locale: AppLocale, key: string): string | undefined {
  const localeMessages = MESSAGES[locale] as Record<string, string>;
  const defaultMessages = MESSAGES[DEFAULT_LOCALE] as Record<string, string>;

  return localeMessages[key] ?? defaultMessages[key];
}

export function createTranslator(locale: AppLocale) {
  return (key: MessageKey): string => lookupMessageText(locale, key) ?? key;
}
