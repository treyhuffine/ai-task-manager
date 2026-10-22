import type { Definition, Nodes, Root } from 'mdast';

const PATH_REFERENCE_PREFIX = '#ri-link-path=';

function isPath(target: string): boolean {
  return !!target && !/^[a-z][a-z0-9+.-]*:/i.test(target.trim())
    && !/^[\\/]{2}/.test(target.trim()) && !/[\u0000-\u001f\u007f]/.test(target);
}

/** Recover only local destinations, so a hand-written marker cannot bypass URL sanitization. */
export function markdownLinkTarget(href: string): string {
  if (!href.startsWith(PATH_REFERENCE_PREFIX)) return href;
  try {
    const target = decodeURIComponent(href.slice(PATH_REFERENCE_PREFIX.length));
    return isPath(target) ? target : href;
  } catch {
    return href;
  }
}

/** Web destinations must be unambiguous without resolving against Ri's origin. */
export function markdownWebUrl(target: string | undefined): string | null {
  if (!target) return null;
  const value = target.trim();
  // Leave filenames (README.md), relative paths and non-web schemes alone.
  // A domain-shaped directory can be made explicit with ./example.com/file.
  const candidate = /^https?:\/\//i.test(value) ? value
    : value.startsWith('//') ? `https:${value}`
      : /^(?:www\.[a-z0-9-]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/)/i.test(value) ? `https://${value}`
        : null;
  if (!candidate || /[\s\\\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

/** Normalize before Streamdown's sanitizer can mistake a web destination for a path. */
export function remarkChatLinks() {
  return (tree: Root) => {
    const definitions = new Map<string, Definition>();
    function collect(node: Nodes) {
      if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
      if ('children' in node) node.children.forEach(collect);
    }
    collect(tree);
    function visit(node: Nodes) {
      if (node.type === 'link') {
        const web = markdownWebUrl(node.url);
        if (web) node.url = web;
        // Harden otherwise drops ./ and ../, and blocks plain filenames.
        // Carry the exact path through as a fragment, like artifact references.
        else if (!node.url.startsWith('#') && isPath(node.url)) node.url = `${PATH_REFERENCE_PREFIX}${encodeURIComponent(node.url)}`;
      }
      if ('children' in node) node.children.forEach((child, index) => {
        // Resolve link references without changing a definition that may also
        // supply an image. Its source must keep reaching the image renderer.
        if (child.type === 'linkReference') {
          const definition = definitions.get(child.identifier);
          if (definition) {
            const link = { ...child, type: 'link' as const, url: definition.url, title: definition.title };
            node.children[index] = link;
            visit(link);
            return;
          }
        }
        visit(child);
      });
    }
    visit(tree);
  };
}
