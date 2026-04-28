export type AppLocale = "zh-CN" | "en-US";

export type MessageKey =
  | "app.title"
  | "mode.edit"
  | "action.start"
  | "action.stop"
  | "action.pause"
  | "action.step"
  | "action.undo"
  | "action.redo"
  | "action.zoomIn"
  | "action.zoomOut"
  | "action.open"
  | "action.close"
  | "action.expand"
  | "action.collapse"
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
  | "toolbar.tools"
  | "toolbar.views"
  | "toolbar.canvasTopLeftCorner"
  | "toolbar.canvasRightDock"
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
  | "section.configFields"
  | "section.runtimeDetails"
  | "section.runtimePatch"
  | "section.diagnostics"
  | "section.quickActions"
  | "section.connections"
  | "label.definition"
  | "label.entityId"
  | "label.mode"
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
  | "settingsField.arknightsConfirmShortcut"
  | "settingsField.arknightsConfirmShortcutDescription"
  | "settingsField.arknightsCancelShortcut"
  | "settingsField.arknightsCancelShortcutDescription"
  | "settingsField.arknightsRotateShortcut"
  | "settingsField.arknightsRotateShortcutDescription"
  | "settingsField.useSimplifiedDeviceIcons"
  | "settingsField.useSimplifiedDeviceIconsDescription"
  | "settingsField.showHotkeys"
  | "settingsField.showHotkeysDescription"
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
  | "uiGroup.hidden";

const MESSAGES: Record<AppLocale, Record<MessageKey, string>> = {
  "zh-CN": {
    "app.title": "集成工业仿真器",
    "mode.edit": "放置模式",
    "action.start": "开始仿真",
    "action.stop": "停止仿真",
    "action.pause": "暂停",
    "action.step": "单步",
    "action.undo": "撤销",
    "action.redo": "重做",
    "action.zoomIn": "放大",
    "action.zoomOut": "缩小",
    "action.open": "打开",
    "action.close": "关闭",
    "action.expand": "展开",
    "action.collapse": "折叠",
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
    "action.rotateSelection": "旋转",
    "action.saveBlueprint": "保存蓝图",
    "action.copySelection": "复制选中",
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
    "rightDock.selection": "当前选中",
    "section.configFields": "配置字段",
    "section.runtimeDetails": "运行态细节",
    "section.runtimePatch": "运行态覆盖",
    "section.diagnostics": "诊断",
    "section.quickActions": "快捷操作",
    "section.connections": "连接",
    "label.definition": "定义",
    "label.entityId": "实体 ID",
    "label.mode": "模式",
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
    "settingsField.arknightsConfirmShortcut": "部署确认快捷键",
    "settingsField.arknightsConfirmShortcutDescription": "当前为占位快捷键，尚未接入功能；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.arknightsCancelShortcut": "部署取消快捷键",
    "settingsField.arknightsCancelShortcutDescription": "当前为占位快捷键，尚未接入功能；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.arknightsRotateShortcut": "部署旋转快捷键",
    "settingsField.arknightsRotateShortcutDescription": "当前为占位快捷键，尚未接入功能；仅在鹰角网络操作模式关闭时可编辑。",
    "settingsField.useSimplifiedDeviceIcons": "使用简笔画设备图片",
    "settingsField.useSimplifiedDeviceIconsDescription": "使用蓝图简笔画显示方式，不会提高性能。",
    "settingsField.showHotkeys": "显示快捷键",
    "settingsField.showHotkeysDescription": "在界面按钮上展示对应的快捷键提示。",
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
    "uiGroup.hidden": "隐藏设备",
  },
  "en-US": {
    "app.title": "Industrial Planner Stage1",
    "mode.edit": "Edit",
    "action.start": "Start",
    "action.stop": "Stop",
    "action.pause": "Pause",
    "action.step": "Step",
    "action.undo": "Undo",
    "action.redo": "Redo",
    "action.zoomIn": "Zoom In",
    "action.zoomOut": "Zoom Out",
    "action.open": "Open",
    "action.close": "Close",
    "action.expand": "Expand",
    "action.collapse": "Collapse",
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
    "action.rotateSelection": "Rotate",
    "action.saveBlueprint": "Save Blueprint",
    "action.copySelection": "Copy Selection",
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
    "rightDock.selection": "Selection",
    "section.configFields": "Config Fields",
    "section.runtimeDetails": "Runtime Details",
    "section.runtimePatch": "Runtime Patch",
    "section.diagnostics": "Diagnostics",
    "section.quickActions": "Quick Actions",
    "section.connections": "Connections",
    "label.definition": "Definition",
    "label.entityId": "Entity ID",
    "label.mode": "Mode",
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
    "settingsField.arknightsConfirmShortcut": "Deploy Confirm Shortcut",
    "settingsField.arknightsConfirmShortcutDescription": "Placeholder shortcut only; it is not wired yet and is editable only when Arknights Operation Mode is off.",
    "settingsField.arknightsCancelShortcut": "Deploy Cancel Shortcut",
    "settingsField.arknightsCancelShortcutDescription": "Placeholder shortcut only; it is not wired yet and is editable only when Arknights Operation Mode is off.",
    "settingsField.arknightsRotateShortcut": "Deploy Rotate Shortcut",
    "settingsField.arknightsRotateShortcutDescription": "Placeholder shortcut only; it is not wired yet and is editable only when Arknights Operation Mode is off.",
    "settingsField.useSimplifiedDeviceIcons": "Use Simplified Device Icons",
    "settingsField.useSimplifiedDeviceIconsDescription": "Render devices with blueprint-style icons; this does not improve performance.",
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
    "uiGroup.hidden": "Hidden Devices",
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
