/** A document's storage identity is independent of navigation and record IDs. */
export function homeDocumentKey(kind: string, id: string, scope?: { homeId: string; viewerId: string } | null): string {
  const base = `${kind}:${id}`;
  if (!scope) return base;
  return `${encodeURIComponent(scope.homeId)}:${encodeURIComponent(scope.viewerId)}:${base}`;
}

/** Preserve existing personal preferences without reading them in another Home. */
export function homeStorageIdentity(id: string, scope?: { homeId: string; viewerId: string } | null): string {
  return scope ? homeDocumentKey('ui', id, scope) : id;
}

export function assertDocumentCredential(expected: string | null | undefined, current: string | null | undefined): void {
  if (expected === current) return;
  throw Object.assign(new Error('The sign-in changed. This draft is kept for its original author.'), { status: 403 });
}
