import type { SaveSkillBody, SaveSkillResult, SkillView } from '@/lib/api/skills';
import { apiErrorBody, apiErrorStatus, apiErrorText } from '@/lib/api/client';

export type SkillEditMode = 'fields' | 'file';
type Draft = Pick<SkillView, 'body' | 'content'> & { description: string };
type Retained = { mode: SkillEditMode; draft: Draft; hash: string };
const draftOf = (skill: SkillView): Draft => ({ body: skill.body, content: skill.content, description: skill.description ?? '' });
const differs = (mode: SkillEditMode, draft: Draft, skill: SkillView) => mode === 'file' ? draft.content !== skill.content : draft.body !== skill.body || draft.description !== (skill.description ?? '');

/** Serial, hash-checked saves for the existing skill editor. Retained text is
 * offered explicitly, and every write remains bound to its captured author. */
export class SkillFileSaver {
  private value: { saved: SkillView; draft: Draft; mode: SkillEditMode; saving: boolean; conflict: SkillView | null; error: string | null; recovery: Retained | null };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private key: string;
  constructor(skill: SkillView, private keyFor: (ref: string) => string,
    private storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    private write: (ref: string, body: SaveSkillBody) => Promise<SaveSkillResult>,
    private read: (ref: string) => Promise<SkillView>, private acknowledged: (result: SaveSkillResult) => void) {
    this.key = keyFor(skill.ref);
    this.value = { saved: skill, draft: draftOf(skill), mode: skill.frontmatterError ? 'file' : 'fields', saving: false, conflict: null, error: null, recovery: null };
    try {
      const text = storage().getItem(this.key);
      if (text) {
        const retained = JSON.parse(text) as Retained;
        if (!['file', 'fields'].includes(retained.mode) || typeof retained.hash !== 'string' || !retained.draft || !['description', 'body', 'content'].every(key => typeof retained.draft[key as keyof Draft] === 'string')) throw new Error('Invalid retained draft');
        if (differs(retained.mode, retained.draft, skill)) this.value.recovery = retained;
        else storage().removeItem(this.key);
      }
    } catch { this.value.error = 'Could not read the retained draft. It was left in storage.'; }
  }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { this.value = { ...this.value }; for (const listener of this.listeners) listener(); }
  hasUnsaved = () => differs(this.value.mode, this.value.draft, this.value.saved);
  retainDraft = () => {
    if (!this.hasUnsaved()) return;
    this.storage().setItem(this.key, JSON.stringify({ mode: this.value.mode, draft: this.value.draft, hash: this.value.saved.hash } satisfies Retained));
  };
  private retain() { try { this.retainDraft(); } catch { this.value.error = 'Could not retain your draft. Keep this window open until changes are saved.'; } }
  edit(patch: Partial<Draft>) {
    if (!this.value.saved.editable || this.value.recovery) return;
    this.value.draft = { ...this.value.draft, ...patch }; this.retain(); this.changed();
    clearTimeout(this.timer);
    if (!this.value.conflict) this.timer = setTimeout(() => void this.flush().catch(() => {}), 800);
  }
  observe(skill: SkillView) {
    if (skill.ref !== this.value.saved.ref) return;
    if (skill.editable !== this.value.saved.editable) { this.value.saved = { ...this.value.saved, editable: skill.editable }; this.changed(); }
    if (skill.hash === this.value.saved.hash || this.running) return;
    if (this.hasUnsaved()) this.value.conflict = skill;
    else { this.value.saved = skill; this.value.draft = draftOf(skill); }
    this.changed();
  }
  async switchMode(mode: SkillEditMode) {
    if (mode === this.value.mode) return;
    await this.flush();
    this.value.mode = mode; this.value.draft = draftOf(this.value.saved); this.changed();
  }
  discardRecovery() { this.storage().removeItem(this.key); this.value.recovery = null; this.changed(); }
  restore() {
    const retained = this.value.recovery;
    if (!retained || !this.value.saved.editable) return;
    this.value.recovery = null; this.value.draft = retained.draft; this.value.mode = retained.mode;
    if (retained.hash !== this.value.saved.hash) this.value.conflict = this.value.saved;
    this.retain(); this.changed();
    if (!this.value.conflict) void this.flush().catch(() => {});
  }
  takeTheirs() {
    if (!this.value.conflict) return;
    this.value.saved = this.value.conflict; this.value.draft = draftOf(this.value.saved); this.value.conflict = null;
    try { this.storage().removeItem(this.key); } catch { /* A surviving copy still needs explicit recovery. */ }
    this.changed();
  }
  keepMine() {
    if (!this.value.conflict) return;
    this.value.saved = this.value.conflict; this.value.conflict = null; this.retain(); this.changed();
    void this.flush().catch(() => {});
  }
  flush = async (): Promise<void> => {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (!this.hasUnsaved()) return;
    if (!this.value.saved.editable || this.value.conflict || this.value.recovery) throw new Error('Resolve this skill draft before leaving.');
    this.value.saving = true; this.value.error = null; this.changed();
    this.running = (async () => {
      while (this.hasUnsaved()) {
        const { draft: sent, saved, mode } = this.value;
        const result = await this.write(saved.ref, { ...(mode === 'file' ? { content: sent.content } : { description: sent.description, body: sent.body }), baseHash: saved.hash });
        const now = this.value.draft, fresh = draftOf(result.skill);
        this.value.saved = result.skill;
        this.value.draft = { description: now.description === sent.description ? fresh.description : now.description, body: now.body === sent.body ? fresh.body : now.body, content: now.content === sent.content ? fresh.content : now.content };
        const previousKey = this.key; this.key = this.keyFor(result.skill.ref);
        if (this.hasUnsaved()) this.retain();
        else { try { this.storage().removeItem(this.key); } catch { /* A surviving draft never replays automatically. */ } }
        if (this.key !== previousKey) { try { this.storage().removeItem(previousKey); } catch { /* Retain the former identity for explicit recovery. */ } }
        this.acknowledged(result); this.changed();
      }
    })();
    try { await this.running; }
    catch (error) {
      if (apiErrorStatus(error) === 409 && (apiErrorBody(error) as { code?: string } | null)?.code === 'stale') {
        this.value.conflict = await this.read(this.value.saved.ref).catch(() => null);
      }
      this.value.error = apiErrorText(error); this.retain(); throw error;
    } finally { this.running = undefined; this.value.saving = false; this.changed(); }
  };
  dispose() { clearTimeout(this.timer); this.listeners.clear(); }
}
