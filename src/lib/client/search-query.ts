import { TYPE_PREFIXES, type EntityTypeFilter } from '@/constants/commands';
export function parseSearchQuery(raw: string): { searchQuery: string; typeFilter: EntityTypeFilter | null; isCommand: boolean } {
  const trimmed = raw.trim();

  if (trimmed.startsWith('>')) {
    return { searchQuery: trimmed.slice(1).trim(), typeFilter: null, isCommand: true };
  }

  for (const [prefix, filter] of Object.entries(TYPE_PREFIXES)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return { searchQuery: trimmed.slice(prefix.length).trim(), typeFilter: filter, isCommand: false };
    }
  }

  return { searchQuery: trimmed, typeFilter: null, isCommand: false };
}
