import { useEffect, useState } from 'react';
import {
  Button, ButtonRow, ConflictNotice, Dialog, InlineError, Select, TextArea, TextInput, useAnnounce, useQuery,
} from '@ri/app-kit/ui';
import type { Birthday, PersonDetail, Profile, Relation, RelationKind } from '../schemas.js';
import { todayLocal } from './format.js';
import { Cite, Loading, NameLink, useSave, usePeople } from './shared.js';

type Saved<T> = { status: 'saved'; record: T } | { status: 'conflict'; current: T; message: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "March 14" or "March 14, 1990". */
export function birthdayText(birthday: Birthday): string {
  return `${MONTHS[birthday.month - 1]} ${birthday.day}${birthday.year ? `, ${birthday.year}` : ''}`;
}
/** Days until the next birthday from the local date, 0 for today. February 29 falls on March 1 in other years. */
export function daysToBirthday(birthday: Pick<Birthday, 'month' | 'day'>, today = todayLocal()): number {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(y, m - 1, d);
  const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const on = (year: number) => (birthday.month === 2 && birthday.day === 29 && !leap(year) ? Date.UTC(year, 2, 1) : Date.UTC(year, birthday.month - 1, birthday.day));
  const next = on(y) >= start ? on(y) : on(y + 1);
  return Math.round((next - start) / 864e5);
}
export function birthdaySoon(inDays: number): string {
  return inDays === 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : `In ${inDays} days`;
}

/** Month, day and an optional year. Empty month or day means no birthday. */
export function BirthdayInput({ value, onChange }: { value: Birthday | null; onChange(next: Birthday | null): void }) {
  const [month, setMonth] = useState(value ? String(value.month) : '');
  const [day, setDay] = useState(value ? String(value.day) : '');
  const [year, setYear] = useState(value?.year ? String(value.year) : '');
  const emit = (m: string, d: string, y: string) => {
    const parsedYear = /^\d{4}$/.test(y.trim()) ? Number(y.trim()) : null;
    onChange(m && d ? { month: Number(m), day: Number(d), year: parsedYear } : null);
  };
  return (
    <fieldset className="ri-fieldset pe-birthday">
      <legend>Birthday</legend>
      <div className="pe-birthday__row">
        <Select label="Month" value={month} onChange={(next) => { setMonth(next); emit(next, day, year); }} placeholder="Month" options={MONTHS.map((name, index) => ({ value: String(index + 1), label: name }))} />
        <Select label="Day" value={day} onChange={(next) => { setDay(next); emit(month, next, year); }} placeholder="Day" options={Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} />
        <TextInput label="Year" hint="Optional" inputMode="numeric" value={year} onChange={(next) => { setYear(next); emit(month, day, next); }} />
      </div>
    </fieldset>
  );
}

// ─── My read ─────────────────────────────────────────────────────────────────

/** The owner's own read on a person: written only by them, never by AI, shown above the generated profile. */
export function MyRead({ detail, reload }: { detail: PersonDetail; reload(): void }) {
  const ui = usePeople();
  const person = detail.person;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(person.myRead ?? '');
  const [conflict, setConflict] = useState<number | null>(null);
  const save = useSave<Saved<unknown>>('save_person');
  useEffect(() => { if (!editing) setText(person.myRead ?? ''); }, [person.myRead, editing]);
  const submit = async (revision: number) => {
    const result = await save.run({ id: person.id, expectedRevision: revision, myRead: text.trim() || null }, 'Saved');
    save.reset();
    if (result.status === 'conflict') { setConflict((result.current as { revision: number }).revision); return; }
    setConflict(null); setEditing(false); reload();
  };
  if (!ui.data.canWrite && !person.myRead) return null;
  return (
    <section className="pe-section" aria-label="My read">
      <div className="pe-section__head">
        <h3 className="pe-section__title">My read</h3>
        {ui.data.canWrite && !editing && <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>{person.myRead ? 'Edit' : 'Add'}</Button>}
      </div>
      {editing ? (
        <div className="pe-stack">
          {conflict !== null && <ConflictNotice title="This person changed since you started" fields={[{ label: 'My read', mine: text, current: person.myRead ?? '' }]} onKeepMine={() => submit(conflict)} onUseCurrent={() => { setText(person.myRead ?? ''); setConflict(null); }} busy={save.pending} />}
          <TextArea label="My read" hideLabel hint="Your own take: what they care about, how to work with them. Only you write this. AI never changes it." value={text} onChange={setText} />
          <ButtonRow>
            <Button size="sm" variant="primary" busy={save.pending} onClick={() => void submit(conflict ?? person.revision)}>Save</Button>
            <Button size="sm" variant="quiet" onClick={() => { setText(person.myRead ?? ''); setEditing(false); setConflict(null); }}>Cancel</Button>
          </ButtonRow>
          {save.error && <InlineError>{save.error}</InlineError>}
        </div>
      ) : person.myRead
        ? <p className="pe-my-read">{person.myRead}</p>
        : <p className="pe-muted pe-small">Your own take on this person. Only you write it.</p>}
    </section>
  );
}

// ─── Living profile ──────────────────────────────────────────────────────────

/** The cited profile that builds up over time, with an Update that runs the owner's own step now. */
export function ProfileSection({ personId }: { personId: string }) {
  const ui = usePeople();
  const profile = useQuery<Profile>('get_profile', { personId }, { keepPrevious: false });
  const request = useSave<{ jobId: string | null; availability: 'queued' | 'unavailable' }>('request_profile');
  const step = useSave<{ ran: { kind: string; source: string } | null; more: boolean; summary: string }>('continue_import');
  const announce = useAnnounce();
  const update = async () => {
    const result = await request.run({ personId });
    request.reset();
    if (result.availability !== 'queued') { announce('Extraction unavailable'); return; }
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      const ran = await step.run({ source: 'briefings' }).catch(() => null);
      step.reset();
      if (!ran?.ran) break;
      if (/^(Updated the profile of|The profile of)/.test(ran.summary)) done = true;
      if (!ran.more) break;
    }
    announce(done ? 'Profile updated' : 'Profile update queued. It appears after the next update');
    void profile.reload();
  };
  if (profile.error && !profile.data) return <InlineError>{profile.error}</InlineError>;
  if (!profile.data) return <Loading label="Loading profile" />;
  const data = profile.data;
  if ((data.status === 'off' || data.status === 'unavailable') && !ui.data.owner) return null;
  return (
    <section className="pe-section" aria-label="Profile">
      <div className="pe-section__head">
        <h3 className="pe-section__title">Profile</h3>
        {data.canUpdate && ui.data.canWrite && <Button size="sm" variant="quiet" busy={request.pending || step.pending} onClick={() => void update()}>{data.sections.length ? 'Update' : 'Build profile'}</Button>}
      </div>
      {data.sections.length ? (
        <div className="pe-profile">
          {data.sections.map((section) => (
            <div key={section.key} className="pe-profile__section">
              <p className="pe-profile__title">{section.title}</p>
              <ul className="pe-profile__items">
                {section.items.map((item, index) => (
                  <li key={index}>
                    {item.text}
                    {item.evidenceIds[0] && <Cite evidenceId={item.evidenceIds[0]} />}
                    {!item.evidenceIds.length && item.noteIds.length > 0 && <span className="pe-pill pe-profile__note">Your note</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : <p className="pe-muted">{data.statusLabel}</p>}
      {data.sections.length > 0 && <p className="pe-briefing__meta">{data.statusLabel}</p>}
    </section>
  );
}

// ─── Relationships ───────────────────────────────────────────────────────────

const KINDS: { value: RelationKind; label: string }[] = [
  { value: 'partner', label: 'Partner' }, { value: 'child', label: 'Child' }, { value: 'parent', label: 'Parent' }, { value: 'sibling', label: 'Sibling' },
  { value: 'family', label: 'Family' }, { value: 'friend', label: 'Friend' }, { value: 'colleague', label: 'Colleague' },
  { value: 'introduced_by', label: 'Introduced by' }, { value: 'other', label: 'Related' },
];

export function Relations({ detail, reload }: { detail: PersonDetail; reload(): void }) {
  const ui = usePeople();
  const [adding, setAdding] = useState(false);
  const save = useSave<Saved<Relation>>('save_relation');
  const announce = useAnnounce();
  if (!detail.relations.length && !ui.data.canWrite) return null;
  return (
    <section className="pe-fields__group" aria-label="Relationships">
      <div className="pe-fields__head"><span>Relationships</span>{ui.data.canWrite && <Button size="sm" variant="quiet" onClick={() => setAdding(true)}>Add</Button>}</div>
      {detail.relations.length ? (
        <ul className="pe-relations">
          {detail.relations.map((relation) => (
            <li key={`${relation.id}:${relation.direction}`} className="pe-relation">
              <span className="pe-relation__label">{relation.label}</span>
              <span className="pe-relation__who">
                {relation.person ? <NameLink kind="person" id={relation.person.id} name={relation.person.name} /> : <span>{relation.name}</span>}
                {relation.note && <span className="pe-small pe-muted"> {relation.note}</span>}
              </span>
              {ui.data.canWrite && (
                <button type="button" className="pe-relation__remove" aria-label={`Remove ${relation.label.toLowerCase()} ${relation.name}`} onClick={async () => {
                  const result = await save.run({ id: relation.id, expectedRevision: relation.revision, archived: true });
                  save.reset();
                  announce(result.status === 'saved' ? 'Relationship removed' : 'This changed. Showing the latest');
                  reload();
                }}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="pe-small pe-muted">Partner, family, friends, who introduced you.</p>}
      {save.error && <InlineError>{save.error}</InlineError>}
      {adding && <RelationDialog personId={detail.person.id} personName={detail.person.name} onClose={(changed) => { setAdding(false); if (changed) reload(); }} />}
    </section>
  );
}

function RelationDialog({ personId, personName, onClose }: { personId: string; personName: string; onClose(changed: boolean): void }) {
  const people = useQuery<{ items: { id: string; name: string }[] }>('list_people', { limit: 100 });
  const [kind, setKind] = useState<RelationKind>('introduced_by');
  const [who, setWho] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const save = useSave<Saved<Relation>>('save_relation');
  const options = (people.data?.items ?? []).filter((item) => item.id !== personId);
  const first = personName.split(/\s+/)[0] ?? personName;
  return (
    <Dialog open title={`Add a relationship for ${first}`} description="Only what you know. Link someone in People, or name someone who isn't, such as a child." onClose={() => onClose(false)}
      footer={<ButtonRow align="end"><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" busy={save.pending} disabled={!who || (who === 'name' && !name.trim())} onClick={async () => {
        try {
          await save.run({ personId, kind, ...(who === 'name' ? { relatedName: name.trim() } : { relatedPersonId: who }), ...(note.trim() ? { note: note.trim() } : {}) }, 'Relationship added');
          onClose(true);
        } catch { /* shown below */ }
      }}>Add</Button></ButtonRow>}>
      <div className="pe-stack">
        <Select label={`${first} is`} value={kind} onChange={(value) => setKind(value as RelationKind)} options={KINDS.map((item) => ({ value: item.value, label: item.value === 'introduced_by' ? 'Introduced by' : `${item.label} of` }))} />
        <Select label="Who" value={who} onChange={setWho} placeholder="Choose a person" options={[...options.map((item) => ({ value: item.id, label: item.name })), { value: 'name', label: 'Someone not in People' }]} />
        {who === 'name' && <TextInput label="Name" value={name} onChange={setName} />}
        <TextInput label="Note" hint="Optional, such as Turns 7 in May" value={note} onChange={setNote} />
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}

