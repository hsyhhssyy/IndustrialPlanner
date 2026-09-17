// AI-REMOVED 2026-09-17:
// Reason: 离线常驻训练和测试共用执行器，运行脚本不得反向引用测试实现。
// Trigger: 用户确认 CPU 多核训练及 20% 资源余量。
// Evidence: 原训练逐候选启动 Vitest，复用入口位于 tests。
// Replacement: src/scripts/eda/artifacts.ts
// Risk: 导入入口迁移，须回归真实 Worker 与 Dense。
// Human Review: Required
//
// Original code:
// import { mkdir, writeFile } from "node:fs/promises";
// import { join } from "node:path";
// import type { BlueprintDocument } from "@/domain/document/blueprint-document";
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// import { resolveEntityGridRect } from "@/shared/geometry/power-range";
// import { lookupText } from "@/shared/i18n";
// import { getPlannerPorts } from "@/blueprint-planner/geometry";
// import { edaOutputPath } from "./artifact-paths";
// 
// export async function saveSuccessfulPlanning(registry: RegistryContract, name: string, blueprint: BlueprintDocument, input: unknown, report: unknown): Promise<string> {
//   const path = edaOutputPath("success", `${Date.now()}-${process.pid}-${name.replace(/[^\p{L}\p{N}_.-]+/gu, "-")}`);
//   await mkdir(path, { recursive: true });
//   await Promise.all([
//     writeFile(join(path, "blueprint.json"), JSON.stringify(blueprint, null, 2)),
//     writeFile(join(path, "input.json"), JSON.stringify(input, null, 2)),
//     writeFile(join(path, "report.json"), JSON.stringify(report, null, 2)),
//     writeFile(join(path, "preview.svg"), createLayoutPreview(registry, blueprint)),
//   ]);
//   return path;
// }
// 
// /** 可直接打开的几何预览；端口和朝向来自 Registry，不代替游戏美术。 */
// export function createLayoutPreview(registry: RegistryContract, blueprint: BlueprintDocument): string {
//   const entries = blueprint.entityOrder.map((id) => {
//     const entity = blueprint.entities[id]!;
//     const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
//     return { entity, definition, rect: resolveEntityGridRect({ entity, definition }) };
//   });
//   const left = Math.min(...entries.map(({ rect }) => rect.x)) - 1, top = Math.min(...entries.map(({ rect }) => rect.y)) - 1;
//   const width = Math.max(...entries.map(({ rect }) => rect.x + rect.width)) - left + 1;
//   const height = Math.max(...entries.map(({ rect }) => rect.y + rect.height)) - top + 1;
//   const scale = 18;
//   const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
//   const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale + 44}" viewBox="0 0 ${width * scale} ${height * scale + 44}"><rect width="100%" height="100%" fill="#f8fafc"/><text x="12" y="22" font-family="sans-serif" font-size="14">${escape(blueprint.name)} · 金色传送带 / 蓝色管道</text><g transform="translate(${-left * scale},${36 - top * scale})">`];
//   for (const { entity, definition, rect } of entries) {
//     const ports = ["input", "output"].flatMap((direction) => getPlannerPorts(registry, entity, definition, direction as "input" | "output"));
//     const small = rect.width === 1 && rect.height === 1;
//     const color = small ? (ports.some((port) => port.kind === "pipe") ? "#2196c4" : "#dba13b") : "#c3d2e1";
//     const name = lookupText("zh-CN", definition.nameKey) ?? definition.id;
//     svg.push(`<g><title>${escape(name)} (${entity.position.x}, ${entity.position.y}) ${entity.rotation}°</title><rect x="${rect.x * scale + 1}" y="${rect.y * scale + 1}" width="${rect.width * scale - 2}" height="${rect.height * scale - 2}" rx="1" fill="${color}" stroke="#708090" stroke-width=".4"/>`);
//     if (!small) svg.push(`<text x="${(rect.x + .2) * scale}" y="${(rect.y + .8) * scale}" font-family="sans-serif" font-size="9">${escape(name)}</text>`);
//     for (const port of ports) {
//       const dx = port.outside.x - port.cell.x, dy = port.outside.y - port.cell.y;
//       const x = (port.cell.x + .5) * scale, y = (port.cell.y + .5) * scale;
//       svg.push(`<path d="M ${x} ${y} l ${dx * scale / 2} ${dy * scale / 2}" stroke="${port.direction === "output" ? "#244559" : "#ffffff"}" stroke-width="1.5"/>`);
//     }
//     svg.push("</g>");
//   }
//   return svg.join("") + "</g></svg>";
// }
