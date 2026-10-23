'use client';
import { Command } from 'cmdk';
import { Calendar, FileText, FileCheck2, LayoutDashboard, ListTodo, MessagesSquare, Mic, Moon, Plus, Radio, Settings, SquareKanban, StickyNote, Sun, TextSearch, LayoutGrid, type LucideIcon } from 'lucide-react';
import type { PaletteCommand } from '@/constants/commands';
const icons: Record<string, LucideIcon> = { Calendar, FileText, FileCheck2, LayoutDashboard, ListTodo, MessagesSquare, Mic, Moon, Plus, Radio, Settings, SquareKanban, StickyNote, Sun, TextSearch, LayoutGrid };

/** One command matching and keyboard row implementation. Homes supply available actions. */
export function CommandSearchItems({ commands, query, onSelect, icon = command => command.icon, label = command => command.label }: {
  commands: PaletteCommand[]; query: string; onSelect: (command: PaletteCommand) => void;
  icon?: (command: PaletteCommand) => string; label?: (command: PaletteCommand) => string;
}) {
  const found = commands.filter(command => `${label(command)} ${command.keywords}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    {!found.length && <p className="p-8 text-center text-[11px] text-muted-foreground">No matching commands</p>}
    <Command.Group heading="Actions" className="px-2 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60">
      {found.map(command => {
        const Icon = icons[icon(command)];
        return <Command.Item key={command.id} value={command.id} onSelect={() => onSelect(command)} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left data-[selected=true]:bg-muted/50">
          <span className="shrink-0 text-muted-foreground">{Icon && <Icon size={14}/>}</span><span className="flex-1 text-[12px] font-medium">{label(command)}</span>
          {command.shortcut && <kbd className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground/60">{command.shortcut}</kbd>}
        </Command.Item>;
      })}
    </Command.Group>
  </>;
}
