/**
 * The Sources screen every included app shares. It keeps three things
 * visibly separate: an account connected to Ri, access granted to this app,
 * and automatic updates for that account. It also separates Pause (stop
 * updates), Disconnect (managed in Ri, keeps records) and Delete imported
 * data (removes what this app imported, after confirmation).
 */
import { useId, useState, type ReactNode } from "react";
import { useAnnounce } from "./announce.js";
import { Button, ButtonRow } from "./button.js";
import { Dialog } from "./dialog.js";
import { EmptyState, StatusLabel, type Tone } from "./feedback.js";
import { DataTable } from "./data-display.js";
import { Select } from "./forms.js";
import { DangerIcon } from "./icons.js";
import { formatDateRange, formatInstant, plural, relativeDay, shortDateLabel } from "./format.js";
import { localDate, systemZone, todayIn } from "../time.js";
import { errorMessage, isLocalDateString } from "./util.js";

export type SourceStatus = "ready" | "importing" | "paused" | "reconnect" | "error" | "not_started";
export type HistoryDays = 30 | 90 | 365;
export interface SourceAccount {
  id: string;
  /** The account as people know it, such as "Personal Gmail". */
  label: string;
  /** A secondary line such as the address. Optional. */
  detail?: string;
  kind: "mail" | "calendar";
  /** Access to this account granted to this app. */
  granted: boolean;
  /** Automatic updates enabled for this account. */
  automatic: boolean;
  status: SourceStatus;
  /** Local dates covered by imported records. */
  coverage?: { from: string; to: string; partial: boolean };
  historyDays?: HistoryDays;
  lastSuccessAt?: string | null;
  pending?: number;
  failed?: number;
  error?: string | null;
}
export interface SourceImport { id: string; name: string; kind: string; importedAt: string; records: number; status: string }
export interface SourceShare { id: string; label: string; actor: string; sources: string[]; createdAt: string }
type MaybePromise = void | Promise<unknown>;

export interface SourcesScreenProps {
  accounts: SourceAccount[];
  imports: SourceImport[];
  shares?: SourceShare[];
  /** Start Ri's connection picker for a new or existing account. */
  onConnect(): MaybePromise;
  /** Open Ri's access controls, where accounts are granted, reconnected or disconnected. */
  onManageAccess(): MaybePromise;
  onPause(id: string): MaybePromise;
  onResume(id: string): MaybePromise;
  /** Run the next bounded import step now. */
  onContinue(id: string): MaybePromise;
  /** Delete what this app imported from an account or file. Called after confirmation. */
  onDeleteImported(id: string): MaybePromise;
  onChangeHistory?(id: string, days: HistoryDays): MaybePromise;
  onRevokeShare?(id: string): MaybePromise;
  /** App-specific guidance, such as what a mail search looks for. */
  note?: ReactNode;
  /** Zone for update times. Defaults to the system zone. */
  zone?: string;
  /** Reference time for "Today". Defaults to now. */
  now?: Date;
  headingLevel?: 2 | 3;
}

const STATUS: Record<SourceStatus, { tone: Tone; label: string }> = {
  ready: { tone: "success", label: "Up to date" },
  importing: { tone: "info", label: "Importing" },
  paused: { tone: "neutral", label: "Paused" },
  reconnect: { tone: "warning", label: "Reconnect needed" },
  error: { tone: "danger", label: "Update failed" },
  not_started: { tone: "neutral", label: "Not started" },
};
const KIND = { mail: "Email", calendar: "Calendar" } as const;
const IMPORT_TONES: Record<string, Tone> = { complete: "success", completed: "success", imported: "success", ready: "success", partial: "warning", processing: "info", importing: "info", pending: "info", failed: "danger", error: "danger" };
const sentence = (value: string) => value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

export function sourceStatusLabel(status: SourceStatus): { tone: Tone; label: string } {
  return STATUS[status];
}

/** The shared Sources screen. Pass only accounts the host reports for this app. */
export function SourcesScreen(props: SourcesScreenProps) {
  const { accounts, imports, shares, onConnect, onManageAccess, onRevokeShare, note, headingLevel = 2 } = props;
  const zone = props.zone ?? systemZone();
  const announce = useAnnounce();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; label: string; kind: "account" | "file" } | null>(null);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const Sub = headingLevel === 2 ? "h3" : "h4";
  const headingId = useId();

  const act = async (key: string, run: () => MaybePromise, done?: string) => {
    setBusy(key);
    setFailure(null);
    try {
      await run();
      if (done) announce(done);
      return true;
    } catch (error) {
      setFailure({ key, message: errorMessage(error, "That did not finish. Try again.") });
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ri-sources" aria-labelledby={headingId}>
      <div className="ri-stack">
        <div className="ri-sources__intro">
          <div>
            <Heading id={headingId} className="ri-h2">Sources</Heading>
            <p>Accounts this app can read, what it imported and which chats can use it.</p>
          </div>
          <ButtonRow>
            <Button onClick={() => void act("connect", onConnect)} busy={busy === "connect"}>Connect an account</Button>
            <Button variant="quiet" onClick={() => void act("manage", onManageAccess)} busy={busy === "manage"}>Manage access</Button>
          </ButtonRow>
        </div>
        <p className="ri-small ri-muted">
          Only accounts granted to this app appear here. Other accounts connected to Ri stay private to Ri until you grant them with Manage access.
        </p>
        {failure && (failure.key === "connect" || failure.key === "manage") && <p className="ri-inline-error" role="alert"><DangerIcon />{failure.message}</p>}
        {note && <div className="ri-small">{note}</div>}
      </div>

      <div className="ri-sources__group">
        <Sub className="ri-h3">Accounts</Sub>
        {accounts.length ? (
          accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              zone={zone}
              now={props.now}
              busy={busy}
              failure={failure}
              act={act}
              props={props}
              onDelete={() => setConfirm({ id: account.id, label: account.label, kind: "account" })}
              headingLevel={headingLevel === 2 ? 4 : 5}
            />
          ))
        ) : (
          <EmptyState compact headingLevel={3} title="No accounts granted to this app" action={<Button variant="primary" onClick={() => void act("connect", onConnect)}>Connect an account</Button>}>
            Files you import and records you add yourself work without an account. Connect one to keep this app up to date automatically.
          </EmptyState>
        )}
      </div>

      <div className="ri-sources__group">
        <Sub className="ri-h3">Imported files</Sub>
        {imports.length ? (
          <DataTable
            caption="Imported files"
            captionHidden
            rows={imports}
            rowKey="id"
            columns={[
              { key: "name", label: "File" },
              { key: "kind", label: "Type" },
              { key: "importedAt", label: "Imported", render: (row) => shortDateLabel(row.importedAt, zone) ?? "Not provided" },
              { key: "records", label: "Records", align: "end", render: (row) => new Intl.NumberFormat("en-US").format(row.records) },
              { key: "status", label: "Status", render: (row) => <StatusLabel tone={IMPORT_TONES[row.status] ?? "neutral"}>{sentence(row.status)}</StatusLabel> },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <Button variant="link" size="sm" className="ri-button--danger" aria-label={`Delete imported data from ${row.name}`} onClick={() => setConfirm({ id: row.id, label: row.name, kind: "file" })}>
                    Delete imported data
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <p className="ri-muted">No files imported yet. Imported files stay available offline.</p>
        )}
      </div>

      {shares && (
        <div className="ri-sources__group">
          <Sub className="ri-h3">Chats with access</Sub>
          {shares.length ? (
            <ul className="ri-share-list">
              {shares.map((share) => (
                <li className="ri-share" key={share.id}>
                  <div className="ri-share__text">
                    <strong>{share.label}</strong>
                    <span className="ri-small ri-muted">
                      {share.actor} · {share.sources.length ? share.sources.join(", ") : "No sources"} · Shared {shortDateLabel(share.createdAt, zone) ?? "earlier"}
                    </span>
                    {failure?.key === `revoke:${share.id}` && <span className="ri-inline-error" role="alert"><DangerIcon />{failure.message}</span>}
                  </div>
                  {onRevokeShare && (
                    <Button size="sm" busy={busy === `revoke:${share.id}`} onClick={() => void act(`revoke:${share.id}`, () => onRevokeShare(share.id), `Access removed for ${share.label}`)}>
                      Remove access
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ri-muted">No chat can use this app's records. Share from a chat's access settings in Ri.</p>
          )}
        </div>
      )}

      <dl className="ri-explainer" aria-label="What each source control does">
        <div>
          <dt>Pause updates</dt>
          <dd>Stops automatic imports for one account. Everything already imported stays, and you can resume at any time.</dd>
        </div>
        <div>
          <dt>Disconnect</dt>
          <dd>Done in Ri with Manage access. It stops all reads from the account and keeps the records already imported.</dd>
        </div>
        <div>
          <dt>Delete imported data</dt>
          <dd>Removes what this app imported from an account or file, and anything it learned only from them. Your own notes and corrections stay.</dd>
        </div>
      </dl>

      <Dialog
        open={Boolean(confirm)}
        title={confirm ? `Delete imported data from ${confirm.label}?` : ""}
        onClose={() => setConfirm(null)}
        busy={busy === "delete"}
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirm(null)} disabled={busy === "delete"}>Cancel</Button>
            <Button
              variant="danger-solid"
              busy={busy === "delete"}
              busyLabel="Deleting"
              onClick={async () => {
                if (!confirm) return;
                const ok = await act("delete", () => props.onDeleteImported(confirm.id), `Imported data deleted from ${confirm.label}`);
                if (ok) setConfirm(null);
              }}
            >
              Delete imported data
            </Button>
          </>
        }
      >
        <p>
          {confirm?.kind === "file"
            ? "This removes the records this app created from the file, and anything it learned only from it."
            : "This removes the messages and events this app imported from the account, and anything it learned only from them."}
        </p>
        <p className="ri-muted">
          Your own notes and corrections stay. {confirm?.kind === "account" ? "The account stays connected to Ri. To stop reading it, use Manage access." : "The original file is not changed."}
        </p>
        {failure?.key === "delete" && <p className="ri-inline-error" role="alert"><DangerIcon />{failure.message}</p>}
      </Dialog>
    </section>
  );
}

function AccountCard({ account, zone, now, busy, failure, act, props, onDelete, headingLevel }: {
  account: SourceAccount;
  zone: string;
  now?: Date;
  busy: string | null;
  failure: { key: string; message: string } | null;
  act: (key: string, run: () => MaybePromise, done?: string) => Promise<boolean>;
  props: SourcesScreenProps;
  onDelete(): void;
  headingLevel: 4 | 5;
}) {
  const status = STATUS[account.status];
  const Heading = headingLevel === 4 ? "h4" : "h5";
  const headingId = useId();
  const key = (action: string) => `${action}:${account.id}`;
  const today = todayIn(zone, now);
  const lastUpdate = (() => {
    if (!account.lastSuccessAt) return "No successful update yet";
    try {
      const day = isLocalDateString(account.lastSuccessAt) ? account.lastSuccessAt : localDate(account.lastSuccessAt, zone);
      const relative = relativeDay(day, today);
      if (isLocalDateString(account.lastSuccessAt)) return relative ?? shortDateLabel(day) ?? account.lastSuccessAt;
      return relative ? `${relative}, ${formatInstant(account.lastSuccessAt, zone, { date: "none" })}` : formatInstant(account.lastSuccessAt, zone);
    } catch {
      return "Not available";
    }
  })();
  const coverage = account.coverage && isLocalDateString(account.coverage.from) && isLocalDateString(account.coverage.to) ? formatDateRange(account.coverage.from, account.coverage.to) : null;
  const pending = account.pending ?? 0, failed = account.failed ?? 0;
  const canContinue = account.status === "not_started" || account.status === "importing" || pending > 0 || Boolean(account.coverage?.partial);
  const accountFailure = failure && failure.key.endsWith(`:${account.id}`) ? failure.message : null;

  return (
    <article className="ri-account" aria-labelledby={headingId}>
      <div className="ri-account__head">
        <div className="ri-account__name">
          <Heading id={headingId} className="ri-h3">{account.label}</Heading>
          <span className="ri-account__kind">{KIND[account.kind]}{account.detail ? ` · ${account.detail}` : ""}</span>
        </div>
        <StatusLabel tone={status.tone}>{status.label}</StatusLabel>
      </div>

      <dl className="ri-account__facts">
        <div className="ri-account__fact">
          <dt>Access</dt>
          <dd>{account.granted ? "Granted to this app" : "Not granted to this app"}</dd>
        </div>
        <div className="ri-account__fact">
          <dt>Automatic updates</dt>
          <dd>{account.automatic ? "On" : "Off"}</dd>
        </div>
        <div className="ri-account__fact">
          <dt>History</dt>
          <dd>{account.historyDays ? `Last ${account.historyDays} days` : "Not chosen"}</dd>
        </div>
        <div className="ri-account__fact">
          <dt>Covers</dt>
          <dd>
            {coverage ?? "Nothing imported yet"}
            {account.coverage?.partial && <StatusLabel tone="warning">Partial</StatusLabel>}
          </dd>
        </div>
        <div className="ri-account__fact">
          <dt>Last successful update</dt>
          <dd>{lastUpdate}</dd>
        </div>
        <div className="ri-account__fact">
          <dt>Waiting</dt>
          <dd>
            {pending ? plural(pending, "item to import", "items to import") : "Nothing waiting"}
            {failed > 0 && <StatusLabel tone="danger">{plural(failed, "item failed", "items failed")}</StatusLabel>}
          </dd>
        </div>
      </dl>

      {account.coverage?.partial && (
        <p className="ri-small ri-muted">Coverage is partial. Older items in the history range may be missing until the import finishes.</p>
      )}
      {!account.granted && (
        <p className="ri-small ri-muted">This account is connected to Ri but this app cannot read it. Use Manage access to grant it.</p>
      )}
      {account.error && (
        <p className="ri-account__error"><DangerIcon /><span>{account.error}</span></p>
      )}
      {accountFailure && <p className="ri-inline-error" role="alert"><DangerIcon /><span>{accountFailure}</span></p>}

      <div className="ri-account__actions">
        {account.status === "reconnect" && (
          <Button variant="primary" busy={busy === key("reconnect")} onClick={() => void act(key("reconnect"), props.onManageAccess)}>Reconnect in Ri</Button>
        )}
        {account.automatic ? (
          <Button busy={busy === key("pause")} onClick={() => void act(key("pause"), () => props.onPause(account.id), `Updates paused for ${account.label}`)}>Pause updates</Button>
        ) : (
          <Button busy={busy === key("resume")} disabled={!account.granted} onClick={() => void act(key("resume"), () => props.onResume(account.id), `Updates resumed for ${account.label}`)}>
            {account.status === "not_started" ? "Turn on updates" : "Resume updates"}
          </Button>
        )}
        {canContinue && account.granted && (
          <Button busy={busy === key("continue")} onClick={() => void act(key("continue"), () => props.onContinue(account.id), `Import continued for ${account.label}`)}>
            {account.status === "not_started" ? "Start import" : "Continue import"}
          </Button>
        )}
        {props.onChangeHistory && (
          <Select
            label="History range"
            value={String(account.historyDays ?? "")}
            placeholder={account.historyDays ? undefined : "Choose"}
            options={[{ value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last 365 days" }]}
            disabled={busy === key("history")}
            onChange={(value) => {
              const days = Number(value) as HistoryDays;
              if ([30, 90, 365].includes(days)) void act(key("history"), () => props.onChangeHistory!(account.id, days), `History set to ${days} days for ${account.label}`);
            }}
          />
        )}
        <Button variant="link" size="sm" className="ri-button--danger ri-account__delete" onClick={onDelete}>Delete imported data</Button>
      </div>
    </article>
  );
}
