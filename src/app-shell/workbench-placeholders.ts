import type { LeftPanelMode } from "@/workbench/workbench-ui-state";
import type { DisplayTool } from "@/editor/contracts/interaction-mode";

export interface WorkbenchTextDescriptor {
  messageKey: string;
  fallback: string;
}

export interface PlaceholderButtonDescriptor {
  id: string;
  label: WorkbenchTextDescriptor;
  hotkey?: string;
  displayTool?: DisplayTool;
  definitionId?: string;
  actionId?: PlaceholderActionId;
}

export interface PlaceholderSectionDescriptor {
  id: string;
  title: WorkbenchTextDescriptor;
  hotkey?: string;
  buttons: PlaceholderButtonDescriptor[];
}

export interface LeftPanelDescriptor {
  title: WorkbenchTextDescriptor;
  sections: PlaceholderSectionDescriptor[];
}

export interface LeftRailDescriptor {
  id: LeftPanelMode;
  label: WorkbenchTextDescriptor;
  shortLabel: string;
}

export interface UtilityRailDescriptor {
  id: "feedback" | "toolbox" | "help" | "settings";
  label: WorkbenchTextDescriptor;
  shortLabel: string;
}

export interface BaseGroupDescriptor {
  title: WorkbenchTextDescriptor;
  options: Array<{
    id: string;
    label: WorkbenchTextDescriptor;
    active?: boolean;
  }>;
}

export interface BaseSummaryFieldDescriptor {
  id: string;
  label: WorkbenchTextDescriptor;
  value: WorkbenchTextDescriptor;
}

export interface PowerSummaryFieldDescriptor {
  id: string;
  label: WorkbenchTextDescriptor;
  value: WorkbenchTextDescriptor;
}

export type PlaceholderActionId =
  | "selection.clear"
  | "selection.remove"
  | "selection.links.remove"
  | "history.undo"
  | "history.redo";

const text = (
  messageKey: string,
  fallback: string,
): WorkbenchTextDescriptor => ({
  messageKey,
  fallback,
});

export const LEFT_RAIL_PRIMARY_ITEMS: LeftRailDescriptor[] = [
  {
    id: "placement",
    label: text("workbench.leftRail.placement", "Placement"),
    shortLabel: "P",
  },
  {
    id: "delete",
    label: text("workbench.leftRail.delete", "Delete"),
    shortLabel: "D",
  },
  {
    id: "blueprint",
    label: text("workbench.leftRail.blueprint", "Blueprint"),
    shortLabel: "B",
  },
  {
    id: "history",
    label: text("workbench.leftRail.history", "History"),
    shortLabel: "H",
  },
];

export const LEFT_RAIL_UTILITY_ITEMS: UtilityRailDescriptor[] = [
  {
    id: "feedback",
    label: text("workbench.utility.feedback", "Feedback"),
    shortLabel: "F",
  },
  {
    id: "toolbox",
    label: text("workbench.utility.toolbox", "Toolbox"),
    shortLabel: "T",
  },
  {
    id: "help",
    label: text("workbench.utility.help", "Help"),
    shortLabel: "?",
  },
  {
    id: "settings",
    label: text("workbench.utility.settings", "Settings"),
    shortLabel: "S",
  },
];

export const LEFT_PANEL_CONTENT: Record<LeftPanelMode, LeftPanelDescriptor> = {
  placement: {
    title: text("workbench.panel.placement.title", "Placement Mode"),
    sections: [
      {
        id: "operation",
        title: text("workbench.section.operation", "Operation"),
        buttons: [
          {
            id: "select",
            label: text("workbench.button.select", "Select"),
            displayTool: "select",
          },
          {
            id: "belt-draw",
            label: text("workbench.button.beltDraw", "Lay Belt"),
            displayTool: "belt",
            definitionId: "belt_straight_1x1",
          },
          {
            id: "pipe-draw",
            label: text("workbench.button.pipeDraw", "Lay Pipe"),
            displayTool: "pipe",
            definitionId: "pipe_straight_1x1",
          },
          {
            id: "link",
            label: text("workbench.button.linkDarkPipe", "Link Dark Pipe"),
            displayTool: "link",
          },
          {
            id: "inspect",
            label: text("workbench.button.inspect", "Inspect"),
            displayTool: "inspect",
          },
          {
            id: "save-blueprint",
            label: text("workbench.button.saveAsBlueprint", "Save As Blueprint"),
          },
        ],
      },
      {
        id: "belt-logistics",
        title: text("workbench.section.beltLogistics", "Belt Logistics"),
        hotkey: "E",
        buttons: [
          {
            id: "belt-splitter",
            label: text("workbench.button.beltSplitter", "Splitter"),
            displayTool: "belt",
            definitionId: "item_log_splitter",
          },
          {
            id: "belt-converger",
            label: text("workbench.button.beltConverger", "Converger"),
            displayTool: "belt",
            definitionId: "item_log_converger",
          },
          {
            id: "belt-bridge",
            label: text("workbench.button.beltBridge", "Bridge"),
            displayTool: "belt",
            definitionId: "item_log_connector",
          },
          {
            id: "item-inlet",
            label: text("workbench.button.itemInlet", "Item Inlet"),
          },
        ],
      },
      {
        id: "pipe-logistics",
        title: text("workbench.section.pipeLogistics", "Pipe Logistics"),
        hotkey: "Q",
        buttons: [
          {
            id: "pipe-splitter",
            label: text("workbench.button.pipeSplitter", "Pipe Splitter"),
            displayTool: "pipe",
            definitionId: "item_pipe_splitter",
          },
          {
            id: "pipe-converger",
            label: text("workbench.button.pipeConverger", "Pipe Converger"),
            displayTool: "pipe",
            definitionId: "item_pipe_converger",
          },
          {
            id: "pipe-bridge",
            label: text("workbench.button.pipeBridge", "Pipe Bridge"),
            displayTool: "pipe",
            definitionId: "item_pipe_connector",
          },
          {
            id: "pipe-inlet",
            label: text("workbench.button.pipeInlet", "Pipe Inlet"),
          },
        ],
      },
      {
        id: "resource-power",
        title: text("workbench.section.resourcePower", "Resource And Power"),
        hotkey: "X",
        buttons: [
          {
            id: "water-pump",
            label: text("workbench.button.waterPump", "Water Pump"),
          },
          {
            id: "power-post",
            label: text("workbench.button.powerPost", "Power Post"),
          },
          {
            id: "thermal-pool",
            label: text("workbench.button.thermalPool", "Thermal Pool"),
          },
        ],
      },
      {
        id: "warehouse",
        title: text("workbench.section.warehouse", "Warehouse"),
        hotkey: "C",
        buttons: [
          {
            id: "dark-outlet",
            label: text("workbench.button.darkOutlet", "Dark Pipe Outlet"),
            displayTool: "place",
            definitionId: "item_port_udpipe_unloader_1",
          },
          {
            id: "dark-inlet",
            label: text("workbench.button.darkInlet", "Dark Pipe Inlet"),
            displayTool: "place",
            definitionId: "item_port_udpipe_loader_1",
          },
          {
            id: "warehouse-storage-port",
            label: text("workbench.button.warehouseStoragePort", "Warehouse Store Port"),
            displayTool: "place",
            definitionId: "item_port_storager_1",
          },
          {
            id: "warehouse-pickup-port",
            label: text("workbench.button.warehousePickupPort", "Warehouse Pickup Port"),
            displayTool: "place",
            definitionId: "item_port_unloader_1",
          },
          {
            id: "liquid-tank",
            label: text("workbench.button.liquidTank", "Liquid Tank"),
          },
          {
            id: "warehouse-bus-segment",
            label: text("workbench.button.warehouseBusSegment", "Bus Segment"),
            displayTool: "place",
            definitionId: "item_port_log_hongs_bus",
          },
          {
            id: "warehouse-bus-source",
            label: text("workbench.button.warehouseBusSource", "Bus Source"),
            displayTool: "place",
            definitionId: "item_port_log_hongs_bus_source",
          },
          {
            id: "protocol-storage",
            label: text("workbench.button.protocolStorage", "Protocol Storage"),
            displayTool: "place",
            definitionId: "item_port_storager_1",
          },
        ],
      },
      {
        id: "production",
        title: text("workbench.section.production", "Production"),
        hotkey: "V",
        buttons: [
          {
            id: "reactor-pool",
            label: text("workbench.button.reactorPool", "Reactor Pool"),
            displayTool: "place",
            definitionId: "item_port_mix_pool_1",
          },
          {
            id: "grinder",
            label: text("workbench.button.grinder", "Grinder"),
            displayTool: "place",
            definitionId: "item_port_grinder_1",
          },
          {
            id: "filling-machine",
            label: text("workbench.button.fillingMachine", "Filling Machine"),
            displayTool: "place",
            definitionId: "item_port_liquid_filling_pd_mc_1",
          },
        ],
      },
    ],
  },
  delete: {
    title: text("workbench.panel.delete.title", "Delete Mode"),
    sections: [
      {
        id: "delete-actions",
        title: text("workbench.section.deleteActions", "Delete Actions"),
        buttons: [
          {
            id: "single-delete",
            label: text("workbench.button.singleDelete", "Single Delete"),
            actionId: "selection.remove",
          },
          {
            id: "box-delete",
            label: text("workbench.button.boxDelete", "Box Delete"),
          },
          {
            id: "remove-links",
            label: text("workbench.button.removeLinks", "Remove Links"),
            actionId: "selection.links.remove",
          },
          {
            id: "clear-selection",
            label: text("workbench.button.clearSelection", "Clear Selection"),
            actionId: "selection.clear",
          },
        ],
      },
      {
        id: "delete-guard",
        title: text("workbench.section.deleteGuard", "Recovery"),
        buttons: [
          {
            id: "undo-delete",
            label: text("workbench.button.undoDelete", "Undo Delete"),
            actionId: "history.undo",
          },
          {
            id: "restore-last",
            label: text("workbench.button.restoreLast", "Restore Last"),
          },
          {
            id: "lock-selection",
            label: text("workbench.button.lockSelection", "Lock Selection"),
          },
        ],
      },
    ],
  },
  blueprint: {
    title: text("workbench.panel.blueprint.title", "Blueprint Mode"),
    sections: [
      {
        id: "blueprint-actions",
        title: text("workbench.section.blueprintActions", "Blueprint Actions"),
        buttons: [
          {
            id: "save-blueprint",
            label: text("workbench.button.saveBlueprint", "Save Blueprint"),
          },
          {
            id: "import-blueprint",
            label: text("workbench.button.importBlueprint", "Import Blueprint"),
          },
          {
            id: "export-blueprint",
            label: text("workbench.button.exportBlueprint", "Export Blueprint"),
          },
          {
            id: "apply-blueprint",
            label: text("workbench.button.applyBlueprint", "Apply Blueprint"),
          },
        ],
      },
      {
        id: "blueprint-library",
        title: text("workbench.section.blueprintLibrary", "Blueprint Library"),
        buttons: [
          {
            id: "sample-bus",
            label: text("workbench.button.sampleBus", "Warehouse Bus Sample"),
          },
          {
            id: "sample-dark-pipe",
            label: text("workbench.button.sampleDarkPipe", "Dark Pipe Sample"),
          },
          {
            id: "sample-reactor",
            label: text("workbench.button.sampleReactor", "Reactor Sample"),
          },
        ],
      },
    ],
  },
  history: {
    title: text("workbench.panel.history.title", "History"),
    sections: [
      {
        id: "history-actions",
        title: text("workbench.section.historyActions", "History Actions"),
        buttons: [
          {
            id: "undo",
            label: text("workbench.button.undo", "Undo"),
            actionId: "history.undo",
          },
          {
            id: "redo",
            label: text("workbench.button.redo", "Redo"),
            actionId: "history.redo",
          },
          {
            id: "clear-history",
            label: text("workbench.button.clearHistory", "Clear History"),
          },
        ],
      },
      {
        id: "history-lane",
        title: text("workbench.section.historyLane", "Timeline Placeholder"),
        buttons: [
          {
            id: "document-commands",
            label: text("workbench.button.documentCommands", "Document Commands"),
          },
          {
            id: "runtime-controls",
            label: text("workbench.button.runtimeControls", "Runtime Controls"),
          },
          {
            id: "session-actions",
            label: text("workbench.button.sessionActions", "Session Actions"),
          },
        ],
      },
    ],
  },
};

export const RIGHT_BASE_GROUPS: BaseGroupDescriptor[] = [
  {
    title: text("workbench.base.valley4", "Valley 4"),
    options: [
      {
        id: "protocol-core-valley",
        label: text("workbench.base.protocolCore", "Protocol Core"),
      },
      {
        id: "refugee-outpost",
        label: text("workbench.base.refugeeOutpost", "Refugee Outpost"),
      },
      {
        id: "infra-forward",
        label: text("workbench.base.infraForward", "Infra Forward"),
      },
      {
        id: "rebuild-hq",
        label: text("workbench.base.rebuildHQ", "Rebuild HQ"),
      },
    ],
  },
  {
    title: text("workbench.base.wuling", "Wuling"),
    options: [
      {
        id: "protocol-core-wuling",
        label: text("workbench.base.protocolCore", "Protocol Core"),
        active: true,
      },
      {
        id: "tiangongping-aid",
        label: text("workbench.base.tiangongpingAid", "Tiangongping Aid Site"),
      },
    ],
  },
];

export const RIGHT_BASE_SUMMARY: BaseSummaryFieldDescriptor[] = [
  {
    id: "buildable-area",
    label: text("workbench.summary.buildableArea", "Buildable Area"),
    value: text("workbench.summaryValue.buildableArea", "80x80"),
  },
  {
    id: "expansion",
    label: text("workbench.summary.expansion", "Expansion"),
    value: text("workbench.summaryValue.expansion", "T4 R4 B4 L4"),
  },
  {
    id: "base-tag",
    label: text("workbench.summary.baseTag", "Base Tag"),
    value: text("workbench.summaryValue.baseTag", "Wuling"),
  },
];

export const RIGHT_POWER_SUMMARY: PowerSummaryFieldDescriptor[] = [
  {
    id: "total-power",
    label: text("workbench.power.total", "Total Power"),
    value: text("workbench.powerValue.total", "20 kW"),
  },
  {
    id: "covered-consumption",
    label: text("workbench.power.covered", "Covered Power"),
    value: text("workbench.powerValue.covered", "Placeholder - Real Value Later"),
  },
  {
    id: "current-consumption",
    label: text("workbench.power.current", "Current Effective Power"),
    value: text("workbench.powerValue.current", "20 kW"),
  },
  {
    id: "power-mode",
    label: text("workbench.power.mode", "Power Mode"),
    value: text("workbench.powerValue.mode", "Infinite Power"),
  },
];

