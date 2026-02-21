import type { DeviceTypeDef, ItemDef, RecipeDef } from './types'

const solidAllowance = { mode: 'solid' as const, whitelist: [] }
const recipeItemsAllowance = { mode: 'recipe_items' as const, whitelist: [] }

export const ITEMS: ItemDef[] = [
  { id: 'item_originium_ore', displayName: '源石矿', type: 'solid' },
  { id: 'item_originium_powder', displayName: '源石粉末', type: 'solid' },
]

export const RECIPES: RecipeDef[] = [
  {
    id: 'r_crusher_originium_powder_basic',
    machineType: 'item_port_grinder_1',
    cycleSeconds: 2,
    inputs: [{ itemId: 'item_originium_ore', amount: 1 }],
    outputs: [{ itemId: 'item_originium_powder', amount: 1 }],
  },
]

export const DEVICE_TYPES: DeviceTypeDef[] = [
  {
    id: 'item_port_unloader_1',
    runtimeKind: 'storage',
    requiresPower: false,
    size: { width: 3, height: 1 },
    shortName: 'Pickup',
    ports0: [
      {
        id: 'p_out_mid',
        localCellX: 1,
        localCellY: 0,
        edge: 'N',
        direction: 'Output',
        allowedItems: { mode: 'any', whitelist: [] },
        allowedTypes: solidAllowance,
      },
    ],
  },
  {
    id: 'item_port_grinder_1',
    runtimeKind: 'processor',
    requiresPower: true,
    size: { width: 3, height: 3 },
    shortName: 'Crusher',
    ports0: [
      ...[0, 1, 2].map((x) => ({
        id: `in_s_${x}`,
        localCellX: x,
        localCellY: 2,
        edge: 'S' as const,
        direction: 'Input' as const,
        allowedItems: { mode: 'recipe_inputs' as const, whitelist: [] },
        allowedTypes: solidAllowance,
      })),
      ...[0, 1, 2].map((x) => ({
        id: `out_n_${x}`,
        localCellX: x,
        localCellY: 0,
        edge: 'N' as const,
        direction: 'Output' as const,
        allowedItems: { mode: 'recipe_outputs' as const, whitelist: [] },
        allowedTypes: solidAllowance,
      })),
    ],
  },
  {
    id: 'item_port_power_diffuser_1',
    runtimeKind: 'storage',
    requiresPower: false,
    size: { width: 2, height: 2 },
    shortName: 'Pole',
    ports0: [],
  },
  {
    id: 'item_port_storager_1',
    runtimeKind: 'storage',
    requiresPower: false,
    size: { width: 3, height: 3 },
    shortName: 'Storage',
    ports0: [
      ...[0, 1, 2].map((x) => ({
        id: `in_s_${x}`,
        localCellX: x,
        localCellY: 2,
        edge: 'S' as const,
        direction: 'Input' as const,
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      })),
      ...[0, 1, 2].map((x) => ({
        id: `out_n_${x}`,
        localCellX: x,
        localCellY: 0,
        edge: 'N' as const,
        direction: 'Output' as const,
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      })),
    ],
  },
  {
    id: 'belt_straight_1x1',
    runtimeKind: 'conveyor',
    requiresPower: false,
    size: { width: 1, height: 1 },
    shortName: 'Belt',
    ports0: [
      {
        id: 'in_w',
        localCellX: 0,
        localCellY: 0,
        edge: 'W',
        direction: 'Input',
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
      {
        id: 'out_e',
        localCellX: 0,
        localCellY: 0,
        edge: 'E',
        direction: 'Output',
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
    ],
  },
  {
    id: 'belt_turn_cw_1x1',
    runtimeKind: 'conveyor',
    requiresPower: false,
    size: { width: 1, height: 1 },
    shortName: 'Turn↱',
    ports0: [
      {
        id: 'in_n',
        localCellX: 0,
        localCellY: 0,
        edge: 'N',
        direction: 'Input',
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
      {
        id: 'out_e',
        localCellX: 0,
        localCellY: 0,
        edge: 'E',
        direction: 'Output',
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
    ],
  },
  {
    id: 'belt_turn_ccw_1x1',
    runtimeKind: 'conveyor',
    requiresPower: false,
    size: { width: 1, height: 1 },
    shortName: 'Turn↰',
    ports0: [
      {
        id: 'in_n',
        localCellX: 0,
        localCellY: 0,
        edge: 'N',
        direction: 'Input',
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
      {
        id: 'out_w',
        localCellX: 0,
        localCellY: 0,
        edge: 'W',
        direction: 'Output',
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
    ],
  },
  {
    id: 'item_log_splitter',
    runtimeKind: 'junction',
    requiresPower: false,
    size: { width: 1, height: 1 },
    shortName: 'Split',
    ports0: [
      {
        id: 'in_e',
        localCellX: 0,
        localCellY: 0,
        edge: 'E',
        direction: 'Input',
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
      ...(['N', 'W', 'S'] as const).map((edge) => ({
        id: `out_${edge.toLowerCase()}`,
        localCellX: 0,
        localCellY: 0,
        edge,
        direction: 'Output' as const,
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      })),
    ],
  },
  {
    id: 'item_log_converger',
    runtimeKind: 'junction',
    requiresPower: false,
    size: { width: 1, height: 1 },
    shortName: 'Merge',
    ports0: [
      ...(['N', 'E', 'S'] as const).map((edge) => ({
        id: `in_${edge.toLowerCase()}`,
        localCellX: 0,
        localCellY: 0,
        edge,
        direction: 'Input' as const,
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      })),
      {
        id: 'out_w',
        localCellX: 0,
        localCellY: 0,
        edge: 'W',
        direction: 'Output',
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
    ],
  },
  {
    id: 'item_log_connector',
    runtimeKind: 'junction',
    requiresPower: false,
    size: { width: 1, height: 1 },
    shortName: 'Bridge',
    ports0: (['N', 'S', 'W', 'E'] as const).flatMap((edge) => [
      {
        id: `in_${edge.toLowerCase()}`,
        localCellX: 0,
        localCellY: 0,
        edge,
        direction: 'Input' as const,
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
      {
        id: `out_${edge.toLowerCase()}`,
        localCellX: 0,
        localCellY: 0,
        edge,
        direction: 'Output' as const,
        allowedItems: recipeItemsAllowance,
        allowedTypes: solidAllowance,
      },
    ]),
  },
]

export const DEVICE_TYPE_BY_ID: Record<string, DeviceTypeDef> = Object.fromEntries(
  DEVICE_TYPES.map((deviceType) => [deviceType.id, deviceType]),
)

export const PLACEABLE_TYPES = DEVICE_TYPES.filter(
  (deviceType) => !deviceType.id.startsWith('belt_'),
)

export const BELT_TYPES = new Set(['belt_straight_1x1', 'belt_turn_cw_1x1', 'belt_turn_ccw_1x1'])
export const JUNCTION_TYPES = new Set(['item_log_splitter', 'item_log_converger', 'item_log_connector'])
