'use client';
import { useRef, useState } from 'react';
import { Box, Eye, File as FileIcon, Folder, Plus, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tip';
import { pickMcpIcon, type McpIcon } from '@/lib/integrations/mcp-icons';
import { acceptsFile, type FormContent, type FormField, type FormOption, type ResourceOption } from '@/lib/mcp-apps/form-schema';
import { cn } from '@/lib/utils';

/**
 * The fields of a server's form (docs/connected-mcp-apps.md, "Forms"), one
 * control per OpenAI field shape. Values are the answer as it will be sent:
 * strings, numbers, booleans and string arrays, with resources as URIs.
 */

export type FormValues = Partial<FormContent>;
/** Where a person's own files come from, for a server on this computer. */
export interface FormFiles {
  local: boolean;
  folders: { label: string; uri: string }[];
  attachments: { fileName: string; name: string; mimeType?: string }[];
  /** Turns a pick into the `file://` URI the server receives, after the Home checks it. */
  add(field: string, pick: { attachment: string } | { folder: string; path?: string }): Promise<{ uri: string; name: string }>;
  /** Uploads a file through Ri's attachments and returns its stored name. */
  upload(file: File): Promise<string>;
}
export interface FormFieldsProps {
  fields: FormField[];
  values: FormValues;
  errors: Record<string, string>;
  disabled?: boolean;
  files: FormFiles;
  onChange(name: string, value: FormContent[string] | undefined): void;
  onPreview(option: ResourceOption): void;
  /** Names for resources the person added, which no option names. */
  labels: Record<string, string>;
  onLabel(uri: string, name: string): void;
}

export function FormFields(props: FormFieldsProps) {
  return <div className="space-y-4">{props.fields.map(field => <FieldShell key={field.name} field={field} error={props.errors[field.name]}>
    <Control field={field} {...props} />
  </FieldShell>)}</div>;
}

function FieldShell({field, error, children}: {field: FormField; error?: string; children: React.ReactNode}) {
  const label = field.title ?? field.name;
  return <fieldset className="min-w-0 space-y-1.5" aria-invalid={!!error || undefined}>
    {field.kind !== 'boolean' && <legend className="text-xs font-medium text-foreground">{label}{field.required && <span aria-hidden className="text-muted-foreground"> *</span>}</legend>}
    {field.description && field.kind !== 'boolean' && <p className="text-[11px] leading-snug text-muted-foreground">{field.description}</p>}
    {children}
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </fieldset>;
}

const INPUT_TYPE = { email: 'email', uri: 'url', date: 'date', 'date-time': 'datetime-local' } as const;

/** HTML's local date-time to RFC 3339 with this computer's offset, as MCP's `date-time` format needs. */
export function toDateTime(local: string) {
  const date = new Date(local);
  if (!local || Number.isNaN(date.getTime())) return local;
  const offset = -date.getTimezoneOffset(), sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  return `${local.length === 16 ? `${local}:00` : local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}
const fromDateTime = (value: string) => value.slice(0, 16);

function Control(props: FormFieldsProps & {field: FormField}) {
  const {field, values, onChange, disabled} = props;
  const value = values[field.name];
  const id = `form-field-${field.name}`;
  switch (field.kind) {
    case 'text': {
      const type = field.format ? INPUT_TYPE[field.format] : 'text';
      const text = typeof value === 'string' ? (field.format === 'date-time' ? fromDateTime(value) : value) : '';
      return <div className="space-y-1.5">
        <Input id={id} type={type} value={text} disabled={disabled} aria-label={field.title ?? field.name}
          minLength={field.minLength} maxLength={field.maxLength} className="h-8 text-xs"
          onChange={event => onChange(field.name, event.target.value === '' ? undefined : field.format === 'date-time' ? toDateTime(event.target.value) : event.target.value)} />
        <Suggestions options={field.suggestions} disabled={disabled} chosen={option => option.value === value} onPick={option => onChange(field.name, option.value)} />
      </div>;
    }
    case 'number':
      return <Input id={id} type="number" inputMode={field.integer ? 'numeric' : 'decimal'} min={field.minimum} max={field.maximum} step={field.integer ? 1 : 'any'}
        aria-label={field.title ?? field.name} disabled={disabled} className="h-8 w-40 text-xs" value={typeof value === 'number' ? value : ''}
        onChange={event => onChange(field.name, event.target.value === '' ? undefined : Number(event.target.value))} />;
    case 'boolean':
      return <label className="flex cursor-pointer items-start gap-2.5">
        <Switch checked={value === true} disabled={disabled} onCheckedChange={checked => onChange(field.name, checked)} aria-label={field.title ?? field.name} className="mt-0.5" />
        <span className="min-w-0"><span className="block text-xs font-medium">{field.title ?? field.name}{field.required && <span aria-hidden className="text-muted-foreground"> *</span>}</span>
          {field.description && <span className="block text-[11px] leading-snug text-muted-foreground">{field.description}</span>}</span>
      </label>;
    case 'select':
      return <Options options={field.options} thumbnails={field.thumbnails} multiple={false} disabled={disabled} label={field.title ?? field.name}
        chosen={option => option.value === value} onToggle={option => onChange(field.name, option.value === value && !field.required ? undefined : option.value)} />;
    case 'multiselect': {
      const chosen = Array.isArray(value) ? value : [];
      return <Options options={field.options} thumbnails={field.thumbnails} multiple disabled={disabled} label={field.title ?? field.name}
        chosen={option => chosen.includes(option.value)}
        onToggle={option => onChange(field.name, chosen.includes(option.value) ? chosen.filter(v => v !== option.value) : [...chosen, option.value])} />;
    }
    case 'texts':
      return <TextsControl {...props} field={field} />;
    case 'resource':
      return <ResourceControl {...props} field={field} />;
  }
}

function Suggestions({options, chosen, onPick, disabled}: {options: FormOption[]; chosen(option: FormOption): boolean; onPick(option: FormOption): void; disabled?: boolean}) {
  if (!options.length) return null;
  return <div className="flex flex-wrap items-center gap-1.5" aria-label="Suggestions">
    {options.map(option => {
      const button = <button type="button" key={option.value} disabled={disabled} aria-pressed={chosen(option)} onClick={() => onPick(option)}
        className={cn('rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50', chosen(option) ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50')}>{option.title}</button>;
      return option.description ? <Tip key={option.value} label={option.description}>{button}</Tip> : button;
    })}
  </div>;
}

/** An image the server supplied, or a neutral mark when an option has none. */
function Thumbnail({icon, className}: {icon?: McpIcon; className?: string}) {
  const [failed, setFailed] = useState(false);
  const theme = typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const src = icon && pickMcpIcon([icon], theme)?.src;
  if (!src || failed) return <span aria-hidden className={cn('flex items-center justify-center rounded-md bg-muted text-muted-foreground', className)}><Box size={16} /></span>;
  // eslint-disable-next-line @next/next/no-img-element -- a server-supplied data or https image, not an app asset
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn('rounded-md bg-muted object-contain', className)} />;
}

function Options({options, thumbnails, multiple, chosen, onToggle, disabled, label}: {options: FormOption[]; thumbnails: boolean; multiple: boolean; chosen(option: FormOption): boolean; onToggle(option: FormOption): void; disabled?: boolean; label: string}) {
  const role = multiple ? 'checkbox' : 'radio';
  // OpenAI's spec: once any option has a thumbnail, every option shows as an image, with a fallback.
  if (thumbnails) return <div role={multiple ? 'group' : 'radiogroup'} aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
    {options.map(option => <button key={option.value} type="button" role={role} aria-checked={chosen(option)} disabled={disabled} onClick={() => onToggle(option)}
      className={cn('flex min-w-0 flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors disabled:opacity-50', chosen(option) ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border hover:bg-muted/40')}>
      <Thumbnail icon={option.thumbnail} className="aspect-square w-full" />
      <span className="truncate text-[11px] font-medium">{option.title}</span>
      {option.description && <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{option.description}</span>}
    </button>)}
  </div>;
  return <div role={multiple ? 'group' : 'radiogroup'} aria-label={label} className="space-y-1">
    {options.map(option => <button key={option.value} type="button" role={role} aria-checked={chosen(option)} disabled={disabled} onClick={() => onToggle(option)}
      className={cn('flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:opacity-50', chosen(option) ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40')}>
      <span aria-hidden className={cn('mt-0.5 size-3 shrink-0 border', multiple ? 'rounded-sm' : 'rounded-full', chosen(option) ? 'border-primary bg-primary' : 'border-muted-foreground/50')} />
      <span className="min-w-0"><span className="block text-xs">{option.title}</span>
        {option.description && <span className="block text-[11px] leading-snug text-muted-foreground">{option.description}</span>}</span>
    </button>)}
  </div>;
}

/** Free-form strings: suggestions to add, plus the person's own. */
function TextsControl({field, values, onChange, disabled}: FormFieldsProps & {field: Extract<FormField, {kind: 'texts'}>}) {
  const [draft, setDraft] = useState('');
  const current = Array.isArray(values[field.name]) ? values[field.name] as string[] : [];
  const add = (text: string) => {
    const value = text.trim();
    if (!value || (field.uniqueItems && current.includes(value))) return;
    onChange(field.name, [...current, value]);
    setDraft('');
  };
  const remove = (index: number) => onChange(field.name, current.filter((_, i) => i !== index));
  const titled = new Map(field.suggestions.map(option => [option.value, option.title]));
  return <div className="space-y-1.5">
    {current.length > 0 && <ul className="flex flex-wrap gap-1.5">{current.map((value, index) => <li key={`${value}-${index}`} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
      {titled.get(value) ?? value}
      <button type="button" disabled={disabled} aria-label={`Remove ${titled.get(value) ?? value}`} onClick={() => remove(index)} className="text-muted-foreground hover:text-foreground"><X size={11} /></button>
    </li>)}</ul>}
    <Suggestions options={field.suggestions.filter(option => !current.includes(option.value))} disabled={disabled} chosen={() => false} onPick={option => add(option.value)} />
    <div className="flex gap-1.5">
      <Input value={draft} disabled={disabled} aria-label={`Add to ${field.title ?? field.name}`} placeholder="Add your own" className="h-8 text-xs"
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(draft); } }} />
      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={disabled || !draft.trim()} onClick={() => add(draft)}><Plus size={12} />Add</Button>
    </div>
  </div>;
}

/**
 * OpenAI's resource selection. Explicit selection picks among the options,
 * implicit selection starts with all of them and the person removes or adds
 * back. A server on this computer may also take the person's own files or
 * folders (`userOptions`).
 */
function ResourceControl(props: FormFieldsProps & {field: Extract<FormField, {kind: 'resource'}>}) {
  const {field, values, onChange, disabled, onPreview, labels} = props;
  const value = values[field.name];
  const chosen = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const set = (uris: string[]) => onChange(field.name, field.multiple ? uris : uris[0]);
  const toggle = (uri: string) => {
    if (!field.multiple) return set(chosen[0] === uri && !field.required ? [] : [uri]);
    set(chosen.includes(uri) ? chosen.filter(v => v !== uri) : [...chosen, uri]);
  };
  const implicit = field.multiple && field.selection === 'implicit';
  const shown = implicit ? field.options.filter(option => chosen.includes(option.uri)) : field.options;
  const removed = implicit ? field.options.filter(option => !chosen.includes(option.uri)) : [];
  const added = chosen.filter(uri => !field.options.some(option => option.uri === uri));
  return <div className="space-y-2">
    {shown.length > 0 && <ul aria-label={field.title ?? field.name} className="space-y-1">
      {shown.map(option => <li key={option.uri} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', !implicit && chosen.includes(option.uri) ? 'border-primary/50 bg-primary/5' : 'border-border')}>
        {/* Implicit selection keeps whatever remains, so its rows are removed rather than ticked. */}
        <button type="button" disabled={disabled || implicit} onClick={() => toggle(option.uri)} className="flex min-w-0 flex-1 items-center gap-2 text-left"
          {...(implicit ? {} : {role: field.multiple ? 'checkbox' : 'radio', 'aria-checked': chosen.includes(option.uri)})}>
          {!implicit && <span aria-hidden className={cn('size-3 shrink-0 border', field.multiple ? 'rounded-sm' : 'rounded-full', chosen.includes(option.uri) ? 'border-primary bg-primary' : 'border-muted-foreground/50')} />}
          <Thumbnail icon={option.thumbnail} className="size-9 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs">{option.title ?? option.name}</span>
            {option.description && <span className="block truncate text-[11px] text-muted-foreground">{option.description}</span>}
          </span>
        </button>
        {option.preview && <Tip label={`Preview ${option.title ?? option.name}`}><Button type="button" size="icon-xs" variant="ghost" aria-label={`Preview ${option.title ?? option.name}`} onClick={() => onPreview(option)}><Eye size={13} /></Button></Tip>}
        {implicit && <Button type="button" size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Remove ${option.title ?? option.name}`} onClick={() => toggle(option.uri)}><X size={13} /></Button>}
      </li>)}
    </ul>}
    {removed.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Removed:</span>
      {removed.map(option => <button key={option.uri} type="button" disabled={disabled} onClick={() => toggle(option.uri)}
        className="flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40"><Plus size={11} />{option.title ?? option.name}</button>)}
    </div>}
    {added.length > 0 && <ul className="space-y-1">{added.map(uri => <li key={uri} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
      {field.userOptions?.kind === 'directory' ? <Folder size={13} className="shrink-0 text-muted-foreground" /> : <FileIcon size={13} className="shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate">{labels[uri] ?? uri}</span>
      <Button type="button" size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Remove ${labels[uri] ?? uri}`} onClick={() => set(chosen.filter(v => v !== uri))}><X size={13} /></Button>
    </li>)}</ul>}
    {field.userOptions && props.files.local && (field.multiple || !added.length) && <AddYourOwn {...props} field={field} onAdd={(uri, name) => { props.onLabel(uri, name); set(field.multiple ? [...chosen, uri] : [uri]); }} />}
  </div>;
}

/** A file from this chat's attachments, an upload, or a path in one of the chat's agent folders. */
function AddYourOwn({field, files, disabled, onAdd}: FormFieldsProps & {field: Extract<FormField, {kind: 'resource'}>; onAdd(uri: string, name: string): void}) {
  const options = field.userOptions!;
  const [folder, setFolder] = useState(files.folders[0]?.uri ?? '');
  const [relative, setRelative] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const attachments = files.attachments.filter(file => acceptsFile(options.accept, file.name, file.mimeType));
  const add = async (pick: Parameters<FormFiles['add']>[1]) => {
    setBusy(true); setFailure(null);
    try { const file = await files.add(field.name, pick); onAdd(file.uri, file.name); setRelative(''); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'That could not be added.'); }
    finally { setBusy(false); }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!acceptsFile(options.accept, file.name, file.type)) { setFailure(`This takes ${options.accept.join(', ')} files.`); return; }
    setBusy(true); setFailure(null);
    try { await add({attachment: await files.upload(file)}); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'The upload failed.'); setBusy(false); }
  };
  const directory = options.kind === 'directory';
  return <div className="space-y-1.5 rounded-md border border-dashed border-border p-2">
    <p className="text-[11px] text-muted-foreground">{directory ? 'Add a folder from this chat\'s agent' : `Add your own file${options.accept.length ? ` (${options.accept.join(', ')})` : ''}`}</p>
    {!directory && attachments.length > 0 && <div className="flex flex-wrap gap-1.5">{attachments.map(file => <button key={file.fileName} type="button" disabled={disabled || busy} onClick={() => void add({attachment: file.fileName})}
      className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted/40 disabled:opacity-50"><FileIcon size={11} />{file.name}</button>)}</div>}
    {files.folders.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
      <select aria-label="Agent folder" value={folder} disabled={disabled || busy} onChange={event => setFolder(event.target.value)} className="h-8 max-w-44 rounded-md border bg-background px-1.5 text-xs">
        {files.folders.map(option => <option key={option.uri} value={option.uri}>{option.label}</option>)}
      </select>
      <Input value={relative} disabled={disabled || busy} aria-label={directory ? 'Folder inside it' : 'File path inside it'} placeholder={directory ? 'Folder inside it (optional)' : 'parts/bracket.step'}
        className="h-8 min-w-36 flex-1 text-xs" onChange={event => setRelative(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add({folder, path: relative}); } }} />
      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={disabled || busy || !folder || (!directory && !relative.trim())} onClick={() => void add({folder, path: relative})}><Plus size={12} />Add</Button>
    </div>}
    {!directory && <>
      <input ref={input} type="file" hidden accept={options.accept.join(',') || undefined} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={disabled || busy} onClick={() => input.current?.click()}><Upload size={12} />Upload a file</Button>
    </>}
    {directory && !files.folders.length && <p className="text-[11px] text-muted-foreground">This chat has no agent folder to choose from.</p>}
    {failure && <p role="alert" className="text-[11px] text-destructive">{failure}</p>}
  </div>;
}
