/**
 * Build a hierarchical tree from the flat `TreeEntry[]` the server
 * returns. The server keeps things flat because the wire shape is
 * smaller and easier to invalidate; the client groups by directory at
 * render time.
 *
 * Sort order: directories first, then files; both alphabetically by
 * lowercased basename. Stable across renders so the list never
 * reshuffles when the user is mid-scroll.
 */

import type { TreeEntry } from '@/lib/api/sessions';

export interface TreeDirNode {
  kind: 'dir';
  path: string;
  name: string;
  depth: number;
  children: TreeRenderNode[];
}

export interface TreeFileNode {
  kind: 'file';
  path: string;
  name: string;
  depth: number;
  entry: TreeEntry;
}

export type TreeRenderNode = TreeDirNode | TreeFileNode;

interface MutableDir {
  kind: 'dir';
  path: string;
  name: string;
  depth: number;
  childMap: Map<string, MutableDir | TreeFileNode>;
}

export function buildTree(entries: readonly TreeEntry[]): TreeDirNode {
  const root: MutableDir = {
    kind: 'dir',
    path: '',
    name: '',
    depth: -1,
    childMap: new Map(),
  };

  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    const parts = entry.path.split('/');
    let current: MutableDir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const existing = current.childMap.get(segment);
      if (existing && existing.kind === 'dir') {
        current = existing;
      } else {
        const dirPath = parts.slice(0, i + 1).join('/');
        const next: MutableDir = {
          kind: 'dir',
          path: dirPath,
          name: segment,
          depth: i,
          childMap: new Map(),
        };
        current.childMap.set(segment, next);
        current = next;
      }
    }
    const leafName = parts[parts.length - 1];
    current.childMap.set(leafName, {
      kind: 'file',
      path: entry.path,
      name: leafName,
      depth: parts.length - 1,
      entry,
    });
  }

  return finalizeDir(root);
}

function finalizeDir(dir: MutableDir): TreeDirNode {
  const children: TreeRenderNode[] = [];
  for (const child of dir.childMap.values()) {
    if (child.kind === 'dir') {
      children.push(finalizeDir(child));
    } else {
      children.push(child);
    }
  }
  children.sort(compareNodes);
  return {
    kind: 'dir',
    path: dir.path,
    name: dir.name,
    depth: dir.depth,
    children,
  };
}

function compareNodes(a: TreeRenderNode, b: TreeRenderNode): number {
  // Dirs first, then files; lowercase alphabetical within each group.
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

/**
 * Flatten the tree into the visible-row sequence given an
 * expanded-folder set. Used by the virtualizer.
 */
export function flattenTree(
  root: TreeDirNode,
  expanded: ReadonlySet<string>,
): TreeRenderNode[] {
  const out: TreeRenderNode[] = [];
  walk(root.children);
  return out;

  function walk(nodes: TreeRenderNode[]): void {
    for (const node of nodes) {
      out.push(node);
      if (node.kind === 'dir' && expanded.has(node.path)) {
        walk(node.children);
      }
    }
  }
}

/**
 * Collect every directory path inside the tree (used for "expand all"
 * defaults and parent-of-changed-file computations).
 */
export function collectDirPaths(root: TreeDirNode): string[] {
  const out: string[] = [];
  walk(root);
  return out;
  function walk(node: TreeDirNode): void {
    for (const child of node.children) {
      if (child.kind === 'dir') {
        out.push(child.path);
        walk(child);
      }
    }
  }
}

/**
 * For each changed file, return the set of ancestor directory paths so
 * the tree can auto-expand them. Stable across renders.
 */
export function ancestorsOfChanged(entries: readonly TreeEntry[]): Set<string> {
  const out = new Set<string>();
  for (const entry of entries) {
    if (!entry.status) continue;
    const parts = entry.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      out.add(parts.slice(0, i).join('/'));
    }
  }
  return out;
}
