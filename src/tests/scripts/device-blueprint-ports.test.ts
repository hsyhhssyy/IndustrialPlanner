// @vitest-environment node

import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridEdge } from "@/domain/shared/grid";
import { createRegistryContract } from "@/registry";
import { CUSTOM_REGISTRY_ASSET_ID } from "@/shared/browser/custom-registry-assets";
// @ts-expect-error 既有素材生成入口为 Node mjs；直接复用真实合成链路。
import { collectBlueprintGenerationCandidates, createDeviceBlueprintSprite } from "../../scripts/draw-device-blueprint-sprite.mjs";

const registry = createRegistryContract();
const purifier = registry.entityDefinitions.find((definition) => definition.id === "liquid_purifier_1_gas")!;
const pipeGroup = purifier.portGroups.find((group) => group.id === "gas_input")!;
const solidGroup = purifier.portGroups.find((group) => group.id === "item_input")!;
const generatedDevices: EntityDefinition[] = collectBlueprintGenerationCandidates(registry);
const CELL_SIZE = 128;
// AI-CORRECTION 2026-11-25: 用户要求新增设备未取得美术素材前统一使用自定义设备问号占位图。
// 占位精灵不含真实端口标记，因此只对已发布专属精灵的设备做端口像素对账。
const verifiedDevices = generatedDevices.filter(
  (definition) => definition.spriteId !== CUSTOM_REGISTRY_ASSET_ID,
);
type Pixels = Awaited<ReturnType<typeof readPixels>>;

describe("蓝图精灵端口位置", () => {
  for (const edge of ["NORTH", "EAST", "SOUTH", "WEST"] as const) {
    for (const direction of ["input", "output"] as const) {
      it(`${edge} 边的非对称流体 ${direction} 保持注册表格序`, async () => {
        const footprint = { width: 7, height: 7 };
        const definition: EntityDefinition = {
          ...purifier,
          id: `blueprint-port-${edge}-${direction}`,
          footprint,
          portGroups: [{
            ...pipeGroup,
            direction,
            ports: [1, 4].map((index) => ({
              ...pipeGroup.ports[0]!,
              id: `port-${index}`,
              edge,
              localCellX: edge === "WEST" ? 0 : edge === "EAST" ? 6 : index,
              localCellY: edge === "NORTH" ? 0 : edge === "SOUTH" ? 6 : index,
            })),
          }],
        };

        const image = await createDeviceBlueprintSprite(definition);
        const pixels = await readPixels(await image.toBuffer());
        expect(readPortCellIndices(pixels, edge, direction)).toEqual([1, 4]);
      });
    }
  }

  it("相邻边的固体端口裁短 WEST 片段后，气体输入口仍位于第 3 行", async () => {
    const definition: EntityDefinition = {
      ...purifier,
      id: "blueprint-port-mixed-corner",
      portGroups: [
        pipeGroup,
        {
          ...solidGroup,
          ports: [{ ...solidGroup.ports[0]!, localCellX: 0, localCellY: 0, edge: "NORTH" }],
        },
      ],
    };

    const image = await createDeviceBlueprintSprite(definition);
    const pixels = await readPixels(await image.toBuffer());
    expect(readPortCellIndices(pixels, "WEST", "input")).toEqual([2]);
  });

  it("同一边的固体箭头与流体灰色箭头按实际圆点区分", async () => {
    const definition: EntityDefinition = {
      ...purifier,
      id: "blueprint-port-mixed-materials",
      footprint: { width: 7, height: 7 },
      portGroups: [
        {
          ...pipeGroup,
          ports: [{ ...pipeGroup.ports[0]!, localCellX: 1, localCellY: 0, edge: "NORTH" }],
        },
        {
          ...solidGroup,
          ports: [{ ...solidGroup.ports[0]!, localCellX: 4, localCellY: 0, edge: "NORTH" }],
        },
      ],
    };

    const image = await createDeviceBlueprintSprite(definition);
    const pixels = await readPixels(await image.toBuffer());
    expect(readPortCellIndices(pixels, "NORTH", "input")).toEqual([1]);
    expect(readPortCellIndices(pixels, "NORTH", "solid")).toEqual([4]);
  });

  it.each(verifiedDevices)("发布精灵 $id 的端口与注册表一致", async (definition) => {
    const pixels = await readPixels(path.resolve("public/blueprint-view/sprites", `${definition.spriteId}.webp`));
    expect([pixels.info.width, pixels.info.height]).toEqual([
      definition.footprint.width * CELL_SIZE,
      definition.footprint.height * CELL_SIZE,
    ]);

    for (const edge of ["NORTH", "EAST", "SOUTH", "WEST"] as const) {
      for (const direction of ["input", "output"] as const) {
        const expected = definition.portGroups
          .filter((group) => group.isPipe && group.direction === direction)
          .flatMap((group) => group.ports)
          .filter((port) => port.edge === edge)
          .map((port) => edge === "WEST" || edge === "EAST" ? port.localCellY : port.localCellX);
        expect(readPortCellIndices(pixels, edge, direction), `${edge}:${direction}`)
          .toEqual([...new Set(expected)].sort((left, right) => left - right));
      }
      const solidIndices = definition.portGroups
        .filter((group) => !group.isPipe)
        .flatMap((group) => group.ports)
        .filter((port) => port.edge === edge)
        .map((port) => edge === "WEST" || edge === "EAST" ? port.localCellY : port.localCellX);
      expect(readPortCellIndices(pixels, edge, "solid"), `${edge}:solid`)
        .toEqual([...new Set(solidIndices)].sort((left, right) => left - right));
    }
  });

  it("气体提纯机的遮罩逐像素跟随修正后的精灵", async () => {
    const sprite = await readPixels(path.resolve("public/blueprint-view/sprites/liquid_purifier_1_gas.webp"));
    const mask = await readPixels(path.resolve("public/blueprint-view/sprite-masks/liquid_purifier_1_gas.webp"));
    expect([mask.info.width, mask.info.height]).toEqual([sprite.info.width, sprite.info.height]);
    let mismatches = 0;
    for (let offset = 0; offset < sprite.data.length; offset += 4) {
      const alpha = sprite.data[offset + 3]!;
      if (mask.data[offset] !== alpha || mask.data[offset + 1] !== alpha
        || mask.data[offset + 2] !== alpha || mask.data[offset + 3] !== 255) {
        mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });
});

async function readPixels(source: string | Buffer) {
  return sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/** 读取实际像素中的白色输入圆点或黄色输出圆点，不复用生成器的布局算法。 */
/** AI-CORRECTION 2026-10-07: 同时读取固体端口的半透明箭头，覆盖全量通用设备。 */
function readPortCellIndices(pixels: Pixels, edge: GridEdge, direction: "input" | "output" | "solid"): number[] {
  const vertical = edge === "WEST" || edge === "EAST";
  const span = vertical ? pixels.info.height : pixels.info.width;
  const counts = Array<number>(span / CELL_SIZE).fill(0);
  for (let index = 0; index < span; index += 1) {
    for (let depth = direction === "solid" ? 28 : 0; depth < (direction === "solid" ? 55 : 40); depth += 1) {
      const x = edge === "WEST" ? depth : edge === "EAST" ? pixels.info.width - 1 - depth : index;
      const y = edge === "NORTH" ? depth : edge === "SOUTH" ? pixels.info.height - 1 - depth : index;
      const offset = (y * pixels.info.width + x) * 4;
      const red = pixels.data[offset]!;
      const green = pixels.data[offset + 1]!;
      const blue = pixels.data[offset + 2]!;
      const alpha = pixels.data[offset + 3]!;
      const marker = direction === "solid"
        ? alpha >= 120 && alpha <= 135 && red >= 25 && red <= 45
          && green >= 25 && green <= 45 && blue >= 25 && blue <= 45
        : alpha > 200 && (direction === "input"
          ? red > 200 && green > 200 && blue > 200
          : red > 200 && green > 150 && blue < 80);
      if (marker) {
        counts[Math.floor(index / CELL_SIZE)]! += 1;
      }
    }
  }
  // AI-CORRECTION 2026-10-07: 流体端口同样含半透明灰色箭头，不能仅按箭头颜色判定固体。
  // 只根据实际图片的白/黄圆点排除流体格，不读取注册表期望值，保留独立的像素位置断言。
  const fluidCells = direction === "solid"
    ? new Set([
      ...readPortCellIndices(pixels, edge, "input"),
      ...readPortCellIndices(pixels, edge, "output"),
    ])
    : null;
  return counts.flatMap((count, index) => count > (direction === "solid" ? 80 : 20)
    && !fluidCells?.has(index) ? [index] : []);
}
