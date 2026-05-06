'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronUp, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { fsApi, type FsBrowseResponse } from '@/lib/api/fs';
import { cn } from '@/lib/utils';

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
}

/**
 * Hybrid folder picker. Primary path: click "Browse" → native OS folder
 * dialog opens on the user's machine via the local server (osascript /
 * zenity / PowerShell). Fallback: type/autocomplete via `/api/fs/browse`,
 * for the rare case the native picker isn't available.
 */
export function FolderPicker({ value, onChange, placeholder }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState<FsBrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickerUnavailable, setPickerUnavailable] = useState<string | null>(null);

  const listingPath = useMemo(() => {
    if (!value || value === '~') return '~';
    if (value.endsWith('/')) return value;
    const parent = value.replace(/[^/]*$/, '');
    return parent || '~';
  }, [value]);

  const filterFragment = useMemo(() => {
    if (!value || value === '~' || value.endsWith('/')) return '';
    const m = value.match(/[^/]+$/);
    return m ? m[0].toLowerCase() : '';
  }, [value]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fsApi.browse(listingPath)
      .then((res) => { if (!cancelled) setBrowse(res); })
      .catch((err) => { if (!cancelled) console.error('[folder-picker] browse failed', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listingPath, open]);

  const filteredEntries = useMemo(() => {
    if (!browse) return [];
    if (!filterFragment) return browse.entries;
    return browse.entries.filter((e) => e.name.toLowerCase().startsWith(filterFragment));
  }, [browse, filterFragment]);

  const selectEntry = (entryPath: string) => onChange(entryPath);
  const goUp = () => {
    if (browse?.parent) onChange(browse.parent + '/');
  };

  const handleBrowse = async () => {
    if (picking) return;
    setPicking(true);
    setOpen(false);
    try {
      const res = await fsApi.pickFolder('Choose a workspace folder');
      if (res.kind === 'picked') {
        onChange(res.path);
        // Don't focus the input — that would trigger onFocus and pop the
        // autocomplete dropdown. The user just confirmed a folder via the
        // native dialog; show a clean state.
      } else if (res.kind === 'unsupported') {
        setPickerUnavailable(res.reason);
      }
      // 'cancelled' is a no-op — leave the existing value alone
    } catch (err) {
      console.error('[folder-picker] pickFolder failed', err);
      setPickerUnavailable('Native picker failed — type a path instead.');
    } finally {
      setPicking(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={placeholder ?? '~/path/to/project'}
            className="w-full px-3 py-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {open && (
            <div className="absolute left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-lg z-50">
              {browse?.parent && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); goUp(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/50"
                >
                  <ChevronUp size={11} />
                  <span className="font-mono truncate">../ ({browse.parent})</span>
                </button>
              )}
              {loading && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground/60 italic">
                  Loading…
                </div>
              )}
              {!loading && filteredEntries.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground/60 italic">
                  No directories
                </div>
              )}
              {filteredEntries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); selectEntry(entry.path); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/50',
                    'text-foreground',
                  )}
                >
                  <Folder size={11} className="text-muted-foreground/70" />
                  <span className="font-mono truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleBrowse}
          disabled={picking}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-border bg-background',
            'hover:bg-muted/40 transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {picking ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
          Browse
        </button>
      </div>
      {pickerUnavailable && (
        <p className="mt-1 text-[10px] text-amber-500/90">{pickerUnavailable}</p>
      )}
    </div>
  );
}
