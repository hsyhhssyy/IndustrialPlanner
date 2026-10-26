import ts from "typescript";

/** 只解析数学表达式，不执行用户传入的 JavaScript。复用项目已声明的 TypeScript parser。 */
export function parseAreaFormula(source) {
  if (typeof source !== "string" || !source.trim() || source.length > 2048) throw new Error("面积公式必须是 1～2048 字符的表达式。");
  const normalized = source.replace(/(\d|\))\s*S\b/g, "$1*S");
  const file = ts.createSourceFile("area.ts", `const area = (${normalized});`, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length || file.statements.length !== 1) throw new Error("面积公式语法无效。");
  const statement = file.statements[0];
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) throw new Error("只允许单个面积表达式。");
  let nodes = 0;
  const operators = new Set(["+", "-", "*", "/", "%", "**", "<", "<=", ">", ">=", "===", "!=="]);
  const functions = new Set(["min", "max", "ceil", "floor", "round", "abs", "sqrt", "pow", "log", "exp"]);
  const parse = node => {
    if (++nodes > 256) throw new Error("面积公式过于复杂。");
    if (ts.isParenthesizedExpression(node)) return parse(node.expression);
    if (ts.isNumericLiteral(node)) return { number: Number(node.text) };
    if (ts.isIdentifier(node) && node.text === "S") return { variable: "S" };
    if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator)) {
      return { unary: node.operator === ts.SyntaxKind.PlusToken ? "+" : "-", value: parse(node.operand) };
    }
    if (ts.isBinaryExpression(node) && operators.has(node.operatorToken.getText(file))) {
      return { operator: node.operatorToken.getText(file), left: parse(node.left), right: parse(node.right) };
    }
    if (ts.isConditionalExpression(node)) return { condition: parse(node.condition), yes: parse(node.whenTrue), no: parse(node.whenFalse) };
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === "Math" ? node.expression.name.text : "";
      if (functions.has(name) && node.arguments.length > 0 && node.arguments.length <= 8) return { call: name, args: node.arguments.map(parse) };
    }
    throw new Error(`面积公式不支持：${node.getText(file)}；使用 S、算术、比较、条件表达式及 Math 数学函数。`);
  };
  return parse(statement.declarationList.declarations[0].initializer);
}

/** 可序列化到专用测试构建；S 由正式 Host 的设备准备流程传入。 */
export function evaluateAreaFormula(tree, S) {
  if (!Number.isSafeInteger(S) || S <= 0) throw new Error("正式设备占地必须是正安全整数。");
  const evaluate = node => {
    if ("number" in node) return node.number;
    if (node.variable === "S") return S;
    if (node.unary) return node.unary === "-" ? -evaluate(node.value) : +evaluate(node.value);
    if (node.condition) return evaluate(node.condition) ? evaluate(node.yes) : evaluate(node.no);
    if (node.call) return Math[node.call](...node.args.map(evaluate));
    const a = evaluate(node.left), b = evaluate(node.right);
    switch (node.operator) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return a / b;
      case "%": return a % b;
      case "**": return a ** b;
      case "<": return a < b;
      case "<=": return a <= b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "===": return a === b;
      case "!==": return a !== b;
      default: throw new Error("未知面积运算符。");
    }
  };
  const value = evaluate(tree);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("面积公式结果必须是有限正数。");
  return Math.min(4900, Math.ceil(value));
}
