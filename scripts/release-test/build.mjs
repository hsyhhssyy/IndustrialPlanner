import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { build } from "vite";

const [label, output] = process.argv.slice(2);
if (!["A", "B", "C"].includes(label) || !output) throw Error("Expected A/B/C and output directory");
const domainPath = "src/domain/document/blueprint-document.ts";
const migrationPath = "src/shared/blueprint-device-id-migration.ts";
function parse(source) { return ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function declaration(source, name) {
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parse(source));
  if (matches.length !== 1 || !matches[0].initializer) throw Error(`Expected exactly one initialized ${name}`);
  return matches[0].initializer;
}
const baseline = await readFile(domainPath, "utf8");
const schemaNode = declaration(baseline, "BLUEPRINT_SCHEMA_VERSION");
if (!ts.isNumericLiteral(schemaNode)) throw Error("Schema must be a numeric literal");
const schema = Number(schemaNode.text);
const target = schema + (label === "A" ? 0 : 1);
const outDir = resolve(output);
await mkdir(outDir, { recursive: true });
const bridgeSource = await readFile("src/tests/release/browser-bridge.ts", "utf8");
const bridge = ts.transpileModule(bridgeSource, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
if (!bridge.includes("export function installReleaseBridge")) throw Error("Invalid release bridge");
const fixture = JSON.parse(await readFile("src/tests/fixtures/blueprints/release/abac.schema6.json", "utf8"));
const belt = fixture.entities.belt.definitionId;
const transformed = [];
const plugin = () => ({
  name: "release-test-fixtures",
  enforce: "pre",
  transform(source, id) {
    const changes = [];
    function replace(node, text) { changes.push({ start: node.getStart(), end: node.end, text }); }
    if (id.endsWith(`/${domainPath}`) || id.endsWith(`/${migrationPath}`)) {
      const name = id.endsWith(`/${domainPath}`) ? "BLUEPRINT_SCHEMA_VERSION" : "BLUEPRINT_DEVICE_ID_SCHEMA_VERSION";
      const node = declaration(source, name);
      if (name === "BLUEPRINT_SCHEMA_VERSION") {
        if (!ts.isNumericLiteral(node) || Number(node.text) !== schema) throw Error(`Schema mismatch: ${name}`);
        replace(node, String(target));
      } else if (!ts.isIdentifier(node) || node.text !== "BLUEPRINT_SCHEMA_VERSION") {
        throw Error("Migration target must reference the single document schema");
      }
      if (label !== "A" && name === "BLUEPRINT_DEVICE_ID_SCHEMA_VERSION") {
        let array = declaration(source, "BLUEPRINT_DEVICE_ID_MIGRATION_SPECS");
        while (ts.isSatisfiesExpression(array) || ts.isAsExpression(array)) array = array.expression;
        if (!ts.isArrayLiteralExpression(array)) throw Error("Migration specifications must be an array");
        const rules = label === "B" ? [{ fromDeviceId: belt, toDeviceId: belt, rotationOffset: 180 }] : [];
        const text = JSON.stringify({ fromVersion: schema, toVersion: target, deviceRules: rules });
        changes.push({ start: array.end - 1, end: array.end - 1, text: `${array.elements.hasTrailingComma || !array.elements.length ? "" : ","}${text},` });
      }
    }
    if (id.endsWith("/src/main.tsx")) {
      const functions = parse(source).statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "startWorkbench");
      if (functions.length !== 1 || !functions[0].body) throw Error("Missing unique workbench composition root");
      const position = functions[0].body.end - 1;
      changes.push({ start: position, end: position, text: `\n${bridge.replace("export function installReleaseBridge", "function installReleaseBridge")}\ninstallReleaseBridge(appHost, releaseStorage, releaseAction, ${JSON.stringify(label)}, BLUEPRINT_SCHEMA_VERSION);\n` });
      changes.push({ start: 0, end: 0, text: 'import * as releaseStorage from "@/shared/storage";\nimport { runInAction as releaseAction } from "mobx";\n' });
    }
    // A 不新增迁移步骤，但仍记录并输出已经核对唯一版本引用的迁移模块。
    if (!changes.length && !id.endsWith(`/${migrationPath}`)) return;
    transformed.push(id);
    let code = source;
    for (const change of changes.sort((a, b) => b.start - a.start)) code = code.slice(0, change.start) + change.text + code.slice(change.end);
    return { code, map: null };
  },
});
process.env.VITE_APP_VERSION = `release-test-${label}`;
process.env.VITE_BACKEND_API_BASE_URL = "/__disabled_backend";
await build({ configFile: resolve("vite.config.ts"), build: { outDir, emptyOutDir: true }, plugins: [plugin()], worker: { plugins: () => [plugin()] } });
for (const suffix of [domainPath, migrationPath, "src/main.tsx"]) {
  if (!transformed.some(id => id.endsWith(`/${suffix}`))) throw Error(`Build did not transform ${suffix}`);
}
await writeFile(resolve(outDir, "release-build.json"), JSON.stringify({ label, schema: target, baselineSchema: schema, transformed }, null, 2));
// Vite 的插件可能保留后台句柄；产物及清单写完后结束本次专用构建子进程。
process.exit(0);
