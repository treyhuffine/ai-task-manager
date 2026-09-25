import fs from 'node:fs';
import path from 'node:path';

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
