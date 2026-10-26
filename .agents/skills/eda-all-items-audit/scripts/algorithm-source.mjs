import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { ROOT, WORK, hash } from "./common.mjs";

const exec = promisify(execFile);

/** 只读取活动声明，归档注释中的版本字符串不参与识别。 */
export function readAlgorithmVersion(source) {
  const file = ts.createSourceFile("search-policy.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = file.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .filter(node => ts.isIdentifier(node.name) && node.name.text === "PLANNER_ALGORITHM_VERSION");
  assert.equal(declarations.length, 1, "历史算法版本声明不唯一。");
  assert(declarations[0].initializer && ts.isStringLiteral(declarations[0].initializer), "历史算法版本不是字符串常量。");
  return declarations[0].initializer.text;
}

/** Extend + Compose：只读 Git 对象，完整提取算法模块；其余装配和 Registry 复用当前快照。 */
export async function stageAlgorithmSource(reference) {
  assert.match(reference, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "算法版本引用无效。");
  const { stdout } = await exec("git", ["rev-parse", "--verify", `${reference}^{commit}`], { cwd: ROOT });
  const commit = stdout.trim();
  assert.match(commit, /^[0-9a-f]{40}$/);
  await mkdir(WORK, { recursive: true });
  const root = await mkdtemp(resolve(WORK, "algorithm-source-"));
  const dispose = () => rm(root, { recursive: true, force: true });
  try {
    const excluded = new Set(["blueprint-planner", "tests", "scripts"].map(name => resolve(ROOT, "src", name)));
    await cp(resolve(ROOT, "src"), resolve(root, "src"), { recursive: true, filter: source => !excluded.has(source) });
    for (const path of ["index.html", "package.json", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "auth", "oauth"]) {
      await cp(resolve(ROOT, path), resolve(root, path), { recursive: true });
    }
    await symlink(resolve(ROOT, "node_modules"), resolve(root, "node_modules"), "dir");
    await symlink(resolve(ROOT, "public"), resolve(root, "public"), "dir");
    const archive = resolve(root, "algorithm.tar");
    await exec("git", ["archive", "--format=tar", `--output=${archive}`, commit, "src/blueprint-planner"], { cwd: ROOT });
    await exec("tar", ["-xf", archive, "-C", root]);
    await rm(archive);
    const collect = async () => {
      const files = {};
      const visit = async directory => {
        for (const entry of (await readdir(resolve(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          const path = `${directory}/${entry.name}`;
          if (entry.isDirectory()) await visit(path);
          else { assert(entry.isFile(), "历史算法包含非普通文件。"); files[path] = hash(await readFile(resolve(root, path))); }
        }
      };
      await visit("src/blueprint-planner");
      return files;
    };
    const files = await collect();
    const algorithmVersion = readAlgorithmVersion(await readFile(resolve(root, "src/blueprint-planner/search-policy.ts"), "utf8"));
    return { root, metadata: { reference, commit, algorithmVersion, moduleHash: hash(JSON.stringify(files)), files },
      verify: async () => assert.deepEqual(await collect(), files, "历史算法源码在构建期间发生变化。"), dispose };
  } catch (error) { await dispose(); throw error; }
}
