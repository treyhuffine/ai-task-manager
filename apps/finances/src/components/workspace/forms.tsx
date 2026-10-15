import { useState } from "react";
import {
  Check,
  FileUp,
  Mail,
  Wallet,
  CreditCard,
  ArrowUpRight,
} from "lucide-react";
import { currencyDigits, parseMoney } from "@/lib/finance/money";
import type { Account, FinanceClient, Home } from "./types";
import type { z } from "zod/v4";
import type { transactionSchema } from "@/lib/finance/contracts";
import type { capabilitiesSchema } from "@/lib/connectors/contracts";
import {
  dateLabel,
  Empty,
  ErrorMessage,
  Form,
  label,
  Modal,
  money,
  MoneyInput,
  useOperation,
} from "./ui";

type Finish = () => Promise<void>;
const decimal = (minor: number | null, currency: string) =>
  minor === null
    ? ""
    : (minor / 10 ** currencyDigits(currency)).toFixed(
        currencyDigits(currency),
      );
export function AccountDialog({
  home,
  client,
  account,
  onClose,
  onDone,
}: {
  home: Home;
  client: FinanceClient;
  account?: Account;
  onClose: () => void;
  onDone: Finish;
}) {
  const [name, setName] = useState(account?.name ?? ""),
    [kind, setKind] = useState("cash"),
    [currency, setCurrency] = useState(
      account?.currency ?? home.settings?.currency ?? "USD",
    ),
    [balance, setBalance] = useState(
      account ? decimal(account.balanceMinor, account.currency) : "",
    ),
    [pending, setPending] = useState(account?.balanceIncludesPending ?? false);
  const [sourceId] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useOperation();
  return (
    <Modal
      title={account ? "Update balance" : "Add a manual account"}
      onClose={onClose}
      busy={busy}
    >
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const balanceMinor = balance.trim()
              ? parseMoney(balance, currency)
              : null;
            if (home.settings && !home.settings.restoreReviewed)
              throw new Error(
                "Review and enable the restored data from the overview first.",
              );
            if (!home.settings?.enabled)
              await client.call("finance_setup", {
                enabled: true,
                currency,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                restoreReviewed: true,
              });
            if (account)
              await client.call("finance_update_manual_account", {
                id: account.id,
                balanceMinor,
                balanceIncludesPending: pending,
              });
            else
              await client.call("finance_create_account", {
                name,
                kind,
                provider: "manual",
                currency,
                connectionId: null,
                sourceId,
                balanceMinor,
                balanceIncludesPending: pending,
                historyStart: null,
                asOf: balanceMinor === null ? null : new Date().toISOString(),
              });
            await onDone();
            onClose();
          });
        }}
      >
        <div className="modal-body">
          <p className="muted">
            {account
              ? "Keep the latest balance here. Transaction entries do not change this snapshot."
              : "Start with an account you update yourself. You can add transactions or import a statement next."}
          </p>
          {!account && (
            <>
              <div className="choice-grid">
                {[
                  ["cash", "Cash & savings", Wallet],
                  ["credit", "Credit card", CreditCard],
                ].map(([v, text, Icon]) => (
                  <button
                    type="button"
                    key={v as string}
                    className={"choice" + (kind === v ? " active" : "")}
                    onClick={() => setKind(v as string)}
                  >
                    {typeof Icon !== "string" && <Icon size={22} />}
                    <span>{text as string}</span>
                    {kind === v && <Check size={14} />}
                  </button>
                ))}
              </div>
              <label className="field">
                Account name
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    kind === "cash"
                      ? "Everyday checking"
                      : "Everyday credit card"
                  }
                  required
                  maxLength={160}
                />
              </label>
            </>
          )}
          <div className="form-grid">
            <MoneyInput
              name="balance"
              label={
                (account?.kind ?? kind) === "credit"
                  ? "Current amount owed"
                  : "Current balance"
              }
              value={balance}
              onChange={setBalance}
              required={false}
            />
            <label className="field">
              Currency
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={!!account}
              >
                {[
                  ...new Set([
                    currency,
                    "USD",
                    "CAD",
                    "EUR",
                    "GBP",
                    "AUD",
                    "JPY",
                    "INR",
                    "CHF",
                    "KWD",
                  ]),
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={pending}
              onChange={(e) => setPending(e.target.checked)}
            />
            This balance includes pending activity
          </label>
          <ErrorMessage message={error} />
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : account ? "Update balance" : "Add account"}
          </button>
        </div>
      </Form>
    </Modal>
  );
}

export function EntryDialog({
  accounts,
  client,
  onClose,
  onDone,
}: {
  accounts: Account[];
  client: FinanceClient;
  onClose: () => void;
  onDone: Finish;
}) {
  const manual = accounts.filter(
    (a) => a.provider === "manual" && a.access === "connected",
  );
  const [accountId, setAccountId] = useState(manual[0]?.id ?? ""),
    [amount, setAmount] = useState(""),
    [merchant, setMerchant] = useState(""),
    [category, setCategory] = useState("other"),
    [kind, setKind] = useState("purchase"),
    [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [key] = useState(() => crypto.randomUUID()),
    [sourceId] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useOperation();
  const account = manual.find((a) => a.id === accountId);
  return (
    <Modal title="Add a transaction" onClose={onClose} busy={busy}>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (!account) throw new Error("Add a manual account first.");
            const value = parseMoney(amount, account.currency);
            if (value <= 0)
              throw new Error("Enter an amount greater than zero.");
            await client.call("finance_record_transaction", {
              data: {
                accountId,
                sourceId,
                amountMinor: ["income", "refund"].includes(kind)
                  ? -value
                  : value,
                currency: account.currency,
                postedOn: date,
                authorizedOn: null,
                merchant,
                category,
                kind,
                state: "posted",
                pendingSourceId: null,
                obligationId: null,
                refundOf: null,
              },
              mutationKey: key,
            });
            await onDone();
            onClose();
          });
        }}
      >
        <div className="modal-body">
          <label className="field">
            Account
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              {manual.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Merchant or description
            <input
              autoFocus
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              required
              maxLength={300}
            />
          </label>
          <div className="form-grid">
            <MoneyInput
              name="amount"
              label={"Amount (" + (account?.currency ?? "USD") + ")"}
              value={amount}
              onChange={setAmount}
            />
            <label className="field">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
            <label className="field">
              Type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {[
                  "purchase",
                  "income",
                  "refund",
                  "transfer",
                  "card_payment",
                  "interest",
                  "fee",
                ].map((k) => (
                  <option key={k} value={k}>
                    {label(k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Category
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                maxLength={80}
              />
            </label>
          </div>
          <p className="hint">
            Adds a local record. Your account balance stays at its last recorded
            value.
          </p>
          <ErrorMessage message={error} />
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy || !account}>
            {busy ? "Saving…" : "Add transaction"}
          </button>
        </div>
      </Form>
    </Modal>
  );
}

type CsvPreview = { count: number; rows: z.infer<typeof transactionSchema>[] };
export function ImportDialog({
  accounts,
  client,
  initialAccountId,
  onClose,
  onDone,
}: {
  accounts: Account[];
  client: FinanceClient;
  initialAccountId?: string;
  onClose: () => void;
  onDone: Finish;
}) {
  const manual = accounts.filter(
    (a) => a.provider === "manual" && a.access === "connected",
  );
  const [accountId, setAccountId] = useState(
      initialAccountId ?? manual[0]?.id ?? "",
    ),
    [text, setText] = useState(""),
    [positive, setPositive] = useState(true),
    [filename, setFilename] = useState(""),
    [preview, setPreview] = useState<CsvPreview | null>(null);
  const { busy, error, run } = useOperation();
  const clear = () => setPreview(null);
  return (
    <Modal title="Import transactions" onClose={onClose} busy={busy} wide>
      <div className="modal-body">
        <p className="muted">
          Choose a CSV statement or paste rows. Review the preview before
          anything is saved.
        </p>
        <label className="field">
          Import into
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              clear();
            }}
          >
            {manual.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </label>
        <div className="file-drop">
          <FileUp size={26} />
          <div>
            <strong>{filename || "Choose a CSV file"}</strong>
            <p>date, merchant, amount, category, kind</p>
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const file = await client.selectFile();
                if (file) {
                  const bytes = Uint8Array.from(atob(file.base64), (c) =>
                    c.charCodeAt(0),
                  );
                  setText(new TextDecoder().decode(bytes));
                  setFilename(file.name);
                  clear();
                }
              })
            }
          >
            Choose file
          </button>
        </div>
        <label className="field">
          Or paste CSV
          <textarea
            rows={5}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              clear();
            }}
            placeholder={
              "date,merchant,amount,category,kind\n2026-10-01,Grocer,42.50,groceries,purchase\n2026-10-01,Payday,-2500,income,income"
            }
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={positive}
            onChange={(e) => {
              setPositive(e.target.checked);
              clear();
            }}
          />
          Positive amounts are money spent
        </label>
        <p className="hint">
          The optional kind column can identify income, refunds, transfers and
          card payments. Without it, money received is classified as a refund.
          Reimporting identical rows will not duplicate them.
        </p>
        <ErrorMessage message={error} />
        {preview && (
          <section className="preview-box">
            <h3>{preview.count} transactions ready to import</h3>
            <p className="hint">
              {preview.count > 10 ? "Showing the first 10. " : ""}Balances are
              not changed by importing.
            </p>
            {preview.rows.map((t, i) => (
              <div className="preview-row" key={i}>
                <span>{dateLabel(t.postedOn)}</span>
                <strong>{t.merchant}</strong>
                <small>{label(t.kind)}</small>
                <span>{money(t.amountMinor, t.currency)}</span>
              </div>
            ))}
          </section>
        )}
      </div>
      <div className="modal-foot">
        <button className="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        {preview ? (
          <button
            className="button primary"
            disabled={busy || !preview.count}
            onClick={() =>
              void run(async () => {
                await client.call("finance_import_csv", {
                  accountId,
                  text,
                  positiveMeansSpending: positive,
                });
                await onDone();
                onClose();
              })
            }
          >
            {busy ? "Importing…" : "Import " + preview.count + " transactions"}
          </button>
        ) : (
          <button
            className="button primary"
            disabled={busy || !text.trim() || !accountId}
            onClick={() =>
              void run(async () => {
                setPreview(
                  await client.call<CsvPreview>("finance_csv_preview", {
                    accountId,
                    text,
                    positiveMeansSpending: positive,
                  }),
                );
              })
            }
          >
            {busy ? "Checking…" : "Preview import"}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function ConnectionsDialog({
  client,
  home,
  onClose,
  onDone,
}: {
  client: FinanceClient;
  home: Home;
  onClose: () => void;
  onDone: Finish;
}) {
  const [available, setAvailable] = useState<
      (z.infer<typeof capabilitiesSchema> & { unavailable: boolean }) | null
    >(null),
    [connection, setConnection] = useState(""),
    [consent, setConsent] = useState(false),
    [monitor, setMonitor] = useState(false),
    [start, setStart] = useState(new Date().toISOString().slice(0, 7) + "-01"),
    [query, setQuery] = useState("receipt OR invoice OR refund OR order");
  const { busy, error, run } = useOperation();
  const sources =
    available?.connections
      .filter((c) => c.status === "active")
      .filter(
        (c) =>
          (c.provider === "google" &&
            available.operations.includes("gmail.messages.read")) ||
          (c.provider === "microsoft" &&
            available.operations.includes("outlook.messages.read")),
      ) ?? [];
  return (
    <Modal title="Connect receipt sources" onClose={onClose} busy={busy}>
      <div className="modal-body">
        <div className="source-intro">
          <Mail size={26} />
          <h3>Bring receipts into the picture</h3>
          <p className="muted">
            Finances can use a mailbox you explicitly allow in Ri. Account
            access and credentials stay with Ri.
          </p>
        </div>
        <div className="inline-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setAvailable(await client.call("finance_source_connections"));
              })
            }
          >
            Check available connections
          </button>
          <button
            className="text-button"
            onClick={() =>
              void run(async () => {
                await client.navigate("/__host/manage-access");
              })
            }
          >
            Manage access in Ri
            <ArrowUpRight size={15} />
          </button>
        </div>
        {available && !sources.length && (
          <Empty title="No permitted mailbox yet">
            Connect an account and allow this app to read it in Ri, then check
            again. Bank linking and credit scores are not available here.
          </Empty>
        )}
        {sources.length > 0 && (
          <>
            <label className="field">
              Mailbox
              <select
                value={connection}
                onChange={(e) => setConnection(e.target.value)}
              >
                <option value="">Choose an account</option>
                {sources.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label ?? c.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Start date
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="field">
              Receipt search
              <input
                value={query}
                maxLength={500}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={monitor}
                onChange={(e) => setMonitor(e.target.checked)}
              />
              Keep checking for new receipts while Ri is running
            </label>
            <label className="check-field consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I understand this permits mailbox reads. The receipt search
              filters results but does not restrict access to only financial
              mail.
            </label>
            <button
              className="button primary"
              disabled={!connection || !consent || busy}
              onClick={() =>
                void run(async () => {
                  const c = sources.find((s) => s.id === connection)!;
                  if (home.settings && !home.settings.restoreReviewed)
                    throw new Error(
                      "Review and enable the restored data from the overview first.",
                    );
                  if (!home.settings?.enabled)
                    await client.call("finance_setup", {
                      enabled: true,
                      currency: "USD",
                      timezone:
                        Intl.DateTimeFormat().resolvedOptions().timeZone,
                      restoreReviewed: true,
                    });
                  await client.call("finance_connect_mailbox", {
                    connectionId: connection,
                    provider: c.provider,
                    initialStartOn: start,
                    query,
                    monitoring: monitor,
                    acknowledgeBroadMailboxRead: true,
                  });
                  await onDone();
                  onClose();
                })
              }
            >
              {busy ? "Connecting…" : "Connect mailbox"}
            </button>
          </>
        )}
        <ErrorMessage message={error} />
      </div>
    </Modal>
  );
}
