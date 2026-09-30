import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import ts from 'typescript';

/** Node's default copy resolves symlinks to the staging directory. Rebase them
 * before removing staging, then reject every link escaping the shipped tree. */
export function rebaseResourceLinks(root, sourceRoot) {
  const sourceRoots = [...new Set([path.resolve(sourceRoot), fs.realpathSync(sourceRoot)])];
  const links = [];
  const inside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(file);
      else if (entry.isDirectory()) walk(file);
    }
  };
  walk(root);
  for (const link of links) {
    const target = path.resolve(path.dirname(link), fs.readlinkSync(link));
    const source = sourceRoots.find((candidate) => inside(candidate, target));
    const mapped = source ? path.join(root, path.relative(source, target)) : target;
    if (!inside(root, mapped)) throw new Error(`Packaged symlink escapes resources: ${path.relative(root, link)}`);
    fs.unlinkSync(link);
    fs.symlinkSync(path.relative(path.dirname(link), mapped), link);
  }
  const physicalRoot = fs.realpathSync(root);
  for (const link of links) {
    if (!inside(physicalRoot, fs.realpathSync(link))) throw new Error(`Packaged dependency is not portable: ${path.relative(root, link)}`);
  }
  return links.length;
}

/** New companion releases must contain both role setup and supervised worker.
 * Validate at publication, without rejecting prior Home-only rollback runtimes. */
export function assertCompanionPackage(server, shell) {
  for (const file of [path.join(server, 'dist/desktop/connection-setup-entry.cjs'), path.join(server, 'dist/service/worker.cjs'), path.join(shell, 'companion-preload.cjs')]) {
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error(`Companion package entry is missing or unsafe: ${file}`);
  }
}

/** The Electron shell has no node_modules. Its bundled entrypoints may only
 * load Electron or Node builtins, never the app's separate Node/native graph.
 * Parse JavaScript so comments, strings, escaped specifiers and multiline calls
 * cannot hide a missing dependency or create a false positive. */
export function assertShellDependencies(shell) {
  let bundles = 0;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Shell dependency boundary: unsafe symlink ${path.relative(shell, file)}`);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.(?:cjs|mjs|js)$/.test(entry.name)) continue;
      if (!entry.isFile()) throw new Error(`Shell dependency boundary: unsafe bundle ${path.relative(shell, file)}`);
      bundles++;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const fail = (node, message) => {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        throw new Error(`Shell dependency boundary: ${path.relative(shell, file)}:${line + 1}:${character + 1} ${message}`);
      };
      if (source.parseDiagnostics.length) fail(source, 'contains invalid JavaScript');
      const check = (node, specifier) => {
        if (!specifier || !ts.isStringLiteralLike(specifier)) fail(node, 'uses a computed module loader');
        if (specifier.text !== 'electron' && !isBuiltin(specifier.text)) fail(node, `loads external module ${JSON.stringify(specifier.text)}. Bundle it or move it to the separate Node runtime.`);
      };
      const visit = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node, node.moduleSpecifier);
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const identifier = ts.isIdentifier(callee) ? callee.text : null;
          const property = ts.isPropertyAccessExpression(callee) ? callee.name.text
            : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression) ? callee.argumentExpression.text : null;
          const requireResolve = property === 'resolve' && ts.isIdentifier(callee.expression) && ['require', '__require'].includes(callee.expression.text);
          if (callee.kind === ts.SyntaxKind.ImportKeyword || ['require', '__require'].includes(identifier) || property === 'require' || requireResolve) check(node, node.arguments[0]);
          // A fresh loader hides its target behind an alias. The shell never
          // needs one because all accepted dependencies resolve directly.
          if (identifier === 'createRequire' || property === 'createRequire') fail(node, 'creates an indirect module loader');
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  walk(shell);
  if (!bundles) throw new Error('Shell dependency boundary: no shell bundles found');
  return bundles;
}
