import type {
  LeftPanelMode,
  SimulationSpeedPreset,
} from "@/app-shell/state/workbench-ui-state";
import type { EditorTool } from "@/editor/core/editor-session";
import type { AppLocale } from "@/i18n/messages";

export interface LocalizedText {
  "zh-CN": string;
  "en-US": string;
}

export interface PlaceholderButtonDescriptor {
  id: string;
  label: LocalizedText;
  hotkey?: string;
  tool?: EditorTool;
}

export interface PlaceholderSectionDescriptor {
  id: string;
  title: LocalizedText;
  hotkey?: string;
  buttons: PlaceholderButtonDescriptor[];
}

export interface LeftPanelDescriptor {
  title: LocalizedText;
  sections: PlaceholderSectionDescriptor[];
}

export interface LeftRailDescriptor {
  id: LeftPanelMode;
  label: LocalizedText;
  shortLabel: string;
}

export interface UtilityRailDescriptor {
  id: "feedback" | "toolbox" | "help" | "settings";
  label: LocalizedText;
  shortLabel: string;
}

export interface BaseGroupDescriptor {
  title: LocalizedText;
  options: Array<{
    id: string;
    label: LocalizedText;
    active?: boolean;
  }>;
}

export interface BaseSummaryFieldDescriptor {
  id: string;
  label: LocalizedText;
  value: LocalizedText;
}

export interface PowerSummaryFieldDescriptor {
  id: string;
  label: LocalizedText;
  value: LocalizedText;
}

export const LEFT_RAIL_PRIMARY_ITEMS: LeftRailDescriptor[] = [
  {
    id: "placement",
    label: { "zh-CN": "放置模式", "en-US": "Placement" },
    shortLabel: "P",
  },
  {
    id: "delete",
    label: { "zh-CN": "删除模式", "en-US": "Delete" },
    shortLabel: "D",
  },
  {
    id: "blueprint",
    label: { "zh-CN": "蓝图模式", "en-US": "Blueprint" },
    shortLabel: "B",
  },
  {
    id: "history",
    label: { "zh-CN": "操作历史", "en-US": "History" },
    shortLabel: "H",
  },
];

export const LEFT_RAIL_UTILITY_ITEMS: UtilityRailDescriptor[] = [
  {
    id: "feedback",
    label: { "zh-CN": "问题反馈", "en-US": "Feedback" },
    shortLabel: "F",
  },
  {
    id: "toolbox",
    label: { "zh-CN": "工具箱", "en-US": "Toolbox" },
    shortLabel: "T",
  },
  {
    id: "help",
    label: { "zh-CN": "帮助", "en-US": "Help" },
    shortLabel: "?",
  },
  {
    id: "settings",
    label: { "zh-CN": "设置", "en-US": "Settings" },
    shortLabel: "S",
  },
];

export const LEFT_PANEL_CONTENT: Record<LeftPanelMode, LeftPanelDescriptor> = {
  placement: {
    title: { "zh-CN": "放置模式", "en-US": "Placement Mode" },
    sections: [
      {
        id: "operation",
        title: { "zh-CN": "操作", "en-US": "Operation" },
        buttons: [
          {
            id: "select",
            label: { "zh-CN": "选择", "en-US": "Select" },
            tool: "select",
          },
          {
            id: "belt-draw",
            label: { "zh-CN": "铺设传送带", "en-US": "Lay Belt" },
            tool: "belt",
          },
          {
            id: "pipe-draw",
            label: { "zh-CN": "铺设管道", "en-US": "Lay Pipe" },
            tool: "pipe",
          },
          {
            id: "save-blueprint",
            label: { "zh-CN": "保存为蓝图", "en-US": "Save As Blueprint" },
          },
        ],
      },
      {
        id: "belt-logistics",
        title: { "zh-CN": "传送带物流", "en-US": "Belt Logistics" },
        hotkey: "E",
        buttons: [
          {
            id: "belt-splitter",
            label: { "zh-CN": "分流器", "en-US": "Splitter" },
          },
          {
            id: "belt-converger",
            label: { "zh-CN": "汇流器", "en-US": "Converger" },
          },
          {
            id: "belt-bridge",
            label: { "zh-CN": "桥接器", "en-US": "Bridge" },
          },
          {
            id: "item-inlet",
            label: { "zh-CN": "物品进入口", "en-US": "Item Inlet" },
          },
        ],
      },
      {
        id: "pipe-logistics",
        title: { "zh-CN": "管道物流", "en-US": "Pipe Logistics" },
        hotkey: "Q",
        buttons: [
          {
            id: "pipe-splitter",
            label: { "zh-CN": "管道分流器", "en-US": "Pipe Splitter" },
          },
          {
            id: "pipe-converger",
            label: { "zh-CN": "管道汇流器", "en-US": "Pipe Converger" },
          },
          {
            id: "pipe-bridge",
            label: { "zh-CN": "管道桥接器", "en-US": "Pipe Bridge" },
          },
          {
            id: "pipe-inlet",
            label: { "zh-CN": "管道进入口", "en-US": "Pipe Inlet" },
          },
        ],
      },
      {
        id: "resource-power",
        title: { "zh-CN": "资源与电力", "en-US": "Resource And Power" },
        hotkey: "X",
        buttons: [
          {
            id: "water-pump",
            label: { "zh-CN": "抽水泵", "en-US": "Water Pump" },
          },
          {
            id: "power-post",
            label: { "zh-CN": "供电桩", "en-US": "Power Post" },
          },
          {
            id: "thermal-pool",
            label: { "zh-CN": "热能池", "en-US": "Thermal Pool" },
          },
        ],
      },
      {
        id: "warehouse",
        title: { "zh-CN": "仓库存取", "en-US": "Warehouse" },
        hotkey: "C",
        buttons: [
          {
            id: "dark-outlet",
            label: { "zh-CN": "暗管出口", "en-US": "Dark Pipe Outlet" },
          },
          {
            id: "dark-inlet",
            label: { "zh-CN": "暗管入口", "en-US": "Dark Pipe Inlet" },
          },
          {
            id: "warehouse-storage-port",
            label: { "zh-CN": "仓库存货口", "en-US": "Warehouse Store Port" },
          },
          {
            id: "warehouse-pickup-port",
            label: { "zh-CN": "仓库取货口", "en-US": "Warehouse Pickup Port" },
          },
          {
            id: "liquid-tank",
            label: { "zh-CN": "储液罐", "en-US": "Liquid Tank" },
          },
          {
            id: "warehouse-bus-segment",
            label: { "zh-CN": "存取线基段", "en-US": "Bus Segment" },
          },
          {
            id: "warehouse-bus-source",
            label: { "zh-CN": "存取线源桩", "en-US": "Bus Source" },
          },
          {
            id: "protocol-storage",
            label: { "zh-CN": "协议存储箱", "en-US": "Protocol Storage" },
          },
        ],
      },
      {
        id: "production",
        title: { "zh-CN": "基础生产", "en-US": "Production" },
        hotkey: "V",
        buttons: [
          {
            id: "reactor-pool",
            label: { "zh-CN": "反应池", "en-US": "Reactor Pool" },
          },
          {
            id: "grinder",
            label: { "zh-CN": "粉碎机", "en-US": "Grinder" },
          },
          {
            id: "filling-machine",
            label: { "zh-CN": "流体灌装机", "en-US": "Filling Machine" },
          },
        ],
      },
    ],
  },
  delete: {
    title: { "zh-CN": "删除模式", "en-US": "Delete Mode" },
    sections: [
      {
        id: "delete-actions",
        title: { "zh-CN": "删除动作", "en-US": "Delete Actions" },
        buttons: [
          {
            id: "single-delete",
            label: { "zh-CN": "单点删除", "en-US": "Single Delete" },
          },
          {
            id: "box-delete",
            label: { "zh-CN": "框选删除", "en-US": "Box Delete" },
          },
          {
            id: "remove-links",
            label: { "zh-CN": "删除链接", "en-US": "Remove Links" },
          },
          {
            id: "clear-selection",
            label: { "zh-CN": "清除选中", "en-US": "Clear Selection" },
          },
        ],
      },
      {
        id: "delete-guard",
        title: { "zh-CN": "回收与保护", "en-US": "Recovery" },
        buttons: [
          {
            id: "undo-delete",
            label: { "zh-CN": "撤销删除", "en-US": "Undo Delete" },
          },
          {
            id: "restore-last",
            label: { "zh-CN": "恢复最近", "en-US": "Restore Last" },
          },
          {
            id: "lock-selection",
            label: { "zh-CN": "锁定选中", "en-US": "Lock Selection" },
          },
        ],
      },
    ],
  },
  blueprint: {
    title: { "zh-CN": "蓝图模式", "en-US": "Blueprint Mode" },
    sections: [
      {
        id: "blueprint-actions",
        title: { "zh-CN": "蓝图操作", "en-US": "Blueprint Actions" },
        buttons: [
          {
            id: "save-blueprint",
            label: { "zh-CN": "保存蓝图", "en-US": "Save Blueprint" },
          },
          {
            id: "import-blueprint",
            label: { "zh-CN": "导入蓝图", "en-US": "Import Blueprint" },
          },
          {
            id: "export-blueprint",
            label: { "zh-CN": "导出蓝图", "en-US": "Export Blueprint" },
          },
          {
            id: "apply-blueprint",
            label: { "zh-CN": "应用蓝图", "en-US": "Apply Blueprint" },
          },
        ],
      },
      {
        id: "blueprint-library",
        title: { "zh-CN": "蓝图库", "en-US": "Blueprint Library" },
        buttons: [
          {
            id: "sample-bus",
            label: { "zh-CN": "仓库总线样例", "en-US": "Warehouse Bus Sample" },
          },
          {
            id: "sample-dark-pipe",
            label: { "zh-CN": "暗管补给样例", "en-US": "Dark Pipe Sample" },
          },
          {
            id: "sample-reactor",
            label: { "zh-CN": "反应池样例", "en-US": "Reactor Sample" },
          },
        ],
      },
    ],
  },
  history: {
    title: { "zh-CN": "操作历史", "en-US": "History" },
    sections: [
      {
        id: "history-actions",
        title: { "zh-CN": "历史操作", "en-US": "History Actions" },
        buttons: [
          {
            id: "undo",
            label: { "zh-CN": "撤销", "en-US": "Undo" },
          },
          {
            id: "redo",
            label: { "zh-CN": "重做", "en-US": "Redo" },
          },
          {
            id: "clear-history",
            label: { "zh-CN": "清空历史", "en-US": "Clear History" },
          },
        ],
      },
      {
        id: "history-lane",
        title: { "zh-CN": "记录占位", "en-US": "Timeline Placeholder" },
        buttons: [
          {
            id: "document-commands",
            label: { "zh-CN": "文档命令流", "en-US": "Document Commands" },
          },
          {
            id: "runtime-controls",
            label: { "zh-CN": "运行控制流", "en-US": "Runtime Controls" },
          },
          {
            id: "session-actions",
            label: { "zh-CN": "会话动作流", "en-US": "Session Actions" },
          },
        ],
      },
    ],
  },
};

export const RIGHT_BASE_GROUPS: BaseGroupDescriptor[] = [
  {
    title: { "zh-CN": "四号谷地", "en-US": "Valley 4" },
    options: [
      {
        id: "protocol-core-valley",
        label: { "zh-CN": "协议核心区", "en-US": "Protocol Core" },
      },
      {
        id: "refugee-outpost",
        label: { "zh-CN": "难民前哨处", "en-US": "Refugee Outpost" },
      },
      {
        id: "infra-forward",
        label: { "zh-CN": "基建前站", "en-US": "Infra Forward" },
      },
      {
        id: "rebuild-hq",
        label: { "zh-CN": "重建指挥部", "en-US": "Rebuild HQ" },
      },
    ],
  },
  {
    title: { "zh-CN": "武陵", "en-US": "Wuling" },
    options: [
      {
        id: "protocol-core-wuling",
        label: { "zh-CN": "协议核心区", "en-US": "Protocol Core" },
        active: true,
      },
      {
        id: "tiangongping-aid",
        label: { "zh-CN": "天工坪援建点", "en-US": "Tiangongping Aid Site" },
      },
    ],
  },
];

export const RIGHT_BASE_SUMMARY: BaseSummaryFieldDescriptor[] = [
  {
    id: "buildable-area",
    label: { "zh-CN": "可放置区域", "en-US": "Buildable Area" },
    value: { "zh-CN": "80x80", "en-US": "80x80" },
  },
  {
    id: "expansion",
    label: { "zh-CN": "外扩尺寸", "en-US": "Expansion" },
    value: { "zh-CN": "T4 R4 B4 L4", "en-US": "T4 R4 B4 L4" },
  },
  {
    id: "base-tag",
    label: { "zh-CN": "基地标签", "en-US": "Base Tag" },
    value: { "zh-CN": "武陵", "en-US": "Wuling" },
  },
];

export const RIGHT_POWER_SUMMARY: PowerSummaryFieldDescriptor[] = [
  {
    id: "total-power",
    label: { "zh-CN": "总耗电", "en-US": "Total Power" },
    value: { "zh-CN": "20 kW", "en-US": "20 kW" },
  },
  {
    id: "covered-consumption",
    label: { "zh-CN": "覆盖总耗电", "en-US": "Covered Power" },
    value: { "zh-CN": "留空-按真实值", "en-US": "Placeholder - Real Value Later" },
  },
  {
    id: "current-consumption",
    label: { "zh-CN": "当前生效耗电", "en-US": "Current Effective Power" },
    value: { "zh-CN": "20 kW", "en-US": "20 kW" },
  },
  {
    id: "power-mode",
    label: { "zh-CN": "电力模式", "en-US": "Power Mode" },
    value: { "zh-CN": "无限电力", "en-US": "Infinite Power" },
  },
];

export const SIMULATION_SPEED_PRESETS: SimulationSpeedPreset[] = [
  "0.25x",
  "1x",
  "2x",
  "4x",
  "16x",
];

export function localizeText(
  locale: AppLocale,
  text: LocalizedText,
): string {
  return text[locale];
}
