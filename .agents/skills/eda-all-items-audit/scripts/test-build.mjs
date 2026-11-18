import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { ROOT } from "./common.mjs";
import { evaluateAreaFormula } from "./area-formula.mjs";

/** 同一数值快照送入真实 CPU／GPU；固定节点隔离出 U 型组合约束，验证新字段没有后端漂移。 */
async function verifyDimensionBackend(Cpu, Gpu) {
  const cpu = new Cpu(), gpu = new Gpu(), geometry = new Int32Array(3 * 4 * 80);
  for (let node = 0; node < 3; node++) for (let turn = 0; turn < 4; turn++) {
    const offset = (node * 4 + turn) * 80;
    geometry[offset] = 1; geometry[offset + 1] = 1; geometry[offset + 2] = turn;
    geometry[offset + 3] = 1; geometry[offset + 40] = 1; geometry[offset + 72] = 1;
    geometry[offset + 77] = (1 << 12) + 1;
  }
  const results = [];
  try {
    for (const poses of [[4, 0, 0, 9, 8, 1, 0, 8, 3], [4, 0, 0, 9, 8, 1, 4, 19, 2]]) {
      const input = { chains: 1, parameters: new Int32Array([3, 0, 10, 20, 1, 123, 8000, 3, 0, 0]),
        geometry, edges: new Int32Array(), overlaps: new Int32Array(9), poses: new Int32Array(poses) };
      const expected = await cpu.search(input), actual = await gpu.search(input);
      if (!actual || JSON.stringify(actual.scores) !== JSON.stringify(expected.scores)) throw new Error(`CPU/GPU 尺寸评分不一致：${JSON.stringify({ expected: expected.scores, actual, metrics: gpu.metrics })}`);
      results.push(actual.scores[0]);
    }
    if (results[0] !== 0 || results[1] < 10000) throw new Error(`U 型组合约束没有生效：${results}`);
    return { passed: true, scores: results, evaluations: gpu.metrics.evaluations };
  } finally { gpu.dispose(); }
}

/** 仅测试构建安装；源文件与正常 dev/build 不安装测试接口。 */
export function auditPlugin(manifest) {
  let hostInjected = 0, areaInjected = 0;
  return {
    name: "eda-all-items-test-only", enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/src/main.tsx")) {
        const marker = "appHost = createAppHost(workspace, { sceneFactories, mainView });";
        assert.equal(code.split(marker).length, 2, "工作台装配入口变化，停止测试注入。");
        hostInjected++;
        return { code: 'import { getPlannerPorts as auditGetPlannerPorts } from "@/blueprint-planner/geometry";\n'
          + 'import { PlannerCpuLayout as AuditCpu } from "@/blueprint-planner/cpu-layout";\n'
          + 'import { PlannerGpuLayout as AuditGpu } from "@/blueprint-planner/gpu-layout";\n'
          + code.replace(marker, `${marker}\nwindow.__edaAuditHost = appHost;\nwindow.__edaAuditGetPlannerPorts = auditGetPlannerPorts;\nwindow.__edaAuditCheckDimensions = () => (${verifyDimensionBackend.toString()})(AuditCpu, AuditGpu);`), map: null };
      }
      if (id.endsWith("/src/blueprint-planner/search-policy.ts")) {
        const file = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
        const matches = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "initialPlannerArea");
        assert.equal(matches.length, 1, "正式面积函数入口变化。");
        const name = matches[0].name;
        const renamed = code.slice(0, name.getStart(file)) + "productionInitialPlannerArea" + code.slice(name.end);
        areaInjected++;
        const expression = manifest.formulaTree ? `(${evaluateAreaFormula.toString()})(${JSON.stringify(manifest.formulaTree)}, S)` : "productionInitialPlannerArea(S)";
        return { code: renamed + `\nexport function initialPlannerArea(S: number): number {\nconst area = ${expression};\n(globalThis as any).__edaAuditArea = { S, area };\nreturn area;\n}\n`, map: null };
      }
      if (id.endsWith("/src/blueprint-planner/blueprint-planner-host.ts")) {
        const marker = /^ {14}: task\.file\.progress\.areaHistory \}\);$/gm;
        assert.equal([...code.matchAll(marker)].length, 1, "正式面积验收观察点变化。");
        return { code: code.replace(marker, "$&\n          (globalThis as any).__edaAuditAccepted?.(task.file);"), map: null };
      }
    },
    buildEnd(error) {
      if (!error) { assert.equal(hostInjected, 1, "测试 Host 未接入。"); assert.equal(areaInjected, 1, "测试面积观测未接入。"); }
    },
  };
}

export async function buildFrozen(directory, manifest, sourceRoot = ROOT) {
  const { build } = await import("vite");
  const { default: config } = await import(pathToFileURL(resolve(ROOT, "vite.config.ts")).href);
  await build({ ...config, root: sourceRoot, configFile: false,
    resolve: { ...config.resolve, alias: { ...config.resolve.alias, "@": resolve(sourceRoot, "src") } },
    plugins: [...config.plugins, auditPlugin(manifest)],
    build: { ...config.build, outDir: resolve(directory, "runtime/dist"), emptyOutDir: true,
      rollupOptions: { ...config.build.rollupOptions, input: Object.fromEntries(Object.entries(config.build.rollupOptions.input)
        .map(([name, path]) => [name, resolve(sourceRoot, path.slice(ROOT.length))])) } },
  });
}

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 .agents/skills/eda-all-items-audit/scripts/test-build.mjs 第 31 行：
// /** 真实硬件执行共享端点的正负例；独立 CPU 搜索与正式缓存校验共同判定，不接受 GPU 回退冒充通过。 */
// async function verifyRoutingBackend(Gpu, Grid, Router, registry) {
//   const gpu = new Gpu(), edges = ["NORTH", "EAST", "SOUTH", "WEST"];
//   let checks = 0;
//   try {
//     await gpu.initialize();
//     if (!gpu.device || !gpu.pipeline || gpu.metrics.fallbackReason) throw new Error(`端点校验无法启用硬件 GPU：${gpu.metrics.fallbackReason}`);
//     for (const kind of ["belt", "pipe"]) for (const atTarget of [false, true]) for (const blocked of [false, true]) {
//       const start = { entityId: "start", groupIndex: 0, portIndex: 0, direction: "output", kind,
//         cell: { x: 2, y: 1 }, outside: { x: 2, y: 2 }, edge: "SOUTH" };
//       const end = { ...start, entityId: "end", direction: "input", cell: { x: 5, y: 2 }, outside: { x: 4, y: 2 }, edge: "WEST" };
//       const pin = { ...start, entityId: "pin", cell: { x: 1, y: 2 }, edge: "EAST" };
//       const source = atTarget ? { ...end, direction: "output" } : start;
//       const target = atTarget ? { ...start, direction: "input" } : end;
//       const ports = [source, target, pin], height = blocked ? 3 : 5;
//       const boundary = { minimumX: 0, minimumY: 0, maximumX: 4, maximumY: height - 1, escapeLength: 0 };
//       const cpu = new Router(registry, [], ports, boundary), grid = new Grid(), kindIndex = kind === "pipe" ? 1 : 0;
//       for (const port of ports) grid.reserve(grid.cell(port.outside.x, port.outside.y), kindIndex, edges.indexOf(port.edge));
//       let cpuPassed = true;
//       try { await cpu.connect(source, target, () => {}); }
//       catch (error) { if (!String(error).includes("物流通道受阻")) throw error; cpuPassed = false; }
//       const cells = await gpu.search({ grid, bounds: { x: 0, y: 0, width: 5, height }, start: source.outside,
//         goal: target.outside, startDirection: edges.indexOf(source.edge), finalDirection: (edges.indexOf(target.edge) + 2) % 4, kind: kindIndex });
//       if (cpuPassed !== !blocked || Boolean(cells) !== cpuPassed) throw new Error(`CPU/GPU 共享端点可达性不一致：${JSON.stringify({ kind, atTarget, blocked, cpuPassed, cells })}`);
//       if (cells && !new Router(registry, [], ports, boundary).reuse(source, target, cells)) throw new Error("GPU 共享端点路径未通过正式缓存校验。");
//       checks++;
//     }
//     // 2026-11-16：边界迫使端口转弯时，其他线路必须绕开；端口所属线路仍允许自身转弯。
//     for (const kind of ["belt", "pipe"]) for (const scenario of ["blocked", "detour", "owner"]) {
//       const height = scenario === "detour" ? 2 : 1;
//       const source = { entityId: "turn-start", groupIndex: 0, portIndex: 0, direction: "output", kind,
//         cell: scenario === "owner" ? { x: 0, y: 1 } : { x: -1, y: 0 }, outside: { x: 0, y: 0 },
//         edge: scenario === "owner" ? "NORTH" : "EAST" };
//       const target = { ...source, entityId: "turn-end", direction: "input", cell: { x: 5, y: 0 }, outside: { x: 4, y: 0 }, edge: "WEST" };
//       const pin = { ...source, entityId: "turn-pin", cell: { x: 2, y: 1 }, outside: { x: 2, y: 0 }, edge: "NORTH" };
//       const ports = [source, target];
//       if (scenario !== "owner") ports.push(pin);
//       const boundary = { minimumX: 0, minimumY: 0, maximumX: 4, maximumY: height - 1, escapeLength: 0 };
//       const grid = new Grid(), kindIndex = kind === "pipe" ? 1 : 0;
//       for (const port of ports) grid.reserve(grid.cell(port.outside.x, port.outside.y), kindIndex,
//         edges.indexOf(port.edge), port.edge === "NORTH");
//       let cpuPassed = true;
//       try { await new Router(registry, [], ports, boundary).connect(source, target, () => {}); }
//       catch (error) { if (!String(error).includes("物流通道受阻")) throw error; cpuPassed = false; }
//       const cells = await gpu.search({ grid, bounds: { x: 0, y: 0, width: 5, height }, start: source.outside,
//         goal: target.outside, startDirection: edges.indexOf(source.edge), finalDirection: (edges.indexOf(target.edge) + 2) % 4, kind: kindIndex });
//       if (cpuPassed !== (scenario !== "blocked") || Boolean(cells) !== cpuPassed) {
//         throw new Error(`CPU/GPU 必需转弯预留不一致：${JSON.stringify({ kind, scenario, cpuPassed, cells })}`);
//       }
//       if (cells && !new Router(registry, [], ports, boundary).reuse(source, target, cells)) throw new Error("GPU 必需转弯路径未通过正式缓存校验。");
//       checks++;
//     }
//     if (gpu.metrics.gpuAttempts !== checks || gpu.metrics.fallbackReason) throw new Error("端点校验未完整执行硬件 GPU。");
//     return { passed: true, checks, gpuAttempts: gpu.metrics.gpuAttempts };
//   } finally { gpu.stop("专项端点校验结束"); }
// }
//
// 原文件 .agents/skills/eda-all-items-audit/scripts/test-build.mjs 第 98 行：
//         return { code: 'import { PlannerCpuLayout as AuditCpu } from "@/blueprint-planner/cpu-layout";\n'
//           + 'import { PlannerGpuRouting as AuditGpuRouting } from "@/blueprint-planner/gpu-routing";\n'
//           + 'import { PlannerRoutingGrid as AuditRoutingGrid } from "@/blueprint-planner/routing-grid";\n'
//           + 'import { PlannerRouter as AuditRouter } from "@/blueprint-planner/router";\n'
//           + 'import { getPlannerPorts as auditGetPlannerPorts } from "@/blueprint-planner/geometry";\n'
// 原文件 .agents/skills/eda-all-items-audit/scripts/test-build.mjs 第 104 行：
//           + code.replace(marker, `${marker}\nwindow.__edaAuditHost = appHost;\nwindow.__edaAuditGetPlannerPorts = auditGetPlannerPorts;\nwindow.__edaAuditCheckDimensions = async () => ({ ...await (${verifyDimensionBackend.toString()})(AuditCpu, AuditGpu), routing: await (${verifyRoutingBackend.toString()})(AuditGpuRouting, AuditRoutingGrid, AuditRouter, appHost.workspace.registry) });`), map: null };
