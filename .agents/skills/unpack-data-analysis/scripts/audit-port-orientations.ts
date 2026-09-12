import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ENTITY_DEFINITIONS } from "../../../../src/registry/entity-definition";

// @ts-expect-error 项目级只读脚本复用同技能目录下的 mjs 数据源实现，无需单独维护声明文件。
import { describeUnpackTableSource, openUnpackTableSource } from "./unpack-table-source.mjs";
// @ts-expect-error 项目级只读脚本复用同技能目录下的 mjs 别名事实表，无需单独维护声明文件。
import { resolveRawBuildingAlias } from "./device-building-aliases.mjs";

type OrthogonalRotation = 0 | 90 | 180 | 270;
type PortDirection = "input" | "output" | "bidirectional";
type PortEdge = "NORTH" | "EAST" | "SOUTH" | "WEST";

interface ExportedPort {
  readonly isPipe: boolean;
  readonly edge?: PortEdge;
  readonly trans: {
    readonly position: {
      readonly x: number;
      readonly z: number;
    };
  };
}

interface ExportedBuilding {
  readonly range: {
    readonly width: number;
    readonly depth: number;
  };
  readonly inputPorts?: readonly ExportedPort[];
  readonly outputPorts?: readonly ExportedPort[];
  readonly matchPortEdges?: boolean;
}

interface ValvePort {
  readonly position: {
    readonly x: number;
    readonly z: number;
  };
  readonly rotation: {
    readonly y: number;
  };
}

interface ValveBuilding {
  readonly range: {
    readonly x: number;
    readonly z: number;
  };
  readonly inputPorts?: readonly ValvePort[];
  readonly outputPorts?: readonly ValvePort[];
}

interface ExportRoot {
  readonly buildings: {
    readonly buildingTable: Readonly<Record<string, ExportedBuilding>>;
  };
}

interface LogicalPort {
  readonly direction: PortDirection;
  readonly isPipe: boolean;
  readonly x: number;
  readonly y: number;
  readonly edge?: PortEdge;
}

interface AuditRecord {
  readonly registryId: string;
  readonly buildingId: string;
  readonly status: "changed" | "unchanged" | "symmetric" | "unresolved";
  readonly exportToRegistryRotations: readonly OrthogonalRotation[];
  readonly registryCorrectionRotation: OrthogonalRotation | null;
  readonly documentMigrationRotation: OrthogonalRotation | null;
}

// AI-CORRECTION 2026-09-12: Vitest 通过 Vite 加载脚本时 import.meta.url 不是 file URL；非 CLI 上下文回退到当前项目目录，避免模块导入阶段失败。
// AI-CORRECTION 2026-09-12: 上述协议判断仍会被 Vite 的 import.meta.url 转换误导；路径解析改为仅在 CLI 参数处理时惰性执行。
const PROJECT_ROOT = (): string => fileURLToPath(new URL("../../../../", import.meta.url));
const DEFAULT_EXPORT_PATH = (): string => resolve(PROJECT_ROOT(), ".temp/json-export.json");
const ROTATIONS: readonly OrthogonalRotation[] = [0, 90, 180, 270];
const PORT_EDGES: readonly PortEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];
const OUTPUT_EDGE_BY_TABLE_YAW: Readonly<Record<OrthogonalRotation, PortEdge>> = {
  0: "NORTH",
  90: "EAST",
  180: "SOUTH",
  270: "WEST",
};

// AI-REMOVED 2026-08-31:
// Reason: 设备记录对账与端口审计必须共享同一份项目 ID → raw building ID 历史别名，避免两套事实漂移。
// Trigger: 用户要求修正 raw 单 building 到项目多变体的技能和脚本实现。
// Evidence: filling_pd_mc_1 需要在两个对账脚本中一致映射到 filling_powder_mc_1。
// Replacement: ./device-building-aliases.mjs#RAW_BUILDING_ID_BY_PROJECT_ID
// Risk: Low
// Human Review: Required
//
// Original code:
// const BUILDING_ID_BY_REGISTRY_ID: Readonly<Record<string, string>> = {
//   cmpt_mc_1: "component_mc_1",
//   filling_pd_mc_1: "filling_powder_mc_1",
//   liquid_filling_pd_mc_1: "filling_powder_mc_1",
//   power_sta_1: "power_station_1",
//   seedcol_1: "seedcollector_1",
//   tools_asm_mc_1: "tools_assebling_mc_1",
//   water_pump_1: "pump_1",
// };

function parseArguments(argv: readonly string[]): {
  readonly exportPath: string;
  readonly showAll: boolean;
  readonly json: boolean;
} {
  const projectRoot = PROJECT_ROOT();
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const unknownOptions = argv.filter(
    (argument) => argument.startsWith("--") && argument !== "--all" && argument !== "--json",
  );
  if (unknownOptions.length > 0 || positional.length > 1) {
    throw new Error(
      "用法: audit-port-orientations.ts <raw-table 来源目录 | legacy json-export 文件> [--all] [--json]",
    );
  }
  const exportPath = positional[0];
  if (exportPath === undefined) {
    throw new Error(
      `必须显式指定解包来源；legacy 示例：${DEFAULT_EXPORT_PATH()}`,
    );
  }
  return {
    exportPath: resolve(projectRoot, exportPath),
    showAll: argv.includes("--all"),
    json: argv.includes("--json"),
  };
}

function resolveBuildingId(
  definition: (typeof ENTITY_DEFINITIONS)[number],
  buildingTable: ExportRoot["buildings"]["buildingTable"],
): string | null {
  const alterTag = definition.tags.find((tag) => tag.startsWith("alter:"));
  const taggedId = alterTag?.slice("alter:".length);
  const candidateId = taggedId ?? definition.id;
  const buildingId = resolveRawBuildingAlias(candidateId);
  return buildingTable[buildingId] === undefined ? null : buildingId;
}

function normalizeExportedPorts(building: ExportedBuilding): readonly LogicalPort[] {
  // AI-CORRECTION 2026-09-11: raw5x5 transmuter_1 游戏实测证明项目坐标为 X=x、Y=depth-1-z；旧镜像映射会把所有非对称布局旋转 180°。
  const normalize = (
    port: ExportedPort,
    direction: Exclude<PortDirection, "bidirectional">,
  ): LogicalPort => ({
    direction,
    isPipe: port.isPipe,
    x: port.trans.position.x,
    y: building.range.depth - 1 - port.trans.position.z,
    edge: port.edge,
  });
  return [
    ...(building.inputPorts ?? []).map((port) => normalize(port, "input")),
    ...(building.outputPorts ?? []).map((port) => normalize(port, "output")),
  ];
}

function oppositeEdge(edge: PortEdge): PortEdge {
  switch (edge) {
    case "NORTH": return "SOUTH";
    case "EAST": return "WEST";
    case "SOUTH": return "NORTH";
    case "WEST": return "EAST";
  }
}

function resolveValvePortEdge(
  tableYaw: number,
  direction: Exclude<PortDirection, "bidirectional">,
): PortEdge {
  if (!ROTATIONS.includes(tableYaw as OrthogonalRotation)) {
    throw new Error(`物流阀门端口 rotation.y 必须是正交角，收到：${String(tableYaw)}`);
  }
  const outputEdge = OUTPUT_EDGE_BY_TABLE_YAW[tableYaw as OrthogonalRotation];
  return direction === "output" ? outputEdge : oppositeEdge(outputEdge);
}

function normalizeValveBuilding(
  building: ValveBuilding,
  isPipe: boolean,
): ExportedBuilding {
  const normalize = (
    port: ValvePort,
    direction: Exclude<PortDirection, "bidirectional">,
  ): ExportedPort => ({
    isPipe,
    edge: resolveValvePortEdge(port.rotation.y, direction),
    trans: { position: port.position },
  });
  return {
    range: {
      width: building.range.x,
      depth: building.range.z,
    },
    inputPorts: (building.inputPorts ?? []).map((port) => normalize(port, "input")),
    outputPorts: (building.outputPorts ?? []).map((port) => normalize(port, "output")),
    matchPortEdges: true,
  };
}

function normalizeValveTable(
  table: Readonly<Record<string, ValveBuilding>>,
  isPipe: boolean,
): Readonly<Record<string, ExportedBuilding>> {
  return Object.fromEntries(
    Object.entries(table).map(([buildingId, building]) => [
      buildingId,
      normalizeValveBuilding(building, isPipe),
    ]),
  );
}

export function buildPortAuditInput(source: {
  readonly authority: string;
  readTable(tableName: string): unknown;
}): ExportRoot {
  const buildingTable = source.readTable("FactoryBuildingTable") as ExportRoot["buildings"]["buildingTable"];
  if (source.authority !== "raw-table") {
    return { buildings: { buildingTable } };
  }
  const boxValveTable = source.readTable("FactoryBoxValveTable") as Readonly<Record<string, ValveBuilding>>;
  const fluidValveTable = source.readTable("FactoryFluidValveTable") as Readonly<Record<string, ValveBuilding>>;
  return {
    buildings: {
      buildingTable: {
        ...buildingTable,
        ...normalizeValveTable(boxValveTable, false),
        ...normalizeValveTable(fluidValveTable, true),
      },
    },
  };
}

function rotatePortEdge(edge: PortEdge, rotation: OrthogonalRotation): PortEdge {
  const rotatedEdge = PORT_EDGES[
    (PORT_EDGES.indexOf(edge) + rotation / 90) % PORT_EDGES.length
  ];
  if (rotatedEdge === undefined) {
    throw new Error(`无法旋转端口面：${edge} + ${String(rotation)}°`);
  }
  return rotatedEdge;
}

function rotatePort(
  port: LogicalPort,
  width: number,
  height: number,
  rotation: OrthogonalRotation,
): LogicalPort {
  switch (rotation) {
    case 0:
      return port;
    case 90:
      return {
        ...port,
        x: height - 1 - port.y,
        y: port.x,
        edge: port.edge === undefined ? undefined : rotatePortEdge(port.edge, rotation),
      };
    case 180:
      return {
        ...port,
        x: width - 1 - port.x,
        y: height - 1 - port.y,
        edge: port.edge === undefined ? undefined : rotatePortEdge(port.edge, rotation),
      };
    case 270:
      return {
        ...port,
        x: port.y,
        y: width - 1 - port.x,
        edge: port.edge === undefined ? undefined : rotatePortEdge(port.edge, rotation),
      };
  }
}

function rotatedSize(
  width: number,
  height: number,
  rotation: OrthogonalRotation,
): { readonly width: number; readonly height: number } {
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

function inverseRotation(rotation: OrthogonalRotation): OrthogonalRotation {
  return ((360 - rotation) % 360) as OrthogonalRotation;
}

function portKey(port: LogicalPort, matchPortEdges: boolean): string {
  return [
    port.direction,
    port.isPipe ? "pipe" : "belt",
    port.x,
    port.y,
    ...(matchPortEdges ? [port.edge ?? "missing-edge"] : []),
  ].join(":");
}

function countPorts(
  ports: readonly LogicalPort[],
  matchPortEdges: boolean,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const port of ports) {
    const key = portKey(port, matchPortEdges);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isSubset(
  subset: ReadonlyMap<string, number>,
  superset: ReadonlyMap<string, number>,
): boolean {
  for (const [key, count] of subset) {
    if ((superset.get(key) ?? 0) < count) {
      return false;
    }
  }
  return true;
}

function registryPorts(
  definition: (typeof ENTITY_DEFINITIONS)[number],
): readonly LogicalPort[] {
  return definition.portGroups.flatMap((group) =>
    group.ports.map((port) => ({
      direction: group.direction,
      isPipe: group.isPipe,
      x: port.localCellX,
      y: port.localCellY,
      edge: port.edge,
    })),
  );
}

export function auditPortOrientations(exportRoot: ExportRoot): {
  readonly records: readonly AuditRecord[];
  readonly unmappedRegistryDefinitions: number;
  readonly unmappedRegistryDefinitionIds: readonly string[];
  readonly mappedDefinitionsWithoutPorts: number;
  readonly mappedDefinitionsWithoutPortsIds: readonly string[];
} {
  const records: AuditRecord[] = [];
  const unmappedRegistryDefinitionIds: string[] = [];
  const mappedDefinitionsWithoutPortsIds: string[] = [];
  let unmappedRegistryDefinitions = 0;
  let mappedDefinitionsWithoutPorts = 0;

  for (const definition of ENTITY_DEFINITIONS) {
    const buildingId = resolveBuildingId(definition, exportRoot.buildings.buildingTable);
    if (buildingId === null) {
      unmappedRegistryDefinitions += 1;
      unmappedRegistryDefinitionIds.push(definition.id);
      continue;
    }

    const building = exportRoot.buildings.buildingTable[buildingId];
    if (building === undefined) {
      unmappedRegistryDefinitions += 1;
      unmappedRegistryDefinitionIds.push(definition.id);
      continue;
    }
    const currentPorts = registryPorts(definition);
    const exportedPorts = normalizeExportedPorts(building);
    if (currentPorts.length === 0 || exportedPorts.length === 0) {
      mappedDefinitionsWithoutPorts += 1;
      mappedDefinitionsWithoutPortsIds.push(definition.id);
      continue;
    }

    const matchPortEdges = building.matchPortEdges ?? false;
    const currentCounts = countPorts(currentPorts, matchPortEdges);
    const exportToRegistryRotations = ROTATIONS.filter((rotation) => {
      const size = rotatedSize(building.range.width, building.range.depth, rotation);
      if (
        size.width !== definition.footprint.width
        || size.height !== definition.footprint.height
      ) {
        return false;
      }
      const rotatedPorts = exportedPorts.map((port) =>
        rotatePort(port, building.range.width, building.range.depth, rotation),
      );
      return isSubset(currentCounts, countPorts(rotatedPorts, matchPortEdges));
    });

    const status: AuditRecord["status"] = exportToRegistryRotations.length === 0
      ? "unresolved"
      : exportToRegistryRotations.length > 1
        ? "symmetric"
        : exportToRegistryRotations[0] === 0
          ? "unchanged"
          : "changed";
    const uniqueRotation = exportToRegistryRotations.length === 1
      ? (exportToRegistryRotations[0] ?? null)
      : null;
    records.push({
      registryId: definition.id,
      buildingId,
      status,
      exportToRegistryRotations,
      registryCorrectionRotation: uniqueRotation === null
        ? null
        : inverseRotation(uniqueRotation),
      documentMigrationRotation: uniqueRotation,
    });
  }

  return {
    records,
    unmappedRegistryDefinitions,
    unmappedRegistryDefinitionIds,
    mappedDefinitionsWithoutPorts,
    mappedDefinitionsWithoutPortsIds,
  };
}

function printMarkdown(
  result: ReturnType<typeof auditPortOrientations>,
  sourceDescription: string,
  showAll: boolean,
): void {
  const counts = new Map<AuditRecord["status"], number>([
    ["changed", 0],
    ["unchanged", 0],
    ["symmetric", 0],
    ["unresolved", 0],
  ]);
  for (const record of result.records) {
    counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
  }

  console.log("# 端口朝向审计\n");
  console.log(`- 解包来源：${sourceDescription}`);
  console.log(`- 已映射且双方有端口：${result.records.length}`);
  console.log(`- 需要旋转：${counts.get("changed")}`);
  console.log(`- 已一致：${counts.get("unchanged")}`);
  console.log(`- 旋转对称：${counts.get("symmetric")}`);
  console.log(`- 无法匹配：${counts.get("unresolved")}`);
  console.log(`- 未映射 registry 定义：${result.unmappedRegistryDefinitions}`);
  console.log(`- 映射后任一侧无端口：${result.mappedDefinitionsWithoutPorts}\n`);

  const visibleRecords = showAll
    ? result.records
    : result.records.filter((record) => record.status !== "unchanged");
  console.log("| registry ID | building ID | 结果 | 解包→当前 | registry 修正 | 文档迁移 |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  if (visibleRecords.length === 0) {
    console.log("| （无） | — | — | — | — | — |");
    return;
  }
  for (const record of visibleRecords) {
    console.log(
      `| ${record.registryId} | ${record.buildingId} | ${record.status} | ${record.exportToRegistryRotations.join(", ") || "—"} | ${record.registryCorrectionRotation ?? "—"} | ${record.documentMigrationRotation ?? "—"} |`,
    );
  }
}

export function runPortAuditCli(argv: readonly string[]): void {
  const options = parseArguments(argv);
  const source = openUnpackTableSource(
    options.exportPath,
    (filePath: string) => readFileSync(filePath, "utf8"),
  );
  const exportRoot = buildPortAuditInput(source);
  const result = auditPortOrientations(exportRoot);

  if (options.json) {
    console.log(JSON.stringify({
      source: {
        kind: source.kind,
        authority: source.authority,
        sourceVersion: source.sourceVersion,
        path: source.sourcePath,
      },
      ...result,
    }, null, 2));
  } else {
    printMarkdown(result, describeUnpackTableSource(source), options.showAll);
  }
}

if (
  process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runPortAuditCli(process.argv.slice(2));
}
