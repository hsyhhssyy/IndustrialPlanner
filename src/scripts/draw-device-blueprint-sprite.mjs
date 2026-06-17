import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DIRECT_BLUEPRINT_SPRITE_IDS } from './blueprint-direct-sprite-mappings.mjs';

const CELL_SIZE = 128;
const DEVICE_BORDER_INSET_RATIO = 20 / 128;
const DEVICE_BORDER_INSET = CELL_SIZE * DEVICE_BORDER_INSET_RATIO;
const DEVICE_BORDER_STROKE_WIDTH = 4;
const BLUEPRINT_ASSET_TRIM_PX = 2;
// Temporary editing aids only. Future drawing steps will remove this background
// and grid, so generated artwork must not depend on either color or the grid.
// const DEVELOPMENT_BACKGROUND_COLOR = '#e9e9e9';
// const DEVELOPMENT_GRID_LINE_COLOR = '#c9c9c9';
const DEVICE_BORDER_COLOR = '#2a2a2a';
// Some devices are still empty-shell registry definitions and do not expose
// static port coordinates yet. Blueprint drawing uses local overrides until the
// registry migration is finished.
const FLUID_BLUEPRINT_PORT_LAYOUT_OVERRIDES = new Map([
  ['item_port_mix_pool_large_1', [
    { direction: 'output', localCellX: 0, localCellY: 1, edge: 'WEST' },
    { direction: 'output', localCellX: 0, localCellY: 3, edge: 'WEST' },
    { direction: 'input', localCellX: 5, localCellY: 1, edge: 'EAST' },
    { direction: 'input', localCellX: 5, localCellY: 3, edge: 'EAST' },
  ]],
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const defaultOutputDirectory = path.resolve(projectRoot, '.temp', 'device-blueprint-sprites');
const defaultBatchOutputDirectory = path.resolve(projectRoot, 'public', 'blueprint-view', 'sprites');
const blueprintAssetDirectory = path.resolve(projectRoot, '.temp', '素材库', '解包素材库', '设备蓝图资源');
const blueprintPortPartDirectory = path.resolve(projectRoot, 'resources', 'blueprint-port-parts');
const blueprintAssetExistenceCache = new Map();
const blueprintPortPartCache = new Map();

void main();

async function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseCliOptions(args);
    if (options === null) {
      process.exitCode = 1;
      return;
    }

    if (options.mode === 'single') {
      const definition = await loadDeviceDefinition(options.deviceId);
      await writeDeviceBlueprintSprite(definition, options.outputFilePath);

      console.log(
        `Wrote ${path.relative(projectRoot, options.outputFilePath)} (${definition.footprint.width * CELL_SIZE}x${definition.footprint.height * CELL_SIZE})`,
      );
      return;
    }

    const registryContract = await loadRegistryContract();
    const batchResult = await generateBlueprintSprites(registryContract, options.outputDirectory);

    console.log(`Generated ${batchResult.generated.length} blueprint sprite(s) into ${path.relative(projectRoot, options.outputDirectory)}.`);

    if (batchResult.failed.length > 0) {
      console.log('Failed to generate:');
      for (const item of batchResult.failed) {
        console.log(`- ${item.id}: ${item.reason}`);
      }
    }

    if (batchResult.unresolved.length > 0) {
      console.log('Registry devices still missing static port definitions:');
      for (const item of batchResult.unresolved) {
        console.log(`- ${item}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function parseCliOptions(argv) {
  const [firstArgument, secondArgument] = argv;

  if (firstArgument === '--all') {
    return {
      mode: 'batch',
      outputDirectory: resolveOutputDirectory(secondArgument),
    };
  }

  if (typeof firstArgument === 'string' && firstArgument.length > 0) {
    return {
      mode: 'single',
      deviceId: firstArgument,
      outputFilePath: resolveOutputFilePath(firstArgument, secondArgument),
    };
  }

  console.error('Usage: npx tsx --tsconfig tsconfig.app.json src/scripts/draw-device-blueprint-sprite.mjs <device-id> [output-file]');
  console.error('   or: npx tsx --tsconfig tsconfig.app.json src/scripts/draw-device-blueprint-sprite.mjs --all [output-directory]');
  return null;
}

async function createDeviceBlueprintSprite(definition) {
  const baseSvgMarkup = createDeviceBlueprintCanvasSvg(definition);
  const baseBuffer = await sharp(Buffer.from(baseSvgMarkup)).png().toBuffer();
  const borderOverlayBuffer = await sharp(Buffer.from(createDeviceBorderOverlaySvg(definition))).png().toBuffer();
  const solidPortLayers = await createPortCompositeLayers(definition, 'item');
  const liquidPortLayers = await createPortCompositeLayers(definition, 'fluid');

  return sharp(baseBuffer)
    .composite([
      ...solidPortLayers,
      ...liquidPortLayers,
      { input: borderOverlayBuffer, left: 0, top: 0 },
    ])
    .png();
}

function resolveOutputFilePath(deviceId, outputFileArgument) {
  if (typeof outputFileArgument === 'string' && outputFileArgument.length > 0) {
    return path.resolve(outputFileArgument);
  }

  return path.join(defaultOutputDirectory, `${deviceId}.png`);
}

function resolveOutputDirectory(outputDirectoryArgument) {
  if (typeof outputDirectoryArgument === 'string' && outputDirectoryArgument.length > 0) {
    return path.resolve(outputDirectoryArgument);
  }

  return defaultBatchOutputDirectory;
}

async function loadDeviceDefinition(deviceId) {
  const registryContract = await loadRegistryContract();
  const definition = registryContract.entityDefinitions.find((item) => item.id === deviceId) ?? null;

  if (definition === null) {
    throw new Error(`Unknown device id: ${deviceId}`);
  }

  return definition;
}

async function loadRegistryContract() {
  try {
    const registryModule = await import('../registry/index.ts');
    return registryModule.createRegistryContract();
  } catch (error) {
    throw new Error(
      'Failed to load the TypeScript registry. Run this script through "npx tsx --tsconfig tsconfig.app.json src/scripts/draw-device-blueprint-sprite.mjs <device-id>".',
      { cause: error },
    );
  }
}

async function writeDeviceBlueprintSprite(definition, outputFilePath) {
  const spriteImage = await createDeviceBlueprintSprite(definition);

  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await spriteImage.toFile(outputFilePath);
}

async function generateBlueprintSprites(registryContract, outputDirectory) {
  const generated = [];
  const failed = [];
  const candidates = collectBlueprintGenerationCandidates(registryContract.entityDefinitions);

  for (const definition of candidates) {
    const outputFilePath = path.join(outputDirectory, `${definition.id}.png`);

    try {
      await writeDeviceBlueprintSprite(definition, outputFilePath);
      generated.push(definition.id);
    } catch (error) {
      failed.push({
        id: definition.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    generated,
    failed,
    unresolved: collectUnresolvedPortDevices(registryContract),
  };
}

function collectBlueprintGenerationCandidates(entityDefinitions) {
  return entityDefinitions.filter((definition) => (
    !isExcludedFromBlueprintBatch(definition)
    && definition.portGroups.some((group) => group.ports.length > 0)
  ));
}

function collectUnresolvedPortDevices(registryContract) {
  const recipeMachineIds = new Set(
    registryContract.recipeDefinitions
      .map((definition) => definition.machineId)
      .filter((machineId) => typeof machineId === 'string' && machineId.length > 0),
  );

  return registryContract.entityDefinitions
    .filter((definition) => (
      !isExcludedFromBlueprintBatch(definition)
      && definition.portGroups.length === 0
      && recipeMachineIds.has(definition.id)
    ))
    .map((definition) => definition.id);
}

function isExcludedFromBlueprintBatch(definition) {
  if (DIRECT_BLUEPRINT_SPRITE_IDS.has(definition.id)) {
    return true;
  }

  if (definition.uiGroup === 'beltLogistics' || definition.uiGroup === 'pipeLogistics') {
    return true;
  }

  if (definition.tags.includes('BeltFamily') || definition.tags.includes('PipeFamily')) {
    return true;
  }

  // AI-CORRECTION 2026-06-17: 暗管不再走例外排除，改为标准计算。
  return definition.id.startsWith('belt_')
    || definition.id.startsWith('pipe_')
    || definition.id.startsWith('item_log_')
    || definition.id.startsWith('item_pipe_')
    || definition.id.includes('water_pump');
}

async function loadBlueprintAsset(fileName, rotationDegrees = 0) {
  const assetFilePath = path.join(blueprintAssetDirectory, fileName);
  const metadata = await sharp(assetFilePath).metadata();

  if (typeof metadata.width !== 'number' || typeof metadata.height !== 'number') {
    throw new Error(`Failed to read blueprint asset metadata: ${fileName}`);
  }

  const normalizedRotation = ((rotationDegrees % 360) + 360) % 360;
  const rotatedWidth = normalizedRotation === 90 || normalizedRotation === 270 ? metadata.height : metadata.width;
  const rotatedHeight = normalizedRotation === 90 || normalizedRotation === 270 ? metadata.width : metadata.height;
  const trimmedWidth = rotatedWidth - BLUEPRINT_ASSET_TRIM_PX * 2;
  const trimmedHeight = rotatedHeight - BLUEPRINT_ASSET_TRIM_PX * 2;

  if (trimmedWidth <= 0 || trimmedHeight <= 0) {
    throw new Error(`Blueprint asset is too small to trim: ${fileName}`);
  }

  const pipeline = sharp(assetFilePath);

  if (normalizedRotation !== 0) {
    pipeline.rotate(normalizedRotation, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  const { data, info } = await pipeline
    .extract({
      left: BLUEPRINT_ASSET_TRIM_PX,
      top: BLUEPRINT_ASSET_TRIM_PX,
      width: trimmedWidth,
      height: trimmedHeight,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function loadPngAssetWithoutTrim(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function trimBlueprintAsset(asset, trimPx = BLUEPRINT_ASSET_TRIM_PX) {
  const trimmedWidth = asset.width - trimPx * 2;
  const trimmedHeight = asset.height - trimPx * 2;

  if (trimmedWidth <= 0 || trimmedHeight <= 0) {
    throw new Error('Blueprint asset is too small to trim.');
  }

  const { data, info } = await sharp(asset.input)
    .extract({
      left: trimPx,
      top: trimPx,
      width: trimmedWidth,
      height: trimmedHeight,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

/*
  AI-REMOVED 2026-06-13:
  Reason: 协议核心拼接不再从完整端口块裁 overlay；当前实现改为 resources/blueprint-port-parts 的 cell 片段合成。
  Trigger: 用户指出协议核心蓝图精灵存在重叠元素，并要求重新考虑拼接方法。
  Evidence: rg 显示 cropBlueprintAsset 仅剩 AI-REMOVED 历史注释引用；npx eslint src/scripts/draw-device-blueprint-sprite.mjs 通过。
  Replacement: composePortBandAsset
  Risk: Low - 该 helper 仅服务旧协议核心 overlay 拼接路径，当前 active code 不再调用。
  Human Review: Required

  Original code:
  async function cropBlueprintAsset(asset, left, width) {
    const { data, info } = await sharp(asset.input)
      .extract({
        left,
        top: 0,
        width,
        height: asset.height,
      })
      .png()
      .toBuffer({ resolveWithObject: true });

    return {
      input: data,
      width: info.width,
      height: info.height,
    };
  }
*/

async function composeBlueprintAsset(width, height, layers) {
  const { data, info } = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function loadBlueprintPortPart(kind, direction, part) {
  const cacheKey = `${kind}:${direction}:${part}`;
  const cached = blueprintPortPartCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const fileName = `${kind}-${direction}-${part}.png`;
  const partPromise = loadPngAssetWithoutTrim(path.join(blueprintPortPartDirectory, fileName));
  blueprintPortPartCache.set(cacheKey, partPromise);
  return partPromise;
}

async function composePortBandAsset(kind, direction, edgeSpan, portIndices, options = {}) {
  if (edgeSpan <= 0) {
    throw new Error(`Unsupported port band span: ${edgeSpan}`);
  }

  const partByCellKind = new Map([
    ['left', await loadBlueprintPortPart(kind, direction, 'left')],
    ['blank', await loadBlueprintPortPart(kind, direction, 'blank')],
    ['port', await loadBlueprintPortPart(kind, direction, 'port')],
    ['right', await loadBlueprintPortPart(kind, direction, 'right')],
  ]);
  const firstPart = partByCellKind.get('left');
  if (firstPart === undefined) {
    throw new Error(`Missing blueprint port part: ${kind}:${direction}:left`);
  }

  const portIndexSet = new Set(portIndices);
  const layers = [];
  for (let cellIndex = 0; cellIndex < edgeSpan; cellIndex += 1) {
    if (
      options.omitBlankEndCells === true
      && !portIndexSet.has(cellIndex)
      && (cellIndex === 0 || cellIndex === edgeSpan - 1)
    ) {
      continue;
    }

    const partKind = portIndexSet.has(cellIndex)
      ? 'port'
      : options.useEndCaps !== false && cellIndex === 0
        ? 'left'
        : options.useEndCaps !== false && cellIndex === edgeSpan - 1
          ? 'right'
          : 'blank';
    const part = partByCellKind.get(partKind);

    if (part === undefined) {
      throw new Error(`Missing blueprint port part: ${kind}:${direction}:${partKind}`);
    }

    layers.push({
      input: part.input,
      left: cellIndex * CELL_SIZE,
      top: 0,
    });
  }

  const composedAsset = await composeBlueprintAsset(
    edgeSpan * CELL_SIZE,
    firstPart.height,
    layers,
  );

  return trimBlueprintAsset(composedAsset);
}

async function rotateBlueprintAsset(asset, rotationDegrees) {
  const normalizedRotation = ((rotationDegrees % 360) + 360) % 360;
  if (normalizedRotation === 0) {
    return asset;
  }

  const { data, info } = await sharp(asset.input)
    .rotate(normalizedRotation, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: data,
    width: info.width,
    height: info.height,
  };
}

async function maybeCreateSpecialPortCompositeLayer(definition, kind, portEdge) {
  if (definition.id !== 'item_port_sp_hub_1' || kind !== 'item') {
    return null;
  }

  let asset = null;
  if (
    portEdge.direction === 'input'
    && portEdge.portCount === 7
    && portEdge.edgeSpan === 9
    && (portEdge.edge === 'NORTH' || portEdge.edge === 'SOUTH')
  ) {
    asset = await createSpHubInputCompositeAsset(portEdge.edge);
  }

  if (
    portEdge.direction === 'output'
    && portEdge.portCount === 3
    && portEdge.edgeSpan === 9
    && (portEdge.edge === 'WEST' || portEdge.edge === 'EAST')
  ) {
    asset = await createSpHubOutputCompositeAsset(portEdge.edge);
  }

  if (asset === null) {
    return null;
  }

  const position = resolveEdgeAssetPosition(definition.footprint, portEdge.edge, asset);

  return {
    input: asset.input,
    left: position.left,
    top: position.top,
  };
}

async function createSpHubInputCompositeAsset(edge) {
  const composedAsset = await composePortBandAsset('item', 'input', 9, [1, 2, 3, 4, 5, 6, 7]);
  /*
    AI-REMOVED 2026-06-13:
    Reason: 协议核心输入边改为公共端口 cell 片段重复拼接，避免完整端口块与 overlay 块重复叠加造成元素重影。
    Trigger: 用户指出协议核心蓝图模式精灵下方存在重叠元素，并建议从扩容反应池端口素材裁切公共左侧/端口/右侧片段。
    Evidence: public/blueprint-view/sprites/item_port_sp_hub_1.png 视觉检查显示端口块边框和灰条重复；旧实现同时叠加 port_in_2/3 完整块和 port_in_5_2/5_3 裁剪 overlay。
    Replacement: 当前函数顶部 composePortBandAsset('item', 'input', 9, [1..7])。
    Risk: Low - 仅影响生成脚本和重新生成后的蓝图精灵资源；端口定义未变。
    Human Review: Required

    Original code:
    const assetWidth = 9 * CELL_SIZE;
    const leftSegment = await loadBlueprintAsset('port_in_2.png');
    const middleSegment = await loadBlueprintAsset('port_in_3.png');
    const rightSegment = await loadBlueprintAsset('port_in_2.png');
    const sideOverlaySource = await loadBlueprintAsset('port_in_5_2.png');
    const centerOverlaySource = await loadBlueprintAsset('port_in_5_3.png');
    const sideOverlayHalfWidth = Math.floor(sideOverlaySource.width / 2);
    const centerOverlayThirdWidth = Math.floor(centerOverlaySource.width / 3);
    const leftOverlay = await cropBlueprintAsset(sideOverlaySource, 0, sideOverlayHalfWidth);
    const rightOverlay = await cropBlueprintAsset(
      sideOverlaySource,
      sideOverlaySource.width - sideOverlayHalfWidth,
      sideOverlayHalfWidth,
    );
    const middleOverlay = await cropBlueprintAsset(
      centerOverlaySource,
      centerOverlayThirdWidth,
      centerOverlayThirdWidth,
    );
    const assetHeight = Math.max(
      leftSegment.height,
      middleSegment.height,
      rightSegment.height,
      leftOverlay.height,
      rightOverlay.height,
      middleOverlay.height,
    );
    const composedAsset = await composeBlueprintAsset(assetWidth, assetHeight, [
      { input: leftSegment.input, left: CELL_SIZE, top: 0 },
      { input: middleSegment.input, left: CELL_SIZE * 3, top: 0 },
      { input: rightSegment.input, left: CELL_SIZE * 6, top: 0 },
      { input: leftOverlay.input, left: 0, top: 0 },
      { input: rightOverlay.input, left: assetWidth - rightOverlay.width, top: 0 },
      { input: middleOverlay.input, left: Math.round((assetWidth - middleOverlay.width) / 2), top: 0 },
    ]);
  */

  if (edge === 'SOUTH') {
    return rotateBlueprintAsset(composedAsset, 180);
  }

  return composedAsset;
}

async function createSpHubOutputCompositeAsset(edge) {
  const composedAsset = await composePortBandAsset('item', 'output', 9, [1, 4, 7], {
    useEndCaps: false,
    omitBlankEndCells: true,
  });
  /*
    AI-REMOVED 2026-06-13:
    Reason: 协议核心输出边改为公共端口 cell 片段按真实端口位置拼接，避免从 port_out_5_3 裁三段后在 3 格带内二次居中造成装饰错位。
    Trigger: 用户指出协议核心蓝图模式精灵存在重叠元素，并要求重新考虑拼接方法。
    Evidence: 旧实现把 port_out_5_3 的三段 overlay 分别放进 3 个 segmentBand，保留了源素材内的边框/灰条上下文，旋转到 W/E 后视觉上出现重叠。
    Replacement: 当前函数顶部 composePortBandAsset('item', 'output', 9, [1, 4, 7])。
    AI-CORRECTION 2026-06-13: 左右输出边现在通过 { useEndCaps: false } 关闭端帽，避免与上下输入边端帽在四角重叠。
    AI-CORRECTION 2026-06-13: 左右输出边首尾空格现在通过 { omitBlankEndCells: true } 保持透明，只由上下输入边负责角部装饰。
    Risk: Low - 仅影响生成脚本和重新生成后的蓝图精灵资源；端口定义未变。
    Human Review: Required

    Original code:
    const assetWidth = 9 * CELL_SIZE;
    const segmentBandWidth = 3 * CELL_SIZE;
    const centerOverlaySource = await loadBlueprintAsset('port_out_5_3.png');
    const overlayThirdWidth = Math.floor(centerOverlaySource.width / 3);
    const leftOverlay = await cropBlueprintAsset(centerOverlaySource, 0, overlayThirdWidth);
    const middleOverlay = await cropBlueprintAsset(
      centerOverlaySource,
      overlayThirdWidth,
      overlayThirdWidth,
    );
    const rightOverlay = await cropBlueprintAsset(
      centerOverlaySource,
      centerOverlaySource.width - overlayThirdWidth,
      overlayThirdWidth,
    );
    const composedAsset = await composeBlueprintAsset(assetWidth, centerOverlaySource.height, [
      {
        input: leftOverlay.input,
        left: Math.round((segmentBandWidth - leftOverlay.width) / 2),
        top: 0,
      },
      {
        input: middleOverlay.input,
        left: segmentBandWidth + Math.round((segmentBandWidth - middleOverlay.width) / 2),
        top: 0,
      },
      {
        input: rightOverlay.input,
        left: segmentBandWidth * 2 + Math.round((segmentBandWidth - rightOverlay.width) / 2),
        top: 0,
      },
    ]);
  */

  return rotateBlueprintAsset(composedAsset, resolveEdgeRotationDegrees(edge));
}

async function createPortCompositeLayers(definition, kind) {
  const portEdges = collectPortEdges(definition, kind);

  const edgeLayers = await Promise.all(portEdges.map(async (portEdge) => {
    const specialCompositeLayer = await maybeCreateSpecialPortCompositeLayer(definition, kind, portEdge);
    if (specialCompositeLayer !== null) {
      return [specialCompositeLayer];
    }

    const assetSource = await resolvePortAssetSource(definition, kind, portEdge);
    const asset = assetSource.asset === undefined
      ? await loadBlueprintAsset(assetSource.fileName, resolveEdgeRotationDegrees(portEdge.edge))
      : await rotateBlueprintAsset(assetSource.asset, resolveEdgeRotationDegrees(portEdge.edge));
    const position = resolveEdgeAssetPosition(
      definition.footprint,
      portEdge.edge,
      asset,
      assetSource.segmentStart,
      assetSource.segmentSpan,
    );

    return {
      input: asset.input,
      left: position.left,
      top: position.top,
    };
  }));

  return edgeLayers.flat();
}

function collectPortEdges(definition, kind) {
  const groups = new Map();

  for (const port of resolveBlueprintPorts(definition, kind)) {
    const key = `${port.direction}:${port.edge}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        direction: port.direction,
        edge: port.edge,
        portCount: 1,
        edgeSpan: resolveEdgeSpan(definition.footprint, port.edge),
        boundaryIndices: [resolveBoundaryCellIndexForSide(definition.footprint, port.edge, port)],
      });
      continue;
    }

    existing.portCount += 1;
    existing.boundaryIndices.push(resolveBoundaryCellIndexForSide(definition.footprint, port.edge, port));
  }

  return [...groups.values()].map((group) => ({
    ...group,
    boundaryIndices: [...new Set(group.boundaryIndices)].sort((left, right) => left - right),
  }));
}

function resolveBlueprintPorts(definition, kind) {
  const registryPorts = definition.portGroups.flatMap((group) => {
    if (group.kind !== kind) {
      return [];
    }

    return group.ports.map((port) => ({
      direction: normalizePortDirection(group.direction),
      localCellX: port.localCellX,
      localCellY: port.localCellY,
      edge: normalizePortEdge(port.edge),
    }));
  });
  if (registryPorts.length > 0) {
    return registryPorts;
  }

  const overridePorts = kind === 'fluid'
    ? (FLUID_BLUEPRINT_PORT_LAYOUT_OVERRIDES.get(definition.id) ?? []).map((port) => ({
      direction: normalizePortDirection(port.direction),
      localCellX: port.localCellX,
      localCellY: port.localCellY,
      edge: normalizePortEdge(port.edge),
    }))
    : [];

  return [...registryPorts, ...overridePorts];
}

function normalizePortDirection(direction) {
  switch (direction) {
    case 'input':
    case 'output':
      return direction;
    default:
      throw new Error(`Unsupported port direction: ${direction}`);
  }
}

function normalizePortEdge(edge) {
  switch (edge) {
    case 'N':
    case 'NORTH':
      return 'NORTH';
    case 'E':
    case 'EAST':
      return 'EAST';
    case 'S':
    case 'SOUTH':
      return 'SOUTH';
    case 'W':
    case 'WEST':
      return 'WEST';
    default:
      throw new Error(`Unsupported port edge: ${edge}`);
  }
}

function resolveEdgeSpan(footprint, edge) {
  switch (edge) {
    case 'NORTH':
    case 'SOUTH':
      return footprint.width;
    case 'EAST':
    case 'WEST':
      return footprint.height;
    default:
      throw new Error(`Unsupported edge span lookup: ${edge}`);
  }
}

async function resolvePortAssetSource(definition, kind, portEdge) {
  const directFileName = resolvePortAssetFileName(kind, portEdge);

  if (await hasBlueprintAsset(directFileName)) {
    return {
      fileName: directFileName,
      segmentStart: 0,
      segmentSpan: portEdge.edgeSpan,
    };
  }

  const fallbackSegment = resolveFallbackPortSegment(definition, kind, portEdge);
  if (fallbackSegment !== null) {
    const fallbackFileName = await resolveFallbackPortAssetFileName(kind, portEdge, fallbackSegment.segmentSpan);

    if (fallbackFileName !== null) {
      return {
        fileName: fallbackFileName,
        segmentStart: fallbackSegment.segmentStart,
        segmentSpan: fallbackSegment.segmentSpan,
      };
    }

    return {
      asset: await composePortBandAsset(
        kind,
        portEdge.direction,
        fallbackSegment.segmentSpan,
        portEdge.boundaryIndices.map((index) => index - fallbackSegment.segmentStart),
      ),
      segmentStart: fallbackSegment.segmentStart,
      segmentSpan: fallbackSegment.segmentSpan,
    };
  }

  throw new Error(`Input file is missing: ${path.join(blueprintAssetDirectory, directFileName)}`);
}

function resolvePortAssetFileName(kind, portEdge) {
  return resolvePortAssetFileNameByValues(kind, portEdge.direction, portEdge.edgeSpan, portEdge.portCount);
}

function resolvePortAssetFileNameByValues(kind, direction, edgeSpan, portCount) {
  const directionToken = direction === 'input' ? 'in' : 'out';
  const variantToken = portCount === edgeSpan
    ? `${edgeSpan}`
    : `${edgeSpan}_${portCount}`;
  const prefix = kind === 'fluid' ? 'pipe_port' : 'port';

  return `${prefix}_${directionToken}_${variantToken}.png`;
}

function resolveCollapsedSinglePortAssetFileName(kind, direction, edgeSpan) {
  const directionToken = direction === 'input' ? 'in' : 'out';
  const prefix = kind === 'fluid' ? 'pipe_port' : 'port';

  return `${prefix}_${directionToken}_${edgeSpan}.png`;
}

async function resolveFallbackPortAssetFileName(kind, portEdge, segmentSpan) {
  const candidateFileNames = [
    resolvePortAssetFileNameByValues(kind, portEdge.direction, segmentSpan, portEdge.portCount),
  ];

  if (portEdge.portCount === 1 && segmentSpan === 1) {
    candidateFileNames.push(resolveCollapsedSinglePortAssetFileName(kind, portEdge.direction, segmentSpan));
  }

  for (const fileName of candidateFileNames) {
    if (await hasBlueprintAsset(fileName)) {
      return fileName;
    }
  }

  return null;
}

function resolveFallbackPortSegment(definition, kind, portEdge) {
  if (portEdge.boundaryIndices.length === 0) {
    return null;
  }

  const boundaryOccupancy = resolveBoundaryOccupancy(definition, kind, portEdge.edge);
  const minIndex = portEdge.boundaryIndices[0];
  const maxIndex = portEdge.boundaryIndices[portEdge.boundaryIndices.length - 1];
  let segmentStart = minIndex;
  let segmentEnd = maxIndex;

  while (segmentStart > 0 && boundaryOccupancy[segmentStart - 1] !== 'other') {
    segmentStart -= 1;
  }

  while (segmentEnd < portEdge.edgeSpan - 1 && boundaryOccupancy[segmentEnd + 1] !== 'other') {
    segmentEnd += 1;
  }

  for (let index = segmentStart; index <= segmentEnd; index += 1) {
    if (boundaryOccupancy[index] === 'other') {
      return null;
    }
  }

  return {
    segmentStart,
    segmentSpan: segmentEnd - segmentStart + 1,
  };
}

function resolveBoundaryOccupancy(definition, kind, edge) {
  const boundarySpan = resolveEdgeSpan(definition.footprint, edge);
  const occupancy = Array.from({ length: boundarySpan }, () => 'empty');

  for (const portGroup of definition.portGroups) {
    for (const port of portGroup.ports) {
      const normalizedPort = {
        localCellX: port.localCellX,
        localCellY: port.localCellY,
      };

      if (!doesPortOccupyBoundarySide(definition.footprint, edge, normalizedPort)) {
        continue;
      }

      const boundaryIndex = resolveBoundaryCellIndexForSide(definition.footprint, edge, normalizedPort);
      const nextState = portGroup.kind === kind ? 'same' : 'other';

      if (nextState === 'other' || occupancy[boundaryIndex] === 'empty') {
        occupancy[boundaryIndex] = nextState;
      }
    }
  }

  return occupancy;
}

function resolveEdgeRotationDegrees(edge) {
  switch (edge) {
    case 'NORTH':
      return 0;
    case 'EAST':
      return 90;
    case 'SOUTH':
      return 180;
    case 'WEST':
      return 270;
    default:
      throw new Error(`Unsupported edge rotation: ${edge}`);
  }
}

function doesPortOccupyBoundarySide(footprint, edge, port) {
  switch (edge) {
    case 'NORTH':
      return port.localCellY === 0;
    case 'EAST':
      return port.localCellX === footprint.width - 1;
    case 'SOUTH':
      return port.localCellY === footprint.height - 1;
    case 'WEST':
      return port.localCellX === 0;
    default:
      throw new Error(`Unsupported boundary occupancy lookup: ${edge}`);
  }
}

function resolveBoundaryCellIndexForSide(footprint, edge, port) {
  switch (edge) {
    case 'NORTH':
    case 'SOUTH':
      return port.localCellX;
    case 'EAST':
    case 'WEST':
      return port.localCellY;
    default:
      throw new Error(`Unsupported boundary cell index lookup: ${edge}`);
  }
}

async function hasBlueprintAsset(fileName) {
  const cached = blueprintAssetExistenceCache.get(fileName);
  if (cached !== undefined) {
    return cached;
  }

  const assetExistsPromise = access(path.join(blueprintAssetDirectory, fileName))
    .then(() => true)
    .catch(() => false);

  blueprintAssetExistenceCache.set(fileName, assetExistsPromise);
  return assetExistsPromise;
}

function resolveEdgeAssetPosition(footprint, edge, asset, segmentStart = 0, segmentSpan = resolveEdgeSpan(footprint, edge)) {
  const spriteWidth = footprint.width * CELL_SIZE;
  const spriteHeight = footprint.height * CELL_SIZE;
  const segmentSize = segmentSpan * CELL_SIZE;

  switch (edge) {
    case 'NORTH':
      return {
        left: segmentStart * CELL_SIZE + Math.round((segmentSize - asset.width) / 2),
        top: 0,
      };
    case 'EAST':
      return {
        left: spriteWidth - asset.width,
        top: segmentStart * CELL_SIZE + Math.round((segmentSize - asset.height) / 2),
      };
    case 'SOUTH':
      return {
        left: segmentStart * CELL_SIZE + Math.round((segmentSize - asset.width) / 2),
        top: spriteHeight - asset.height,
      };
    case 'WEST':
      return {
        left: 0,
        top: segmentStart * CELL_SIZE + Math.round((segmentSize - asset.height) / 2),
      };
    default:
      throw new Error(`Unsupported edge placement: ${edge}`);
  }
}

function createDeviceBlueprintCanvasSvg(definition) {
  const width = definition.footprint.width * CELL_SIZE;
  const height = definition.footprint.height * CELL_SIZE;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    // '  <defs>',
    // '    <style>',
    // `      .canvas-background { fill: ${DEVELOPMENT_BACKGROUND_COLOR}; }`,
    // `      .cell-guide { fill: none; stroke: ${DEVELOPMENT_GRID_LINE_COLOR}; stroke-width: 1; shape-rendering: crispEdges; }`,
    // `      .device-border { fill: none; stroke: ${DEVICE_BORDER_COLOR}; stroke-width: ${DEVICE_BORDER_STROKE_WIDTH}; }`,
    // '    </style>',
    // '  </defs>',
    // '  <!-- Temporary editing aids only: do not depend on this background or grid. -->',
    // `  <rect class="canvas-background" x="0" y="0" width="${width}" height="${height}" />`,
    // ...createCellGuideMarkup(definition.footprint),
    '</svg>',
  ].join('\n');
}

function createDeviceBorderOverlaySvg(definition) {
  const width = definition.footprint.width * CELL_SIZE;
  const height = definition.footprint.height * CELL_SIZE;
  const borderMarkup = createDeviceBorderMarkup(width, height);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    '  <defs>',
    '    <style>',
    `      .device-border { fill: none; stroke: ${DEVICE_BORDER_COLOR}; stroke-width: ${DEVICE_BORDER_STROKE_WIDTH}; }`,
    '    </style>',
    '  </defs>',
    '  <g id="device-blueprint-border">',
    borderMarkup,
    '  </g>',
    '</svg>',
  ].join('\n');
}

function createDeviceBorderMarkup(width, height) {
  const borderWidth = width - DEVICE_BORDER_INSET * 2;
  const borderHeight = height - DEVICE_BORDER_INSET * 2;

  return `    <rect class="device-border" x="${DEVICE_BORDER_INSET}" y="${DEVICE_BORDER_INSET}" width="${borderWidth}" height="${borderHeight}" />`;
}

function createCellGuideMarkup(footprint) {
  const guides = [];

  for (let cellY = 0; cellY < footprint.height; cellY += 1) {
    for (let cellX = 0; cellX < footprint.width; cellX += 1) {
      guides.push(
        `  <rect class="cell-guide" x="${cellX * CELL_SIZE}" y="${cellY * CELL_SIZE}" width="${CELL_SIZE}" height="${CELL_SIZE}" />`,
      );
    }
  }

  return guides;
}
