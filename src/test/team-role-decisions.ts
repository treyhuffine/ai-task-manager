import ts from 'typescript';

/** Follow TypeScript types through destructuring and aliases, rather than spelling-based role checks. */
export function teamRoleDecisions(source: ts.SourceFile, checker: ts.TypeChecker): number[] {
  const problems: number[] = [];
  const typeNames = (node: ts.Node) => {
    const type = checker.getTypeAtLocation(node);
    const parts = type.isUnion() ? type.types : [type];
    return parts.filter((part): part is ts.StringLiteralType => part.isStringLiteral()).map(part => part.value);
  };
  const hasRole = (node: ts.Node): boolean => {
    if (ts.isStringLiteralLike(node) || ts.isFunctionLike(node)) return false;
    const values = typeNames(node);
    if (values.includes('owner') && values.includes('member')) return true;
    // Drizzle columns retain their column type rather than their string union.
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'role') return true;
    return ts.forEachChild(node, hasRole) ?? false;
  };
  const hasRoleLiteral = (node: ts.Node): boolean => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ['owner', 'member'].includes(node.name.text)) return true;
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      const values = typeNames(node);
      if (values.length === 1 && ['owner', 'member'].includes(values[0])) return true;
    }
    return ts.forEachChild(node, hasRoleLiteral) ?? false;
  };
  const visit = (node: ts.Node) => {
    const decision = ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)
      || ts.isSwitchStatement(node) || ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['includes', 'has', 'some', 'every'].includes(node.expression.name.text) || ts.isElementAccessExpression(node);
    if (decision && hasRole(node) && hasRoleLiteral(node)) problems.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(problems)];
}
