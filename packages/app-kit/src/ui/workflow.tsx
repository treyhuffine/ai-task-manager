/**
 * Ri workflow composites shared by included apps. They are presentational:
 * the app passes its records and callbacks, and the components keep the
 * wording and safety cues consistent. Nothing here sends a message, books,
 * applies or invites. Follow-ups create one Ri task only after confirmation.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useOptionalRiApp } from "./app.js";
import { useAnnounce } from "./announce.js";
import { Button, ButtonRow, type ButtonSize, type ButtonVariant } from "./button.js";
import { Dialog } from "./dialog.js";
import { InlineError, StatusLabel } from "./feedback.js";
import { Checkbox, DateInput, TextInput } from "./forms.js";
import { formatDate } from "./format.js";
import { WarningIcon } from "./icons.js";
import { errorMessage, isLocalDateString } from "./util.js";

export interface AskRiButtonProps {
  /** Editable text staged in Ri's chat composer. Never sent automatically. */
  prompt: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}
/** Stages a question in Ri's native chat. The person edits and sends it. */
export function AskRiButton({ prompt, children = "Ask Ri", variant = "secondary", size, className }: AskRiButtonProps) {
  const app = useOptionalRiApp();
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="ri-ask">
      <Button
        variant={variant}
        size={size}
        className={className}
        busy={busy}
        busyLabel="Opening chat"
        onClick={async () => {
          if (!app) {
            setError("Chat is not available here");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await app.ask(prompt);
            announce("Question added to Ri chat. Review it, then send.", { visual: false });
          } catch (failure) {
            setError(errorMessage(failure, "Ri chat could not open"));
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </Button>
      {error && <InlineError>{error}</InlineError>}
    </span>
  );
}

export interface CreatedFollowUp { title: string; dueAt?: string | null }
export interface FollowUpDialogProps {
  open: boolean;
  defaultTitle: string;
  /** Offer an optional due date. */
  allowDueDate: boolean;
  /** Create the Ri task. Use a `useMutation` so a retry reuses the invocation ID. */
  onCreate(title: string, dueDate: string | null): Promise<unknown>;
  /** The created task, once known. Shows the created state. */
  created?: CreatedFollowUp | null;
  onClose(): void;
  /** What the task is linked to, such as "Riverside House". */
  subject?: ReactNode;
  defaultDueDate?: string | null;
}
/**
 * Preview a follow-up, then create one Ri task. Explains that it only creates
 * a task and sends nothing. After success it shows the created task.
 */
export function FollowUpDialog({ open, defaultTitle, allowDueDate, onCreate, created, onClose, subject, defaultDueDate = null }: FollowUpDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [dueDate, setDueDate] = useState<string | null>(defaultDueDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [localCreated, setLocalCreated] = useState<CreatedFollowUp | null>(null);
  const announce = useAnnounce();
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDueDate(defaultDueDate);
    setError(null);
    setTitleError(null);
    setLocalCreated(null);
  }, [open, defaultTitle, defaultDueDate]);
  const done = created ?? localCreated;
  const doneRef = useRef<HTMLButtonElement>(null);
  // The Create button disappears on success, so move focus to Done.
  useEffect(() => {
    if (open && done) doneRef.current?.focus();
  }, [open, Boolean(done)]);
  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError("Add a title for the task");
      return;
    }
    setTitleError(null);
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed, allowDueDate ? dueDate : null);
      setLocalCreated({ title: trimmed, dueAt: allowDueDate ? dueDate : null });
      announce("Task created in Ri");
    } catch (failure) {
      setError(errorMessage(failure, "The task was not created. Try again."));
    } finally {
      setBusy(false);
    }
  };
  const dueText = (value?: string | null) => (value && isLocalDateString(value) ? formatDate(value, "medium") : value || null);
  return (
    <Dialog
      open={open}
      title={done ? "Task created in Ri" : "Create a follow-up"}
      description={done ? undefined : "Creates one task in Ri, linked to this record. Nothing is sent to anyone."}
      onClose={onClose}
      busy={busy}
      footer={
        done ? (
          <Button ref={doneRef} variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" busy={busy} busyLabel="Creating task" onClick={submit}>{error ? "Try again" : "Create task"}</Button>
          </>
        )
      }
    >
      {done ? (
        <div className="ri-stack ri-stack--tight" role="status">
          <StatusLabel tone="success">Created</StatusLabel>
          <div className="ri-followup__preview">
            <strong>{done.title}</strong>
            <span className="ri-small ri-muted">{dueText(done.dueAt) ? `Due ${dueText(done.dueAt)}` : "No due date"}{subject ? <> · Linked to {subject}</> : null}</span>
          </div>
          <p className="ri-small ri-muted">Find it in your Ri tasks. Opening this again will not create a second task.</p>
        </div>
      ) : (
        <>
          {subject && <p className="ri-small ri-muted">Linked to {subject}</p>}
          <TextInput label="Task title" value={title} onChange={setTitle} error={titleError} required maxLength={200} />
          {allowDueDate && <DateInput label="Due date" hint="Optional" value={dueDate} onChange={setDueDate} />}
          {error && <InlineError>{error}</InlineError>}
        </>
      )}
    </Dialog>
  );
}

export interface ConflictField { label: ReactNode; mine: ReactNode; current: ReactNode }
export interface ConflictNoticeProps {
  fields: ConflictField[];
  /** Discard your edits and show the current record. */
  onUseCurrent(): void;
  /** Save your edits over the current record, with its new revision. */
  onKeepMine(): void | Promise<unknown>;
  busy?: boolean;
  title?: ReactNode;
}
/** A stale edit: compare your values with the current record, then choose. */
export function ConflictNotice({ fields, onUseCurrent, onKeepMine, busy, title = "This record changed since you opened it" }: ConflictNoticeProps) {
  const headingId = useId();
  return (
    <section className="ri-conflict" role="alert" aria-labelledby={headingId}>
      <div className="ri-conflict__head">
        <WarningIcon className="ri-conflict__marker" />
        <div>
          <h3 id={headingId} className="ri-h3">{title}</h3>
          <p className="ri-small ri-muted">Your changes were not saved. Compare them with the current values, then choose which to keep.</p>
        </div>
      </div>
      <CompareTable rows={fields.map((field) => ({ label: field.label, before: field.mine, after: field.current }))} beforeLabel="Your change" afterLabel="Current value" caption="Your changes compared with the current record" />
      <ButtonRow>
        <Button variant="primary" onClick={() => void onKeepMine()} busy={busy} busyLabel="Saving">Keep my changes</Button>
        <Button onClick={onUseCurrent} disabled={busy}>Use current values</Button>
      </ButtonRow>
    </section>
  );
}

export interface CompareRow { label: ReactNode; before: ReactNode; after: ReactNode }
function CompareTable({ rows, beforeLabel, afterLabel, caption, markChanges }: { rows: CompareRow[]; beforeLabel: string; afterLabel: string; caption: string; markChanges?: boolean }) {
  return (
    <div className="ri-compare-wrap">
      <table className="ri-compare">
        <caption className="ri-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">{beforeLabel}</th>
            <th scope="col">{afterLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const changed = markChanges && plainText(row.before) !== plainText(row.after);
            return (
              <tr key={index}>
                <th scope="row">{row.label}</th>
                <td data-label={beforeLabel}>{row.before ?? "Not provided"}</td>
                <td data-label={afterLabel} className={changed ? "ri-compare__changed" : undefined}>
                  {row.after ?? "Not provided"}
                  {changed && <span className="ri-compare__marker">Changed</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
const plainText = (value: ReactNode) => (typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value ?? null));

export interface ReviewCompareProps {
  title: ReactNode;
  /** Why this needs review, such as "Your hotel sent a revised check-in time." */
  reason: ReactNode;
  rows: CompareRow[];
  /** Source evidence, usually a `SourceLine` or excerpt. */
  evidence?: ReactNode;
  onAccept(): void | Promise<unknown>;
  onEdit?: () => void;
  onDismiss(): void | Promise<unknown>;
  beforeLabel?: string;
  afterLabel?: string;
  acceptLabel?: string;
  busy?: "accept" | "dismiss" | null;
  headingLevel?: 2 | 3;
}
/** A proposed change from a source: recorded and proposed values, evidence, then Accept, Edit or Dismiss. */
export function ReviewCompare({ title, reason, rows, evidence, onAccept, onEdit, onDismiss, beforeLabel = "Recorded", afterLabel = "Proposed", acceptLabel = "Accept change", busy = null, headingLevel = 3 }: ReviewCompareProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = useId();
  return (
    <article className="ri-review ri-card" aria-labelledby={headingId}>
      <div className="ri-review__head">
        <div>
          <Heading id={headingId} className="ri-h3">{title}</Heading>
          <p className="ri-review__reason">{reason}</p>
        </div>
        <StatusLabel tone="warning">Needs review</StatusLabel>
      </div>
      <CompareTable rows={rows} beforeLabel={beforeLabel} afterLabel={afterLabel} caption={`${beforeLabel} and ${afterLabel.toLowerCase()} values`} markChanges />
      {evidence && <div>{evidence}</div>}
      <ButtonRow>
        <Button variant="primary" onClick={() => void onAccept()} busy={busy === "accept"} disabled={busy === "dismiss"} busyLabel="Saving">{acceptLabel}</Button>
        {onEdit && <Button onClick={onEdit} disabled={Boolean(busy)}>Edit</Button>}
        <Button variant="quiet" onClick={() => void onDismiss()} busy={busy === "dismiss"} disabled={busy === "accept"} busyLabel="Dismissing">Dismiss</Button>
      </ButtonRow>
    </article>
  );
}

export interface ShareSource { id: string; label: ReactNode; description?: ReactNode; textLabel?: string }
export interface ShareOperation { id: "read" | "write"; label: ReactNode; description?: ReactNode }
export interface ShareScopeChooserProps {
  sources: ShareSource[];
  operations: ShareOperation[];
  /** Who receives access, such as "This chat" or "Trip planning chat". */
  actorLabel: string;
  onCreate(selectedSourceIds: string[], operations: ("read" | "write")[]): Promise<void>;
  busy?: boolean;
  error?: string | null;
}
/**
 * The owner chooses which accounts or collections a chat may use and what it
 * may do. Nothing is selected by default and nothing is shared until confirmed.
 */
export function ShareScopeChooser({ sources, operations, actorLabel, onCreate, busy, error }: ShareScopeChooserProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [allowed, setAllowed] = useState<("read" | "write")[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...list.filter((item) => item !== value), value] : list.filter((item) => item !== value));
  const sourceNames = sources.filter((source) => selected.includes(source.id)).map((source) => source.textLabel ?? (typeof source.label === "string" ? source.label : "a selected source"));
  const verbs = allowed.includes("write") ? (allowed.includes("read") ? "read and change records from" : "change records from") : "read";
  const headingId = useId();
  return (
    <section className="ri-scope" aria-labelledby={headingId}>
      <div className="ri-stack ri-stack--tight">
        <h2 id={headingId} className="ri-h2">Choose what {actorLabel} can use</h2>
        <p className="ri-muted">Nothing is shared until you choose it. You can change or remove this access later in Ri.</p>
      </div>
      <fieldset className="ri-fieldset">
        <legend>Accounts and collections</legend>
        {sources.length ? (
          sources.map((source) => (
            <div className="ri-scope__option" key={source.id}>
              <Checkbox label={source.label} hint={source.description} checked={selected.includes(source.id)} onChange={(on) => setSelected((list) => toggle(list, source.id, on))} />
            </div>
          ))
        ) : (
          <p className="ri-muted">This app has no accounts or collections to share yet.</p>
        )}
      </fieldset>
      <fieldset className="ri-fieldset">
        <legend>What it may do</legend>
        {operations.map((operation) => (
          <Checkbox key={operation.id} label={operation.label} hint={operation.description} checked={allowed.includes(operation.id)} onChange={(on) => setAllowed((list) => toggle(list, operation.id, on))} />
        ))}
      </fieldset>
      <p className="ri-scope__summary" aria-live="polite">
        {selected.length && allowed.length
          ? `${actorLabel} will be able to ${verbs} ${new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(sourceNames)}.`
          : `${actorLabel} has no access yet.`}
      </p>
      {(problem || error) && <InlineError>{problem ?? error}</InlineError>}
      <ButtonRow>
        <Button
          variant="primary"
          busy={busy}
          busyLabel="Sharing"
          onClick={async () => {
            if (!selected.length) return setProblem("Choose at least one account or collection");
            if (!allowed.length) return setProblem("Choose what it may do");
            setProblem(null);
            try {
              await onCreate(selected, allowed);
            } catch (failure) {
              setProblem(errorMessage(failure, "Access was not shared. Try again."));
            }
          }}
        >
          Share selected
        </Button>
      </ButtonRow>
    </section>
  );
}
