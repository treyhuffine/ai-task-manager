/** Names are labels. Stable Home IDs disambiguate equal names on every surface. */
export function teamDisplayName(id: string, homes: readonly { id: string; name: string; url?: string }[] | undefined): string {
  const home = homes?.find(candidate => candidate.id === id);
  if (!home) return 'Team';
  const matches = homes!.filter(candidate => candidate.name.trim().toLocaleLowerCase() === home.name.trim().toLocaleLowerCase());
  if (matches.length < 2) return home.name;
  let host: string | null = null;
  try { host = home.url ? new URL(home.url).host : null; } catch { /* IDs remain available. */ }
  const sameHost = matches.filter(candidate => { try { return candidate.url && new URL(candidate.url).host === host; } catch { return false; } });
  const detail = host && sameHost.length === 1 ? host : id;
  return `${home.name} (${detail})`;
}
