'use client';

import { Columns3 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { toolbarButtonClass } from '@/components/shared/list-toolbar';

export function ColumnPicker<T extends string>({ columns, visible, onChange }: {
  columns: readonly { id: T; label: string }[];
  visible: readonly T[];
  onChange: (ids: T[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={toolbarButtonClass()} aria-label={`Columns, ${visible.length} of ${columns.length} visible`}>
        <Columns3 className="size-3.5 shrink-0" />
        Columns <span className="text-muted-foreground tabular-nums">{visible.length}/{columns.length}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        {columns.map(({ id, label }) => (
          <DropdownMenuCheckboxItem key={id} checked={visible.includes(id)} onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => onChange(columns.filter((c) => c.id === id ? checked : visible.includes(c.id)).map((c) => c.id))}>
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(columns.map((c) => c.id))}>Show all columns</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HiddenColumnsEmpty({ onShowAll }: { onShowAll: () => void }) {
  return <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
    <Columns3 className="size-6 text-muted-foreground" />
    <p className="text-sm font-medium">All columns are hidden</p>
    <p className="text-xs text-muted-foreground">Choose columns above to focus your board.</p>
    <button type="button" onClick={onShowAll} className={toolbarButtonClass()}>Show all columns</button>
  </div>;
}
