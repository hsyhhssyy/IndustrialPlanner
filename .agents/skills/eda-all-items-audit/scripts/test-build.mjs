import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { ROOT } from "./common.mjs";
import { evaluateAreaFormula } from "./area-formula.mjs";

/** 仅测试构建安装；源文件与正常 dev/build 不安装测试接口。 */
export function auditPlugin(manifest) {
  let hostInjected = 0, areaInjected = 0;
  return {
    name: "eda-all-items-test-only", enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/src/main.tsx")) {
        const marker = "const appHost = createAppHost(workspace);";
        assert.equal(code.split(marker).length, 2, "工作台装配入口变化，停止测试注入。");
        hostInjected++;
        return { code: code.replace(marker, `${marker}\nwindow.__edaAuditHost = appHost;`), map: null };
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
