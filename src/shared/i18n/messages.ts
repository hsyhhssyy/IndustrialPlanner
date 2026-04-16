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
  | "toolbar.tools"
  | "toolbar.views"
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
  | "topBar.leftPanel"
  | "topBar.rightPanel"
  | "topBar.settings"
  | "locale.zh-CN"
  | "locale.en-US"
  | "mutability.document-only"
  | "mutability.runtime-mutable"
  | "mutability.recompile-required";

const MESSAGES: Record<AppLocale, Record<MessageKey, string>> = {
  "zh-CN": {
    "app.title": "终末地工业系统仿真器 Stage1",
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
    "action.deleteSelection": "删除选中",
    "action.removeLinks": "删除链接",
    "action.removeLink": "移除链接",
    "action.applyValue": "应用",
    "action.rotatePlacement": "旋转",
    "action.rotateSelection": "旋转",
    "action.cancelPlacement": "取消",
    "action.confirmPlacement": "确认放置",
    "action.cancelMove": "取消移动",
    "action.rotateMove": "旋转",
    "action.confirmMove": "确认移动",
    "action.toggleValue": "切换",
    "action.clearPatch": "清除覆盖",
    "toolbar.tools": "工具",
    "toolbar.views": "视图",
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
    "topBar.leftPanel": "左侧",
    "topBar.rightPanel": "右侧",
    "topBar.settings": "设置",
    "locale.zh-CN": "中文",
    "locale.en-US": "English",
    "mutability.document-only": "仅文档态",
    "mutability.runtime-mutable": "运行态可改",
    "mutability.recompile-required": "需要重编译",
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
    "action.deleteSelection": "Delete Selection",
    "action.removeLinks": "Remove Links",
    "action.removeLink": "Remove Link",
    "action.applyValue": "Apply",
    "action.rotatePlacement": "Rotate",
    "action.rotateSelection": "Rotate",
    "action.cancelPlacement": "Cancel",
    "action.confirmPlacement": "Confirm Placement",
    "action.cancelMove": "Cancel Move",
    "action.rotateMove": "Rotate",
    "action.confirmMove": "Confirm Move",
    "action.toggleValue": "Toggle",
    "action.clearPatch": "Clear Patch",
    "toolbar.tools": "Tools",
    "toolbar.views": "Views",
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
    "topBar.leftPanel": "Left",
    "topBar.rightPanel": "Right",
    "topBar.settings": "Settings",
    "locale.zh-CN": "Chinese",
    "locale.en-US": "English",
    "mutability.document-only": "Document Only",
    "mutability.runtime-mutable": "Runtime Mutable",
    "mutability.recompile-required": "Recompile Required",
  },
};

export const DEFAULT_LOCALE: AppLocale = "zh-CN";

export const SUPPORTED_LOCALES: AppLocale[] = ["zh-CN", "en-US"];

export function createTranslator(locale: AppLocale) {
  return (key: MessageKey): string => MESSAGES[locale][key] ?? MESSAGES[DEFAULT_LOCALE][key];
}
