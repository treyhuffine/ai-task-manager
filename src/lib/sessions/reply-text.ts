import { escapeFilePreviewLabel, isLocalFileTarget, rewriteLocalFileReferences } from './local-file-references';

// Formats we can read as text. Everything else keeps the copy/open dialog.
export const TEXT_FILE_EXTENSIONS = 'md|mdx|markdown|txt|text|log|json|jsonc|json5|ya?ml|toml|ini|cfg|conf|env|csv|tsv|[cm]?[jt]sx?|css|scss|sass|less|xml|sh|bash|zsh|fish|py|pyi|rb|go|rs|java|kt|swift|c|h|cc|cpp|cxx|hh|hpp|hxx|cs|sql|graphql|gql|vue|svelte|astro|php|pl|pm|lua|r|jl|dart|ex|exs|elm|scala|groovy|ps1|bat|cmd|properties|gitignore|gitattributes|editorconfig|prettierrc|eslintrc|dockerignore|diff|patch';
export const TEXT_BASENAMES = 'README|LICENSE|LICENCE|COPYING|NOTICE|CHANGELOG|Makefile|Dockerfile|Justfile|Procfile|Gemfile|Rakefile|Brewfile';
const TEXT_REFERENCE_PREFIX = '#ri-text=';
export const TEXT_PREVIEW_TAG = 'ri-text-preview';

/** Source line locations and document anchors identify the file without being part of its name. */
const textFilePath = (target: string) => target.split('#')[0].replace(/:\d+(?::\d+)?$/, '');
export const isLocalTextTarget = (target: string) => {
  const file = textFilePath(target);
  if (isLocalFileTarget(file, TEXT_FILE_EXTENSIONS)) return true;
  return new RegExp(`^(?:${TEXT_BASENAMES})$`, 'i').test(file.split('/').at(-1) ?? '') && isLocalFileTarget(`${file}.txt`, 'txt');
};

export function textPreviewTarget(href: string | undefined): string | null {
  if (!href?.startsWith(TEXT_REFERENCE_PREFIX)) return null;
  try {
    const path = decodeURIComponent(href.slice(TEXT_REFERENCE_PREFIX.length));
    return isLocalTextTarget(path) ? textFilePath(path) : null;
  } catch {
    return null;
  }
}

/** The same natural file references as images, PDFs and HTML, with no eager file reads. */
export function rewriteLocalText(markdown: string, sessionId: string | null | undefined, relativeTo?: string): string {
  if (!sessionId) return markdown;
  return rewriteLocalFileReferences(markdown, {
    extensions: TEXT_FILE_EXTENSIONS,
    basenames: TEXT_BASENAMES,
    matches: target => isLocalTextTarget(target) && !/\.(csv|tsv)$/i.test(textFilePath(target)),
    relativeTo,
    preservePathText: true,
    render: (path, label) => {
      const text = escapeFilePreviewLabel(label || path.split('/').at(-1) || path);
      return `<${TEXT_PREVIEW_TAG} href="${TEXT_REFERENCE_PREFIX}${encodeURIComponent(textFilePath(path))}">${text}</${TEXT_PREVIEW_TAG}>`;
    },
  });
}

/** Exact parsed references, so naming notes.md.bak cannot grant access to notes.md. */
export function replyNamesTextFile(markdown: string, path: string): boolean {
  let named = false;
  rewriteLocalFileReferences(markdown, {
    extensions: TEXT_FILE_EXTENSIONS,
    basenames: TEXT_BASENAMES,
    matches: isLocalTextTarget,
    render: target => { if (textFilePath(target) === path) named = true; return ''; },
  });
  return named;
}
