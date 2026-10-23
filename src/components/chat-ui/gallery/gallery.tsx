'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, LayoutTemplate, Monitor, RotateCcw, Search, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';
import { CHAT_UI_EXAMPLES, filterGalleryExamples, galleryExample, galleryPreviewUrl, GALLERY_ORIGINS, type ChatUiExample } from './catalog';

export function ChatUiGallery() {
  const [selected, setSelected] = useState('email');
  const [state, setState] = useState('draft');
  const [search, setSearch] = useState('');
  const [origin, setOrigin] = useState('all');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [phone, setPhone] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const example = galleryExample(selected);
  const matches = filterGalleryExamples(search, origin);

  useEffect(() => {
    const read = () => {
      const [id, query] = window.location.hash.slice(1).split('?');
      const item = galleryExample(id);
      const requested = new URLSearchParams(query).get('state');
      setSearch('');
      setOrigin('all');
      setSelected(item.id);
      setState(item.states.some(state => state.id === requested) ? requested! : item.states[0].id);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const choose = (item: ChatUiExample, nextState = item.states[0].id) => {
    if (item.id === selected && nextState === state) return;
    setSelected(item.id);
    setState(nextState);
    setLoaded(false);
    window.history.pushState(null, '', `#${item.id}${nextState !== item.states[0].id ? `?state=${encodeURIComponent(nextState)}` : ''}`);
  };
  const filter = (nextSearch: string, nextOrigin: string) => {
    setSearch(nextSearch); setOrigin(nextOrigin);
    const next = filterGalleryExamples(nextSearch, nextOrigin);
    if (next.length && !next.some(item => item.id === selected)) choose(next[0]);
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(value); }
    catch { setCopied(null); }
  };
  const previewKey = `${selected}:${state}:${theme}:${generation}`;

  return <div className="min-h-dvh bg-background text-foreground">
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} />Back to Ri</Link>
        <span className="text-[11px] text-muted-foreground">A living reference</span>
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-7 max-w-3xl">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground"><LayoutTemplate size={16} />Chat interfaces</div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Chat UI gallery</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Explore the interfaces that turn a conversation into something you can act on. See what Ri includes, what connected apps supply, and what app authors can build with the kit.</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">These examples use fictional data and simulated actions. You can try every example without installing an app or changing your accounts.</p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2" aria-label="Filter by source">
        {[{ id: 'all', label: 'All sources' }, ...Object.entries(GALLERY_ORIGINS).map(([id, value]) => ({ id, label: value.label }))].map(item => <button key={item.id} type="button" aria-pressed={origin === item.id} onClick={() => filter(search, item.id)} className={cn('rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', origin === item.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted')}>
          {item.label}<span className="ml-1.5 opacity-60">{item.id === 'all' ? CHAT_UI_EXAMPLES.length : CHAT_UI_EXAMPLES.filter(example => example.origin === item.id).length}</span>
        </button>)}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-6" aria-label="Gallery examples">
          <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Search chat interfaces" placeholder="Find an interface" value={search} onChange={event => filter(event.target.value, origin)} className="pl-9" /></div>
          <p className="mt-2 text-[11px] text-muted-foreground" aria-live="polite">{matches.length} {matches.length === 1 ? 'example' : 'examples'}</p>
          {matches.length > 0 && <label className="mt-3 block lg:hidden"><span className="sr-only">Select an example</span><select value={selected} onChange={event => choose(galleryExample(event.target.value))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{matches.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
          <nav className="mt-4 hidden space-y-1 lg:block" aria-label="Chat UI examples">{matches.map(item => <button type="button" key={item.id} aria-current={selected === item.id ? 'page' : undefined} onClick={() => choose(item)} className={cn('w-full rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', selected === item.id ? 'bg-muted' : 'hover:bg-muted/50')}>
            <span className="block text-[13px] font-medium">{item.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{GALLERY_ORIGINS[item.origin].label}</span>
          </button>)}</nav>
        </aside>

        {matches.length === 0 ? <section className="rounded-xl border border-dashed border-border p-8"><h2 className="text-sm font-medium">No matching interfaces</h2><p className="mt-2 text-xs text-muted-foreground">Try another search or source.</p><Button variant="outline" size="sm" className="mt-4" onClick={() => filter('', 'all')}>Clear filters</Button></section> : <article className="min-w-0 space-y-5" aria-labelledby="example-name">
          <div>
            <span className="inline-flex rounded border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{GALLERY_ORIGINS[example.origin].label}</span>
            <h2 id="example-name" className="mt-2 text-xl font-semibold">{example.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{example.description}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{example.availability}</p>
          </div>

          <section className="overflow-hidden rounded-xl border border-border" aria-label="Interactive preview">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/25 px-3 py-2.5">
              <label className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">State</span><select aria-label="Example state" value={state} onChange={event => choose(example, event.target.value)} className="max-w-48 rounded-md border border-border bg-background px-2 py-1.5 text-xs">{example.states.map(state => <option key={state.id} value={state.id}>{state.label}</option>)}</select></label>
              <div className="flex items-center gap-1 sm:ml-auto" aria-label="Preview size">
                <Tip label="Preview at full width"><Button size="icon-sm" variant={phone ? 'ghost' : 'secondary'} aria-label="Desktop preview" aria-pressed={!phone} onClick={() => setPhone(false)}><Monitor size={14} /></Button></Tip>
                <Tip label="Preview at phone width"><Button size="icon-sm" variant={phone ? 'secondary' : 'ghost'} aria-label="Phone preview" aria-pressed={phone} onClick={() => setPhone(true)}><Smartphone size={14} /></Button></Tip>
              </div>
              <div className="flex rounded-md border border-border p-0.5" aria-label="Preview theme">{(['light', 'dark'] as const).map(value => <button type="button" key={value} aria-pressed={theme === value} onClick={() => { if (theme !== value) { setTheme(value); setLoaded(false); } }} className={cn('rounded px-2 py-1 text-[11px] capitalize focus-visible:outline-2 focus-visible:outline-ring', theme === value ? 'bg-muted text-foreground' : 'text-muted-foreground')}>{value}</button>)}</div>
              <Tip label="Start this example again"><Button size="icon-sm" variant="ghost" aria-label="Reset example" onClick={() => { setGeneration(value => value + 1); setLoaded(false); }}><RotateCcw size={14} /></Button></Tip>
            </div>
            <div className="overflow-hidden bg-muted/15 p-2 sm:p-4">
              {!loaded && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Opening example…</p>}
              {/* Keep the viewport steady as forms, dialogs and receipts appear.
                  Changing its height during pointer input moves the controls. */}
              <iframe key={previewKey} title={`${example.name} interactive example`} sandbox="allow-scripts" referrerPolicy="no-referrer" src={`${galleryPreviewUrl(example.id)}#${new URLSearchParams({ example: example.id, state, theme })}`} className={cn('mx-auto block h-[760px] w-full rounded-lg border border-border bg-background', phone && 'max-w-[390px]')} onLoad={() => setLoaded(true)} />
            </div>
            <p className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">Production components · Fictional data · Actions stay inside this preview</p>
          </section>

          <dl className="grid gap-4 rounded-xl border border-border bg-muted/10 p-4 text-xs sm:grid-cols-2"><div><dt className="font-medium">How it appears</dt><dd className="mt-1.5 leading-relaxed text-muted-foreground">{example.trigger}</dd></div><div><dt className="font-medium">What is saved</dt><dd className="mt-1.5 leading-relaxed text-muted-foreground">{example.persistence}</dd></div></dl>
          <details className="rounded-xl border border-border px-4 py-3"><summary className="cursor-pointer text-xs font-medium">Where this UI lives</summary>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{GALLERY_ORIGINS[example.origin].description}</p>
            <ul className="mt-3 space-y-2">{example.sources.map(source => <li key={source} className="flex min-w-0 items-start gap-2 rounded-md bg-muted/40 p-2"><code className="min-w-0 flex-1 break-all text-[10px] leading-relaxed">{source}</code><Tip label="Copy the repository path"><button type="button" aria-label={`Copy ${source}`} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => void copy(source)}>{copied === source ? <Check size={12} /> : <Copy size={12} />}</button></Tip></li>)}</ul>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">The catalog and preview fixtures live in <code>src/components/chat-ui/gallery/</code>. Built-in interfaces live together in src/components/chat-ui/ and are reused here. App kit and connected-app hosts keep their own modules.</p>
          </details>
        </article>}
      </div>
    </main>
  </div>;
}
