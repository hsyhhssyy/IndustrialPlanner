import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import zhCnUi from "@/shared/i18n/zh-cn/ui";
import enUsUi from "@/shared/i18n/en-us/ui";

const SOURCE_ROOTS = [
  path.resolve(process.cwd(), "src/app"),
  path.resolve(process.cwd(), "src/shared"),
];

const IGNORED_SOURCE_PATH_PARTS = [
  `${path.sep}src${path.sep}shared${path.sep}i18n${path.sep}`,
];

const UI_KEY_PREFIXES = [
  "action.",
  "activeTool.",
  "app.",
  "debugLogDialog.",
  "device.",
  "dialog.",
  "encyclopedia.",
  "encyclopediaPicker.",
  "feedbackDialog.",
  "helpDialog.",
  "inspector.",
  "label.",
  "leftDock.",
  "locale.",
  "mode.",
  "moduleBalancing.",
  "mutability.",
  "productionPlanning.",
  "rightDock.",
  "screen.",
  "section.",
  "settingsAction.",
  "settingsDialog.",
  "settingsField.",
  "settingsGroup.",
  "settingsKeybinding.",
  "settingsOption.",
  "status.",
  "statusBar.",
  "tool.",
  "toolbar.",
  "toolboxDialog.",
  "timelineDialog.",
  "topBar.",
  "uiGroup.",
  "view.",
  "warehouseStats.",
  "workbench.",
];

describe("app i18n", () => {
  it("keeps statically referenced UI keys translated in every UI locale", { timeout: 15_000 }, () => {
    const keys = collectStaticUiI18nKeys(SOURCE_ROOTS);

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(zhCnUi[key], `missing zh-CN translation for ${key}`).toBeDefined();
      expect(zhCnUi[key], `zh-CN translation falls back to key for ${key}`).not.toBe(key);
      expect(enUsUi[key], `missing en-US translation for ${key}`).toBeDefined();
      expect(enUsUi[key], `en-US translation falls back to key for ${key}`).not.toBe(key);
    }
  });
});

function collectStaticUiI18nKeys(rootDirs: readonly string[]): string[] {
  const keys = new Set<string>();

  for (const rootDir of rootDirs) {
    for (const filePath of collectSourceFiles(rootDir)) {
      const source = ts.createSourceFile(
        filePath,
        readFileSync(filePath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      collectStaticUiKeysFromSource(source, keys);
    }
  }

  return [...keys].sort();
}

function collectSourceFiles(rootDir: string): string[] {
  if (!existsSync(rootDir) || shouldIgnoreSourcePath(rootDir)) {
    return [];
  }

  const result: string[] = [];

  for (const entryName of readdirSync(rootDir)) {
    const entryPath = path.join(rootDir, entryName);
    if (shouldIgnoreSourcePath(entryPath)) {
      continue;
    }

    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      result.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (entryName.endsWith(".ts") || entryName.endsWith(".tsx")) {
      result.push(entryPath);
    }
  }

  return result;
}

function shouldIgnoreSourcePath(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  return IGNORED_SOURCE_PATH_PARTS.some((part) => normalized.includes(part));
}

function collectStaticUiKeysFromSource(node: ts.Node, keys: Set<string>): void {
  if (ts.isCallExpression(node)) {
    const calleeName = expressionName(node.expression);
    const firstArgument = node.arguments[0];

    if (
      (calleeName === "t" || calleeName === "_t" || calleeName === "translate")
      && firstArgument !== undefined
      && ts.isStringLiteralLike(firstArgument)
    ) {
      addUiKey(firstArgument.text, keys);
    }
  }

  if (ts.isPropertyAssignment(node)) {
    const propertyName = propertyNameText(node.name);
    const initializer = node.initializer;

    if (
      propertyName !== null
      && propertyName.endsWith("Key")
    ) {
      collectUiStringLiterals(initializer, keys);
    }

    if (
      propertyName !== null
      && propertyName.endsWith("Keys")
      && ts.isArrayLiteralExpression(initializer)
    ) {
      collectUiStringLiterals(initializer, keys);
    }
  }

  if (ts.isVariableDeclaration(node)) {
    const declarationName = bindingNameText(node.name);

    if (
      declarationName !== null
      && /Keys?$/i.test(declarationName)
      && node.initializer !== undefined
    ) {
      collectUiStringLiterals(node.initializer, keys);
    }
  }

  if (ts.isFunctionDeclaration(node)) {
    if (node.name !== undefined && /Key$/i.test(node.name.text) && node.body !== undefined) {
      collectUiStringLiterals(node.body, keys);
    }
  }

  if (ts.isCallExpression(node)) {
    collectKnownGeneratedUiKey(node, keys);
  }

  if (ts.isJsxAttribute(node)) {
    const initializer = node.initializer;

    if (
      ts.isIdentifier(node.name)
      && node.name.text.endsWith("Key")
      && initializer !== undefined
      && ts.isStringLiteral(initializer)
    ) {
      addUiKey(initializer.text, keys);
    }
  }

  ts.forEachChild(node, (child) => collectStaticUiKeysFromSource(child, keys));
}

function collectUiStringLiterals(node: ts.Node, keys: Set<string>): void {
  if (ts.isStringLiteralLike(node)) {
    addUiKey(node.text, keys);
  }

  ts.forEachChild(node, (child) => collectUiStringLiterals(child, keys));
}

function collectKnownGeneratedUiKey(node: ts.CallExpression, keys: Set<string>): void {
  const calleeName = expressionName(node.expression);
  const firstArgument = node.arguments[0];

  if (firstArgument === undefined || !ts.isStringLiteralLike(firstArgument)) {
    return;
  }

  if (calleeName === "shortcutKeybindingLabelKey") {
    addUiKey(`settingsField.${firstArgument.text}`, keys);
  }

  if (calleeName === "shortcutKeybindingDescriptionKey") {
    addUiKey(`settingsField.${firstArgument.text}Description`, keys);
  }
}

function addUiKey(key: string, keys: Set<string>): void {
  if (UI_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    keys.add(key);
  }
}

function expressionName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function bindingNameText(name: ts.BindingName): string | null {
  return ts.isIdentifier(name) ? name.text : null;
}
