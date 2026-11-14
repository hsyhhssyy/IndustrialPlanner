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
        return { code: 'import { PlannerCpuLayout as AuditCpu } from "@/blueprint-planner/cpu-layout";\n'
          + 'import { PlannerGpuLayout as AuditGpu } from "@/blueprint-planner/gpu-layout";\n'
          + code.replace(marker, `${marker}\nwindow.__edaAuditHost = appHost;\nwindow.__edaAuditCheckDimensions = () => (${verifyDimensionBackend.toString()})(AuditCpu, AuditGpu);`), map: null };
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
