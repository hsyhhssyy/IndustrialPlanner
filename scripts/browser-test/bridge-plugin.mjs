import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

/** 仅专用测试服务安装此插件；产品依赖图不引用测试模块。 */
export async function createBrowserTestPlugin() {
  const source = await readFile(resolve("src/tests/e2e/harness/browser-bridge.ts"), "utf8");
  const bridge = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  if (!bridge.includes("export function installE2eBridge")) throw new Error("缺少唯一 E2E 桥接入口");
  const observerId = "\0industrial-planner-e2e-surfaces";
  const observerImport = "virtual:industrial-planner-e2e-surfaces";
  return {
    resolveId(id) { if (id === observerImport) return observerId; },
    load(id) {
      if (id !== observerId) return;
      // WeakMap 不延长已销毁 View 的生命；只保留真实对象身份，不构造替代渲染器。
      return `const surfaces = new WeakMap();
        export function recordSurface(context) { surfaces.set(context.app.canvas, context); return context; }
        export function readSurface(canvas) { return surfaces.get(canvas); }`;
    },
    name: "industrial-planner-e2e-only",
    enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/src/renderer/renderer-host.tsx")) {
        const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const calls = [];
        const visit = node => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
            && node.expression.text === "createRenderSceneOrchestrator") calls.push(node);
          ts.forEachChild(node, visit);
        };
        visit(ast);
        if (calls.length !== 1 || !calls[0].arguments[0]) throw new Error("渲染 View 装配入口变化，停止注入测试观测");
        const context = calls[0].arguments[0];
        return { code: `import { recordSurface as e2eRecordSurface } from "${observerImport}";\n`
          + code.slice(0, context.getStart(ast)) + `e2eRecordSurface(${context.getText(ast)})`
          + code.slice(context.end), map: null };
      }
      if (!id.endsWith("/src/main.tsx")) return;
      const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const entries = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "startWorkbench");
      if (entries.length !== 1 || !entries[0].body) throw new Error("工作台装配入口变化，停止注入测试接口");
      const position = entries[0].body.end - 1;
      const injected = bridge.replace("export function installE2eBridge", "function installE2eBridge");
      return { code: `import { readSurface as e2eReadSurface } from "${observerImport}";\n`
        + 'import { normalizeBlueprintDocument as e2eNormalizeBlueprint } from "@/shared/blueprints/blueprint-document-codec";\n'
        + 'import { ensureProtocolCoreEntity as e2eEnsureCore } from "@/editor/ensure-protocol-core";\n'
        + code.slice(0, position) + `\n${injected}\ninstallE2eBridge(appHost, e2eNormalizeBlueprint, e2eEnsureCore, e2eReadSurface);\n` + code.slice(position), map: null };
    },
  };
}
