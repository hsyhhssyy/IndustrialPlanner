import type { Stage1EntityDefinition } from "@/domain/registry/stage1-registry";
import type { GridRotation } from "@/shared/geometry/grid";

export type RenderEntityKind =
  | "sprite-device"
  | "belt-track"
  | "pipe-track";

interface DeviceSpriteRenderBounds {
  widthCells: number;
  heightCells: number;
  offsetCells?: {
    x: number;
    y: number;
  };
}

interface DeviceSpriteRegistration {
  definitionId: string;
  fileName: string;
  renderBounds?: DeviceSpriteRenderBounds;
}

const TRACK_RENDER_KIND_BY_DEFINITION_ID: Partial<
  Record<string, RenderEntityKind>
> = {
  belt_straight_1x1: "belt-track",
  pipe_straight_1x1: "pipe-track",
};

const DEVICE_SPRITE_REGISTRATIONS: DeviceSpriteRegistration[] = [
  { definitionId: "item_port_unloader_1", fileName: "item_port_unloader_1.webp" },
  { definitionId: "item_port_grinder_1", fileName: "item_port_grinder_1.webp" },
  {
    definitionId: "item_port_liquid_filling_pd_mc_1",
    fileName: "item_port_filling_pd_mc_1.webp",
  },
  { definitionId: "item_port_mix_pool_1", fileName: "item_port_mix_pool_1.webp" },
  {
    definitionId: "item_port_log_hongs_bus_source",
    fileName: "item_port_log_hongs_bus_source.webp",
  },
  {
    definitionId: "item_port_log_hongs_bus",
    fileName: "item_port_log_hongs_bus.webp",
  },
  {
    definitionId: "item_port_udpipe_loader_1",
    fileName: "item_port_udpipe_loader_1.webp",
  },
  {
    definitionId: "item_port_udpipe_unloader_1",
    fileName: "item_port_udpipe_unloader_1.webp",
  },
  { definitionId: "item_port_storager_1", fileName: "item_port_storager_1.webp" },
  { definitionId: "item_log_splitter", fileName: "item_log_splitter.webp" },
  { definitionId: "item_log_converger", fileName: "item_log_converger.webp" },
  { definitionId: "item_log_connector", fileName: "item_log_connector.webp" },
  { definitionId: "item_pipe_splitter", fileName: "item_pipe_splitter.webp" },
  { definitionId: "item_pipe_converger", fileName: "item_pipe_converger.webp" },
  { definitionId: "item_pipe_connector", fileName: "item_pipe_connector.webp" },
];

const DEVICE_SPRITE_PATH_BY_DEFINITION_ID = Object.fromEntries(
  DEVICE_SPRITE_REGISTRATIONS.map((entry) => [
    entry.definitionId,
    `/sprites/${entry.fileName}`,
  ]),
) as Partial<Record<string, string>>;

const DEVICE_SPRITE_RENDER_BOUNDS_BY_DEFINITION_ID = Object.fromEntries(
  DEVICE_SPRITE_REGISTRATIONS
    .filter((entry) => entry.renderBounds)
    .map((entry) => [entry.definitionId, entry.renderBounds]),
) as Partial<Record<string, DeviceSpriteRenderBounds>>;

function rotateOffset(
  offset: DeviceSpriteRenderBounds["offsetCells"],
  rotation: GridRotation,
) {
  if (!offset) {
    return {
      x: 0,
      y: 0,
    };
  }

  switch (rotation) {
    case 90:
      return {
        x: -offset.y,
        y: offset.x,
      };
    case 180:
      return {
        x: -offset.x,
        y: -offset.y,
      };
    case 270:
      return {
        x: offset.y,
        y: -offset.x,
      };
    default:
      return offset;
  }
}

export function getStage1EntityRenderKind(
  definitionId: string,
): RenderEntityKind {
  return TRACK_RENDER_KIND_BY_DEFINITION_ID[definitionId] ?? "sprite-device";
}

export function getStage1EntitySpritePath(definitionId: string): string | null {
  return DEVICE_SPRITE_PATH_BY_DEFINITION_ID[definitionId] ?? null;
}

export function getStage1EntityTextureMetrics(options: {
  definition: Stage1EntityDefinition;
  gridSize: number;
  rotation: GridRotation;
}) {
  const renderBounds =
    DEVICE_SPRITE_RENDER_BOUNDS_BY_DEFINITION_ID[options.definition.id];
  const offsetCells = rotateOffset(renderBounds?.offsetCells, options.rotation);
  const widthCells = renderBounds?.widthCells ?? options.definition.footprint.width;
  const heightCells =
    renderBounds?.heightCells ?? options.definition.footprint.height;

  return {
    textureWidthPx: Math.max(12, widthCells * options.gridSize - 6),
    textureHeightPx: Math.max(12, heightCells * options.gridSize - 6),
    centerOffsetXPx: offsetCells.x * options.gridSize,
    centerOffsetYPx: offsetCells.y * options.gridSize,
  };
}

export function shouldShowStage1EntityLabel(
  definition: Stage1EntityDefinition,
  renderKind: RenderEntityKind,
): boolean {
  if (renderKind !== "sprite-device") {
    return false;
  }

  return definition.footprint.width * definition.footprint.height >= 4;
}
