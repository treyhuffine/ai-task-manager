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

export const SHELL_ENTRYPOINTS = ['main.cjs', 'preload.cjs', 'maintenance-preload.cjs', 'companion-preload.cjs', 'local-preload.cjs', 'find-preload.cjs', 'team-navigation.cjs'];

/** New companion releases must contain role setup, supervised worker and the
 * offline appearance assets used before a Home or Next.js can start.
 * Validate at publication, without rejecting prior Home-only rollback runtimes. */
export function assertCompanionPackage(server, shell) {
  const serverFiles = ['dist/desktop/connection-setup-entry.cjs', 'dist/service/worker.cjs', 'src/styles/theme.css',
    'public/fonts/inter-latin.woff2', 'public/fonts/OFL.txt', 'public/brand/ri-mark-white.svg'];
  const shellFiles = SHELL_ENTRYPOINTS;
  for (const file of [...serverFiles.map(file => path.join(server, file)), ...shellFiles.map(file => path.join(shell, file))]) {
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

/** Every BrowserWindow preload named by source must be in the shipped shell. */
export function assertWindowPreloadsShipped(desktopSource, entries = SHELL_ENTRYPOINTS) {
  const missing = [];
  const files = fs.readdirSync(desktopSource, { recursive: true }).filter(file => file.endsWith('.ts') && !/(?:test|smoke)\.ts$/.test(file));
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(desktopSource, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const bindings = new Map();
    const collectBindings = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer);
      ts.forEachChild(node, collectBindings);
    };
    collectBindings(source);
    // Resolve ordinary static declarations, never execute source or infer a
    // runtime destination. Packaging still validates the real built inventory.
    const value = (node, seen = new Set()) => {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isIdentifier(node)) {
        if (node.text === '__dirname') return '';
        if (seen.has(node.text) || !bindings.has(node.text)) return null;
        return value(bindings.get(node.text), new Set([...seen, node.text]));
      }
      if (ts.isTemplateExpression(node)) {
        let text = node.head.text;
        for (const span of node.templateSpans) { const part = value(span.expression, seen); if (part === null) return null; text += part + span.literal.text; }
        return text;
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['join', 'resolve'].includes(node.expression.name.text)) {
        const parts = node.arguments.map(arg => value(arg, seen));
        if (parts.every(part => part !== null)) return path.posix.join(...parts);
      }
      return null;
    };
    const inspect = (node, seen = new Set()) => {
      const resolved = value(node, seen);
      if (resolved !== null) {
        if (resolved.endsWith('.cjs')) {
          const name = resolved.replace(/^\/+/, '');
          if (!entries.includes(name)) missing.push(`${file}: ${name}`);
        }
        return;
      }
      if (ts.isIdentifier(node) && bindings.has(node.text) && !seen.has(node.text)) inspect(bindings.get(node.text), new Set([...seen, node.text]));
      else ts.forEachChild(node, child => inspect(child, seen));
    };
    const visit = node => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source).replace(/['"]/g, '') === 'preload') inspect(node.initializer);
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'preload') inspect(node.name);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'registerPreloadScript') for (const arg of node.arguments) inspect(arg);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (missing.length) throw new Error('Unshipped window preloads: ' + [...new Set(missing)].join(', '));
}
