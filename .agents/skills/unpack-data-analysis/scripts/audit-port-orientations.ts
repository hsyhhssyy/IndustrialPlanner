import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ENTITY_DEFINITIONS } from "../../../../src/registry/entity-definition";

// @ts-expect-error 项目级只读脚本复用同技能目录下的 mjs 数据源实现，无需单独维护声明文件。
import {
  describeUnpackTableSource,
  openUnpackTableSource,
} from "./unpack-table-source.mjs";

type OrthogonalRotation = 0 | 90 | 180 | 270;
type PortDirection = "input" | "output" | "bidirectional";

interface ExportedPort {
  readonly isPipe: boolean;
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
}

interface AuditRecord {
  readonly registryId: string;
  readonly buildingId: string;
  readonly status: "changed" | "unchanged" | "symmetric" | "unresolved";
  readonly exportToRegistryRotations: readonly OrthogonalRotation[];
  readonly registryCorrectionRotation: OrthogonalRotation | null;
  readonly documentMigrationRotation: OrthogonalRotation | null;
}

const PROJECT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DEFAULT_EXPORT_PATH = resolve(PROJECT_ROOT, ".temp/json-export.json");
const ROTATIONS: readonly OrthogonalRotation[] = [0, 90, 180, 270];

const BUILDING_ID_BY_REGISTRY_ID: Readonly<Record<string, string>> = {
  cmpt_mc_1: "component_mc_1",
  filling_pd_mc_1: "filling_powder_mc_1",
  liquid_filling_pd_mc_1: "filling_powder_mc_1",
  power_sta_1: "power_station_1",
  seedcol_1: "seedcollector_1",
  tools_asm_mc_1: "tools_assebling_mc_1",
  water_pump_1: "pump_1",
};

function parseArguments(argv: readonly string[]): {
  readonly exportPath: string;
  readonly showAll: boolean;
  readonly json: boolean;
} {
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const unknownOptions = argv.filter(
    (argument) => argument.startsWith("--") && argument !== "--all" && argument !== "--json",
  );
  if (unknownOptions.length > 0 || positional.length > 1) {
    throw new Error(
      "用法: audit-port-orientations.ts <raw-table 来源目录 | legacy json-export 文件> [--all] [--json]",
    );
  }
  if (positional.length === 0) {
    throw new Error(
      `必须显式指定解包来源；legacy 示例：${DEFAULT_EXPORT_PATH}`,
    );
  }
  return {
    exportPath: resolve(PROJECT_ROOT, positional[0]),
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
  const buildingId = BUILDING_ID_BY_REGISTRY_ID[candidateId] ?? candidateId;
  return buildingTable[buildingId] === undefined ? null : buildingId;
}

function normalizeExportedPorts(building: ExportedBuilding): readonly LogicalPort[] {
  const normalize = (
    port: ExportedPort,
    direction: Exclude<PortDirection, "bidirectional">,
  ): LogicalPort => ({
    direction,
    isPipe: port.isPipe,
    x: building.range.width - 1 - port.trans.position.x,
    y: port.trans.position.z,
  });
  return [
    ...(building.inputPorts ?? []).map((port) => normalize(port, "input")),
    ...(building.outputPorts ?? []).map((port) => normalize(port, "output")),
  ];
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
      return { ...port, x: height - 1 - port.y, y: port.x };
    case 180:
      return { ...port, x: width - 1 - port.x, y: height - 1 - port.y };
    case 270:
      return { ...port, x: port.y, y: width - 1 - port.x };
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

function portKey(port: LogicalPort): string {
  return [port.direction, port.isPipe ? "pipe" : "belt", port.x, port.y].join(":");
}

function countPorts(ports: readonly LogicalPort[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const port of ports) {
    const key = portKey(port);
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
    })),
  );
}

function audit(exportRoot: ExportRoot): {
  readonly records: readonly AuditRecord[];
  readonly unmappedRegistryDefinitions: number;
  readonly mappedDefinitionsWithoutPorts: number;
} {
  const records: AuditRecord[] = [];
  let unmappedRegistryDefinitions = 0;
  let mappedDefinitionsWithoutPorts = 0;

  for (const definition of ENTITY_DEFINITIONS) {
    const buildingId = resolveBuildingId(definition, exportRoot.buildings.buildingTable);
    if (buildingId === null) {
      unmappedRegistryDefinitions += 1;
      continue;
    }

    const building = exportRoot.buildings.buildingTable[buildingId];
    const currentPorts = registryPorts(definition);
    const exportedPorts = normalizeExportedPorts(building);
    if (currentPorts.length === 0 || exportedPorts.length === 0) {
      mappedDefinitionsWithoutPorts += 1;
      continue;
    }

    const currentCounts = countPorts(currentPorts);
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
      return isSubset(currentCounts, countPorts(rotatedPorts));
    });

    const status: AuditRecord["status"] = exportToRegistryRotations.length === 0
      ? "unresolved"
      : exportToRegistryRotations.length > 1
        ? "symmetric"
        : exportToRegistryRotations[0] === 0
          ? "unchanged"
          : "changed";
    const uniqueRotation = exportToRegistryRotations.length === 1
      ? exportToRegistryRotations[0]
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

  return { records, unmappedRegistryDefinitions, mappedDefinitionsWithoutPorts };
}

function printMarkdown(
  result: ReturnType<typeof audit>,
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

const options = parseArguments(process.argv.slice(2));
const source = openUnpackTableSource(
  options.exportPath,
  (filePath: string) => readFileSync(filePath, "utf8"),
);
const exportRoot: ExportRoot = {
  buildings: {
    buildingTable: source.readTable("FactoryBuildingTable") as ExportRoot["buildings"]["buildingTable"],
  },
};
const result = audit(exportRoot);

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
