export type AppLocale = "zh-CN" | "en-US";

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
  | "action.expand"
  | "action.collapse"
  | "dialog.maximize"
  | "dialog.restore"
  | "action.exit"
  | "action.deemphasizePipe"
  | "action.showPipe"
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
  | "leftDock.title"
  | "leftDock.collapsed"
  | "rightDock.title"
  | "rightDock.collapsed"
  | "rightDock.base"
  | "rightDock.power"
  | "rightDock.selection"
  | "rightDock.simulation"
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
  | "inspector.warehouseItemLink.ignoreStock"
  | "status.ready"
  | "status.edit"
  | "statusBar.mode"
  | "statusBar.view"
  | "statusBar.running"
  | "statusBar.copyright"
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
  | "settingsDialog.title"
  | "settingsDialog.groups"
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
  | "helpDialog.title"
  | "helpDialog.description"
  | "helpDialog.tab.overview"
  | "helpDialog.tab.shortcuts"
  | "helpDialog.tab.faq"
  | "helpDialog.tab.versionUpdates"
  | "helpDialog.empty"
  | "helpDialog.maximize"
  | "helpDialog.restore"
  | "settingsGroup.system"
  | "settingsGroup.systemDescription"
  | "settingsGroup.display"
  | "settingsGroup.displayDescription"
  | "settingsGroup.game"
  | "settingsGroup.gameDescription"
  | "settingsGroup.arknightsOperation"
  | "settingsGroup.arknightsOperationDescription"
  | "settingsGroup.shortcuts"
  | "settingsGroup.shortcutsDescription"
  | "settingsGroup.other"
  | "settingsGroup.otherDescription"
  | "settingsGroup.debug"
  | "settingsGroup.debugDescription"
  | "settingsField.language"
  | "settingsField.languageDescription"
  | "settingsField.theme"
  | "settingsField.themeDescription"
  | "settingsField.frameRateLimit"
  | "settingsField.frameRateLimitDescription"
  | "settingsField.arknightsOperationMode"
  | "settingsField.arknightsOperationModeDescription"
  | "settingsField.arknightsImmediateMove"
  | "settingsField.arknightsImmediateMoveDescription"
  | "settingsField.arknightsImmediateMarquee"
  | "settingsField.arknightsImmediateMarqueeDescription"
  | "settingsField.arknightsSelectionRightDockSync"
  | "settingsField.arknightsSelectionRightDockSyncDescription"
  | "settingsField.arknightsInspectorOpenOnSecondClick"
  | "settingsField.arknightsInspectorOpenOnSecondClickDescription"
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
  | "settingsField.shortcut-delete-device"
  | "settingsField.shortcut-delete-deviceDescription"
  | "settingsField.shortcut-move-selection"
  | "settingsField.shortcut-move-selectionDescription"
  | "settingsField.shortcut-copy-selection"
  | "settingsField.shortcut-copy-selectionDescription"
  | "settingsField.shortcut-paste-selection"
  | "settingsField.shortcut-paste-selectionDescription"
  | "settingsField.useSimplifiedDeviceIcons"
  | "settingsField.useSimplifiedDeviceIconsDescription"
  | "settingsField.useInspectorPanel"
  | "settingsField.useInspectorPanelDescription"
  | "settingsField.showHotkeys"
  | "settingsField.showHotkeysDescription"
  | "settingsField.alwaysShowGridLines"
  | "settingsField.alwaysShowGridLinesDescription"
  | "settingsField.showGrassBackground"
  | "settingsField.showGrassBackgroundDescription"
  | "settingsField.debugMode"
  | "settingsField.debugModeDescription"
  | "settingsField.showFps"
  | "settingsField.showFpsDescription"
  | "settingsField.showGestureTestWindow"
  | "settingsField.showGestureTestWindowDescription"
  | "settingsOption.languageZhHans"
  | "settingsOption.languageEnglish"
  | "settingsOption.frameRate30"
  | "settingsOption.frameRate60"
  | "settingsOption.ayuLight"
  | "settingsOption.ayuDark"
  | "settingsOption.followSystem"
  | "settingsOption.unlimited"
  | "settingsOption.enabled"
  | "settingsOption.disabled"
  | "settingsKeybinding.awaitingInput"
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
    "app.title": "集成工业仿真器",
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
    "action.expand": "展开",
    "action.collapse": "折叠",
    "dialog.maximize": "最大化",
    "dialog.restore": "还原",
    "action.exit": "退出",
    "action.deemphasizePipe": "弱化管道",
    "action.showPipe": "显示管道",
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
    "leftDock.title": "左侧上下文面板",
    "leftDock.collapsed": "面板",
    "rightDock.title": "右侧检视面板",
    "rightDock.collapsed": "检视",
    "rightDock.base": "基地",
    "rightDock.power": "电力",
    "rightDock.selection": "设备属性",
    "rightDock.simulation": "仿真",
    "section.configFields": "配置字段",
    "section.runtimeDetails": "运行态细节",
    "section.runtimePatch": "运行态覆盖",
    "section.diagnostics": "诊断",
    "section.quickActions": "快捷操作",
    "section.connections": "连接",
    "label.definition": "定义",
    "label.entityId": "实体 ID",
    "label.mode": "模式",
    "label.currentTickSnapshot": "当前 Tick 读模型",
    "label.runtime": "运行态",
    "label.position": "位置",
    "label.rotation": "朝向",
    "label.links": "链接",
    "label.items": "物品",
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
    "status.ready": "Stage1 工作台脚手架已就绪。",
    "status.edit": "编辑态聚焦文档事实与编译产物。",
    "statusBar.mode": "当前模式",
    "statusBar.view": "当前视图",
    "statusBar.running": "仿真占位中",
    "statusBar.copyright": "集成工业仿真",
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
    "settingsDialog.title": "设置",
    "settingsDialog.groups": "设置分组",
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
    "moduleBalancing.overflowTime": "爆仓",
    "moduleBalancing.exhaustTime": "耗尽",
    "moduleBalancing.after": "后",
    "moduleBalancing.systemModules": "系统模块",
    "moduleBalancing.customModules": "自定义模块",
    "moduleBalancing.newModule": "新建模块",
    "moduleBalancing.editModule": "编辑模块",
    "moduleBalancing.deleteModule": "删除模块",
    "moduleBalancing.moduleName": "模块名称",
    "moduleBalancing.moduleColor": "颜色",
    "moduleBalancing.moduleIcon": "图标",
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
    "helpDialog.title": "帮助",
    "helpDialog.description": "多个帮助主题会在这里按标签页组织。",
    "helpDialog.tab.overview": "概览",
    "helpDialog.tab.shortcuts": "操作说明",
    "helpDialog.tab.faq": "常见问题",
    "helpDialog.tab.versionUpdates": "版本更新",
    "helpDialog.empty": "当前没有可显示的帮助内容。",
    "helpDialog.maximize": "最大化帮助",
    "helpDialog.restore": "还原帮助",
    "settingsGroup.system": "系统",
    "settingsGroup.systemDescription": "语言、主题与全局界面偏好。",
    "settingsGroup.display": "显示",
    "settingsGroup.displayDescription": "图像输出与帧率表现相关设置。",
    "settingsGroup.game": "游戏",
    "settingsGroup.gameDescription": "与游戏操作习惯和显示风格对齐的选项。",
    "settingsGroup.arknightsOperation": "鹰角操作模式",
    "settingsGroup.arknightsOperationDescription": "与鹰角操作模式附加行为相关的选项。",
    "settingsGroup.shortcuts": "快捷键",
    "settingsGroup.shortcutsDescription": "编辑当前可自定义的快捷键设置。",
    "settingsGroup.other": "其他",
    "settingsGroup.otherDescription": "调试和附加能力开关。",
    "settingsGroup.debug": "调试",
    "settingsGroup.debugDescription": "FPS 与手势测试开关，可用于开发调试。",
    "settingsField.language": "选择语言/Choose Language",
    "settingsField.languageDescription": "切换界面语言；该条目名称始终以双语显示。",
    "settingsField.theme": "主题",
    "settingsField.themeDescription": "选择界面主题，默认 Ayu Light。",
    "settingsField.frameRateLimit": "帧率限制",
    "settingsField.frameRateLimitDescription": "设置渲染帧率上限。",
    "settingsField.arknightsOperationMode": "鹰角网络操作模式",
    "settingsField.arknightsOperationModeDescription": "使用和游戏内一致的操作模式和快捷键；当前版本暂不可修改。",
    "settingsField.arknightsImmediateMove": "立即移动",
    "settingsField.arknightsImmediateMoveDescription": "从一个已选择的设备拖动时，立即触发移动。",
    "settingsField.arknightsImmediateMarquee": "立即框选",
    "settingsField.arknightsImmediateMarqueeDescription": "鼠标模式：从画布空白处开始拖动时，立即开始框选。\n触控模式：从画布空白处长按并拖动时，立即开始框选。\n开启该选项会强制打开立即移动。",
    "settingsField.arknightsSelectionRightDockSync": "右侧面板与选择联动",
    "settingsField.arknightsSelectionRightDockSyncDescription": "选择模式下，单选设备时自动打开右侧面板；关闭右侧面板时同步取消单选，取消单选时同步关闭右侧面板。",
    "settingsField.arknightsInspectorOpenOnSecondClick": "再次点击打开设备属性",
    "settingsField.arknightsInspectorOpenOnSecondClickDescription": "开启后，首次点击设备只会选中；再次点击已选中设备时才打开 inspector 面板或对话框，并禁用再次点击取消选择。",
    "settingsField.shortcut-place-conveyor": "布设传送带",
    "settingsField.shortcut-place-conveyorDescription": "设置布设传送带的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-place-pipe": "布设管道",
    "settingsField.shortcut-place-pipeDescription": "设置布设管道的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-resources-power": "资源与电力",
    "settingsField.shortcut-resources-powerDescription": "设置资源与电力的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-warehouse": "仓库存取",
    "settingsField.shortcut-warehouseDescription": "设置仓库存取的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-basic-production": "基础生产",
    "settingsField.shortcut-basic-productionDescription": "设置基础生产的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-synthesis": "合成制造",
    "settingsField.shortcut-synthesisDescription": "设置合成制造的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-save-blueprint": "保存蓝图",
    "settingsField.shortcut-save-blueprintDescription": "设置将当前选中实体保存为蓝图的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-return-select": "返回选择模式",
    "settingsField.shortcut-return-selectDescription": "设置返回选择模式的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-rotate": "旋转",
    "settingsField.shortcut-rotateDescription": "设置旋转预览设备的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-delete-device": "删除设备",
    "settingsField.shortcut-delete-deviceDescription": "设置删除选中设备的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-move-selection": "移动选区",
    "settingsField.shortcut-move-selectionDescription": "设置移动选中设备的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-copy-selection": "复制选区",
    "settingsField.shortcut-copy-selectionDescription": "设置复制选中设备的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.shortcut-paste-selection": "粘贴选区",
    "settingsField.shortcut-paste-selectionDescription": "设置粘贴已复制设备的快捷键；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.useSimplifiedDeviceIcons": "使用蓝图样式的设备图片",
    "settingsField.useSimplifiedDeviceIconsDescription": "使用蓝图样式显示设备图片，不会提高性能。",
    "settingsField.useInspectorPanel": "使用右侧面板显示设备属性",
    "settingsField.useInspectorPanelDescription": "开启后在右侧面板显示 inspector；关闭后改为在选择模式下弹出 inspector 对话框。",
    "settingsField.showHotkeys": "显示快捷键",
    "settingsField.showHotkeysDescription": "在界面按钮上展示对应的快捷键提示。",
    "settingsField.alwaysShowGridLines": "总是显示网格线",
    "settingsField.alwaysShowGridLinesDescription": "开启后总是显示网格线；关闭后仅在框选模式显示全部网格线，其余模式只显示 preview 附近的网格线。",
    "settingsField.showGrassBackground": "草地背景",
    "settingsField.showGrassBackgroundDescription": "在画布背景平铺草地纹理贴图。",
    "settingsField.debugMode": "调试模式",
    "settingsField.debugModeDescription": "打开调试模式日志。",
    "settingsField.showFps": "显示 FPS",
    "settingsField.showFpsDescription": "开启后在画布右上角显示实时 FPS 指示器。",
    "settingsField.showGestureTestWindow": "显示手势测试窗口",
    "settingsField.showGestureTestWindowDescription": "保存手势测试窗口显示开关；当前版本仅写入配置，暂未控制窗口显示。",
    "settingsOption.languageZhHans": "中文(简体)",
    "settingsOption.languageEnglish": "English",
    "settingsOption.frameRate30": "30",
    "settingsOption.frameRate60": "60",
    "settingsOption.ayuLight": "Ayu Light",
    "settingsOption.ayuDark": "Ayu Dark",
    "settingsOption.followSystem": "跟随系统",
    "settingsOption.unlimited": "不限",
    "settingsOption.enabled": "已开启",
    "settingsOption.disabled": "已关闭",
    "settingsKeybinding.awaitingInput": "按任意键...",
    "device.mobile": "手机",
    "device.tablet": "平板",
    "device.desktop": "电脑",
    "screen.portrait": "竖屏",
    "screen.landscape": "横屏",
    "screen.square": "近方形",
    "locale.zh-CN": "中文",
    "locale.en-US": "English",
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
    "app.title": "Industrial Planner Stage1",
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
    "action.expand": "Expand",
    "action.collapse": "Collapse",
    "dialog.maximize": "Maximize",
    "dialog.restore": "Restore",
    "action.exit": "Exit",
    "action.deemphasizePipe": "De-emphasize Pipes",
    "action.showPipe": "Show Pipes",
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
    "leftDock.title": "Left Context Panel",
    "leftDock.collapsed": "Library",
    "rightDock.title": "Right Inspector Panel",
    "rightDock.collapsed": "Inspector",
    "rightDock.base": "Base",
    "rightDock.power": "Power",
    "rightDock.selection": "Device Properties",
    "rightDock.simulation": "Simulation",
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
    "status.ready": "Stage1 workbench scaffold is ready.",
    "status.edit": "Edit mode focuses on document facts and compiled topology.",
    "statusBar.mode": "Mode",
    "statusBar.view": "View",
    "statusBar.running": "Simulation Stub",
    "statusBar.copyright": "Integrated Industry Simulator",
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
    "settingsDialog.title": "Settings",
    "settingsDialog.groups": "Setting Groups",
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
    "moduleBalancing.overflowTime": "Fill",
    "moduleBalancing.exhaustTime": "Empty",
    "moduleBalancing.after": "until",
    "moduleBalancing.systemModules": "System Modules",
    "moduleBalancing.customModules": "Custom Modules",
    "moduleBalancing.newModule": "New Module",
    "moduleBalancing.editModule": "Edit Module",
    "moduleBalancing.deleteModule": "Delete Module",
    "moduleBalancing.moduleName": "Module Name",
    "moduleBalancing.moduleColor": "Color",
    "moduleBalancing.moduleIcon": "Icon",
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
    "helpDialog.title": "Help",
    "helpDialog.description": "Help topics will be organized here as multiple tabs.",
    "helpDialog.tab.overview": "Overview",
    "helpDialog.tab.shortcuts": "Controls",
    "helpDialog.tab.faq": "FAQ",
    "helpDialog.tab.versionUpdates": "Version Updates",
    "helpDialog.empty": "There is no help content to show right now.",
    "helpDialog.maximize": "Maximize Help",
    "helpDialog.restore": "Restore Help",
    "settingsGroup.system": "System",
    "settingsGroup.systemDescription": "Language, theme, and global interface preferences.",
    "settingsGroup.display": "Display",
    "settingsGroup.displayDescription": "Rendering and frame rate related options.",
    "settingsGroup.game": "Game",
    "settingsGroup.gameDescription": "Options that align controls and icon style with the game.",
    "settingsGroup.arknightsOperation": "Arknights Operation",
    "settingsGroup.arknightsOperationDescription": "Options for additional behaviors under Arknights operation mode.",
    "settingsGroup.shortcuts": "Keybindings",
    "settingsGroup.shortcutsDescription": "Edit the shortcut settings that are currently customizable.",
    "settingsGroup.other": "Other",
    "settingsGroup.otherDescription": "Debug and auxiliary capability toggles.",
    "settingsGroup.debug": "Debug",
    "settingsGroup.debugDescription": "FPS and gesture test toggles for development debugging.",
    "settingsField.language": "选择语言/Choose Language",
    "settingsField.languageDescription": "Switch the interface language; this entry label stays bilingual in every locale.",
    "settingsField.theme": "Theme",
    "settingsField.themeDescription": "Choose the interface theme; Ayu Light is the default.",
    "settingsField.frameRateLimit": "Frame Rate Limit",
    "settingsField.frameRateLimitDescription": "Set the render frame rate cap.",
    "settingsField.arknightsOperationMode": "Arknights Operation Mode",
    "settingsField.arknightsOperationModeDescription": "Use the same operation mode and shortcuts as the game; this setting is currently unavailable.",
    "settingsField.arknightsImmediateMove": "Immediate Move",
    "settingsField.arknightsImmediateMoveDescription": "Immediately trigger move when dragging from a selected device.",
    "settingsField.arknightsImmediateMarquee": "Immediate Marquee",
    "settingsField.arknightsImmediateMarqueeDescription": "Mouse mode: Immediately start marquee selection when dragging from empty canvas space.\nTouch mode: Immediately start marquee selection when long-pressing and dragging from empty canvas space.\nEnabling this option forces Immediate Move on.",
    "settingsField.arknightsSelectionRightDockSync": "Sync Right Dock With Selection",
    "settingsField.arknightsSelectionRightDockSyncDescription": "In select mode, automatically open the right dock for a single selected device, and keep dock closing and deselection in sync.",
    "settingsField.arknightsInspectorOpenOnSecondClick": "Open Inspector On Second Click",
    "settingsField.arknightsInspectorOpenOnSecondClickDescription": "When enabled, the first click only selects a device. Click the selected device again to open the inspector panel or dialog, and disable deselect-on-second-click.",
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
    "settingsField.shortcut-delete-device": "Delete Device",
    "settingsField.shortcut-delete-deviceDescription": "Set the shortcut key for deleting selected devices; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-move-selection": "Move Selection",
    "settingsField.shortcut-move-selectionDescription": "Set the shortcut key for moving selected devices; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-copy-selection": "Copy Selection",
    "settingsField.shortcut-copy-selectionDescription": "Set the shortcut key for copying selected devices; editable only when Arknights Operation Mode is off.",
    "settingsField.shortcut-paste-selection": "Paste Selection",
    "settingsField.shortcut-paste-selectionDescription": "Set the shortcut key for pasting copied devices; editable only when Arknights Operation Mode is off.",
    "settingsField.useSimplifiedDeviceIcons": "Use Simplified Device Icons",
    "settingsField.useSimplifiedDeviceIconsDescription": "Render devices with blueprint-style icons; this does not improve performance.",
    "settingsField.useInspectorPanel": "Use Right Panel For Device Properties",
    "settingsField.useInspectorPanelDescription": "When enabled, render the inspector in the right dock. When disabled, open it as a dialog in select mode.",
    "settingsField.alwaysShowGridLines": "Always Show Grid Lines",
    "settingsField.alwaysShowGridLinesDescription": "When enabled, grid lines are always visible. When disabled, marquee mode still shows the full grid, while other modes only show grid lines near the current preview.",
    "settingsField.showGrassBackground": "Grass Background",
    "settingsField.showGrassBackgroundDescription": "Tile a grass texture across the canvas background.",
    "settingsField.showHotkeys": "Show Hotkeys",
    "settingsField.showHotkeysDescription": "Display shortcut key hints on interface buttons.",
    "settingsField.debugMode": "Debug Mode",
    "settingsField.debugModeDescription": "Enable debug mode logging.",
    "settingsField.showFps": "Show FPS",
    "settingsField.showFpsDescription": "Show a real-time FPS indicator at the top-right corner of the canvas when enabled.",
    "settingsField.showGestureTestWindow": "Show Gesture Test Window",
    "settingsField.showGestureTestWindowDescription": "Persist the gesture test window toggle; the current version does not control the window visibility yet.",
    "settingsOption.languageZhHans": "中文(简体)",
    "settingsOption.languageEnglish": "English",
    "settingsOption.frameRate30": "30",
    "settingsOption.frameRate60": "60",
    "settingsOption.ayuLight": "Ayu Light",
    "settingsOption.ayuDark": "Ayu Dark",
    "settingsOption.followSystem": "Follow System",
    "settingsOption.unlimited": "Unlimited",
    "settingsOption.enabled": "Enabled",
    "settingsOption.disabled": "Disabled",
    "settingsKeybinding.awaitingInput": "Press any key...",
    "device.mobile": "Phone",
    "device.tablet": "Tablet",
    "device.desktop": "Desktop",
    "screen.portrait": "Portrait",
    "screen.landscape": "Landscape",
    "screen.square": "Near Square",
    "locale.zh-CN": "Chinese",
    "locale.en-US": "English",
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
