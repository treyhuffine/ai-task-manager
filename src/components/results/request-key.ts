/** Keep a browser retry on the same operation identity, including after reload. */
export function resultRequestKey(namespace: string, intent: unknown): string {
  const storageKey = `ri.result-request.${namespace}.${JSON.stringify(intent)}`;
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) return saved;
    const key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

export function clearResultRequestKey(namespace: string, intent: unknown): void {
  try { sessionStorage.removeItem(`ri.result-request.${namespace}.${JSON.stringify(intent)}`); } catch { /* Browser storage may be unavailable. */ }
}
