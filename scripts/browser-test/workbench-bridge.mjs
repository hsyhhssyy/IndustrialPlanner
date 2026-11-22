import ts from "typescript";

/** 两种测试桥都在工作台完成装配后安装，并随当次装配释放。 */
export function workbenchBridgePosition(code, id) {
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mounts = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "mountWorkbench");
  const body = mounts[0]?.body;
  const assemblies = body?.statements.filter(ts.isTryStatement);
  const assembly = assemblies?.[0];
  const completion = assembly?.tryBlock.statements.at(-1);
  if (mounts.length !== 1 || assemblies?.length !== 1 || !body || !assembly || !completion || !ts.isReturnStatement(completion)) {
    throw new Error("工作台装配入口变化，停止注入测试接口：找不到 mountWorkbench 的成功返回位置");
  }

  const bindings = body.statements.filter(ts.isVariableStatement)
    .filter(statement => statement.end <= assembly.getStart(source))
    .flatMap(statement => statement.declarationList.declarations);
  const host = bindings.find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "appHost");
  const retain = bindings.find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "retainMainScene");
  const initialized = assembly.tryBlock.statements.some(statement => {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return false;
    const { left, operatorToken, right } = statement.expression;
    return ts.isIdentifier(left) && left.text === "appHost" && operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isCallExpression(right) && ts.isIdentifier(right.expression) && right.expression.text === "createAppHost";
  });
  if (!host || !initialized || !retain?.initializer) {
    throw new Error("工作台装配入口变化，停止注入测试接口：appHost 或 retainMainScene 不在预期装配作用域");
  }
  return completion.getStart(source);
}
