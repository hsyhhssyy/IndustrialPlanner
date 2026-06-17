export const DEFAULT_BLUEPRINT_ASSET_TRIM_PX = 2;

export const DIRECT_BLUEPRINT_SPRITE_MAPPINGS = [
  {
    // icon_belt_grid is already a 128x128 tile and must not be trimmed.
    assetFileName: 'icon_belt_grid.png',
    spriteId: 'belt_straight_1x1',
    trimPx: 0,
  },
  {
    // Blueprint corner assets use the opposite turn id basis and need a 180deg flip.
    // 订正（2026-05-10）：当前 turn 基准已与角件资源对齐，角件 1 直接作为 N->E 的 ccw 图。
    assetFileName: 'icon_belt_corner_1.png',
    spriteId: 'belt_turn_ccw_1x1',
  },
  {
    // Blueprint corner assets use the opposite turn id basis and need a 180deg flip.
    // 订正（2026-05-10）：当前 turn 基准已与角件资源对齐，角件 2 直接作为 E->N 的 cw 图。
    assetFileName: 'icon_belt_corner_2.png',
    spriteId: 'belt_turn_cw_1x1',
  },
  {
    assetFileName: 'icon_pipe_grid.png',
    spriteId: 'pipe_straight_1x1',
  },
  {
    // Blueprint corner assets use the opposite turn id basis and need a 180deg flip.
    // 订正（2026-05-10）：当前 turn 基准已与角件资源对齐，角件 1 直接作为 N->E 的 ccw 图。
    assetFileName: 'icon_pipe_corner_1.png',
    spriteId: 'pipe_turn_ccw_1x1',
  },
  {
    // Blueprint corner assets use the opposite turn id basis and need a 180deg flip.
    // 订正（2026-05-10）：当前 turn 基准已与角件资源对齐，角件 2 直接作为 E->N 的 cw 图。
    assetFileName: 'icon_pipe_corner_2.png',
    spriteId: 'pipe_turn_cw_1x1',
  },
  {
    assetFileName: 'bg_machine_unloader.png',
    spriteId: 'item_port_unloader_1',
  },
  // AI-REMOVED 2026-06-17:
  // Reason: 暗管蓝图精灵改为标准计算（端口+边框），不再使用直接素材映射
  // Trigger: 用户要求暗管蓝图精灵走标准计算流程，使用方形结果
  // Replacement: draw-device-blueprint-sprite.mjs 的 createDeviceBlueprintSprite 标准流程
  // Risk: Low — 标准流程按 3×3 footprint 生成 384×384 方形精灵，与原有直接素材一致
  // Human Review: Required
  //
  // Original code:
  // {
  //   assetFileName: 'bg_machine_underground_pipe_2.png',
  //   spriteId: 'item_port_udpipe_loader_2',
  // },
  // {
  //   assetFileName: 'bg_machine_underground_pipe_2.png',
  //   spriteId: 'item_port_udpipe_unloader_2',
  // },
  // {
  //   assetFileName: 'bg_machine_underground_pipe_1.png',
  //   spriteId: 'item_port_udpipe_loader_1',
  // },
  // {
  //   assetFileName: 'bg_machine_underground_pipe_1.png',
  //   spriteId: 'item_port_udpipe_unloader_1',
  // },
  {
    assetFileName: 'bg_machine_squirter_1.png',
    spriteId: 'item_liquid_cleaner_1',
  },
  {
    assetFileName: 'bg_machine_power.png',
    spriteId: 'item_port_power_diffuser_1',
  },
  {
    assetFileName: 'bg_machine_log_hongs_bus.png',
    spriteId: 'item_port_log_hongs_bus',
  },
  {
    assetFileName: 'bg_machine_log_hongs_bus_source.png',
    spriteId: 'item_port_log_hongs_bus_source',
  },
  {
    assetFileName: 'bg_machine_loader.png',
    spriteId: 'item_port_loader_1',
  },
  {
    assetFileName: 'bg_machine_liquid_storager_1.png',
    spriteId: 'item_port_liquid_storager_1',
  },
  {
    assetFileName: 'bg_logistic_log_conditioner.png',
    spriteId: 'item_log_admission',
  },
  {
    assetFileName: 'bg_logistic_log_connector.png',
    spriteId: 'item_log_connector',
  },
  {
    assetFileName: 'bg_logistic_log_converger.png',
    spriteId: 'item_log_converger',
  },
  {
    assetFileName: 'bg_logistic_log_splitter.png',
    spriteId: 'item_log_splitter',
  },
  {
    assetFileName: 'bg_logistic_log_pipe_conditioner.png',
    spriteId: 'item_pipe_admission',
  },
  {
    assetFileName: 'bg_logistic_log_pipe_connector.png',
    spriteId: 'item_pipe_connector',
  },
  {
    assetFileName: 'bg_logistic_log_pipe_converger.png',
    spriteId: 'item_pipe_converger',
  },
  {
    assetFileName: 'bg_logistic_log_pipe_splitter.png',
    spriteId: 'item_pipe_splitter',
  },
];

export const DIRECT_BLUEPRINT_SPRITE_IDS = new Set(
  DIRECT_BLUEPRINT_SPRITE_MAPPINGS.map((mapping) => mapping.spriteId),
);