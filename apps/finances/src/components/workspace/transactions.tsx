import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ReceiptText } from "lucide-react";
import type { Account, Detail, FinanceClient, Transaction } from "./types";
import {
  AskButton,
  dateLabel,
  Empty,
  ErrorMessage,
  Form,
  label,
  Modal,
  money,
  useOperation,
} from "./ui";

export function TransactionRows({
  rows,
  accounts,
  selected,
  onSelect,
  onOpen,
  compact = false,
}: {
  rows: Transaction[];
  accounts: Account[];
  selected: string[];
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  if (!rows.length)
    return (
      <Empty icon={<ReceiptText size={24} />} title="No transactions here">
        Try another month or filter, or add activity to an account.
      </Empty>
    );
  return (
    <div className={"transactions" + (compact ? " compact" : "")}>
      {!compact && (
        <div className="transaction-head">
          <span />
          <span>Transaction</span>
          <span className="transaction-category">Category</span>
          <span className="transaction-account">Account</span>
          <span className="transaction-amount">Amount</span>
        </div>
      )}
      {rows.map((t) => (
        <div
          className={
            "transaction-row" + (selected.includes(t.id) ? " selected" : "")
          }
          key={t.id}
        >
          {!compact && (
            <input
              type="checkbox"
              aria-label={"Select " + t.merchant}
              checked={selected.includes(t.id)}
              onChange={() => onSelect(t.id)}
            />
          )}
          <button
            className="transaction-main"
            onClick={() => onOpen(t.id)}
            aria-label={"View " + t.merchant}
          >
            <span
              className={
                "merchant-mark" + (t.amountMinor < 0 ? " incoming" : "")
              }
            >
              {t.kind === "income" ? (
                <ArrowDownLeft size={17} />
              ) : (
                t.merchant.slice(0, 1).toUpperCase() || (
                  <ReceiptText size={17} />
                )
              )}
            </span>
            <span>
              <strong>{t.merchant || "Unnamed transaction"}</strong>
              <small>
                {dateLabel(t.postedOn)}
                {t.state === "pending" && (
                  <span className="pending-dot">Pending</span>
                )}
                {compact && " · " + label(t.category)}
              </small>
            </span>
          </button>
          {!compact && (
            <>
              <span className="transaction-category">
                <span className="category-chip">{label(t.category)}</span>
              </span>
              <span className="transaction-account muted">
                {accounts.find((a) => a.id === t.accountId)?.name ?? "Account"}
              </span>
            </>
          )}
          <button
            className={
              "transaction-amount amount-button" +
              (t.amountMinor < 0 ? " positive" : "")
            }
            onClick={() => onOpen(t.id)}
            aria-label={"Amount for " + t.merchant}
          >
            {t.amountMinor < 0 ? "+" : ""}
            {money(Math.abs(t.amountMinor), t.currency)}
            <small>
              {["transfer", "card_payment", "income", "refund"].includes(t.kind)
                ? label(t.kind)
                : ""}
            </small>
          </button>
        </div>
      ))}
    </div>
  );
}

export function TransactionDialog({
  id,
  accounts,
  client,
  owner,
  onClose,
  onChanged,
}: {
  id: string;
  accounts: Account[];
  client: FinanceClient;
  owner: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [category, setCategory] = useState(""),
    [kind, setKind] = useState(""),
    [remember, setRemember] = useState(false);
  const { busy, error, run, setError } = useOperation();
  useEffect(() => {
    let active = true;
    void client
      .call<Detail>("finance_transaction_detail", { id })
      .then((result) => {
        if (active) {
          setDetail(result);
          setCategory(result.transaction.category);
          setKind(result.transaction.kind);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, client, setError]);
  const t = detail?.transaction;
  return (
    <Modal title="Transaction details" onClose={onClose} busy={busy}>
      <div className="modal-body">
        <ErrorMessage message={error} />
        {!detail || !t ? (
          <p role="status">Loading transaction…</p>
        ) : (
          <>
            <div className="detail-hero">
              <span className="eyebrow">
                {t.state === "pending" ? "Pending transaction" : label(t.kind)}
              </span>
              <h3>{t.merchant}</h3>
              <p
                className={
                  "detail-amount" + (t.amountMinor < 0 ? " positive" : "")
                }
              >
                {t.amountMinor < 0 ? "+" : ""}
                {money(Math.abs(t.amountMinor), t.currency)}
              </p>
              <p className="muted">
                {dateLabel(t.postedOn, true)} ·{" "}
                {accounts.find((a) => a.id === t.accountId)?.name}
              </p>
            </div>
            <AskButton
              client={client}
              prompt="Help me understand the selected transaction. Check its classification and any available evidence."
            >
              Ask about this transaction
            </AskButton>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await client.call("finance_correct_transaction", {
                    id,
                    category: category.trim(),
                    kind,
                    rememberMerchant: remember,
                    expectedRevision: detail.correctionRevision,
                    mutationKey: crypto.randomUUID(),
                  });
                  await onChanged();
                  onClose();
                });
              }}
            >
              <div className="form-grid">
                <label className="field">
                  Category
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    maxLength={80}
                    required
                    disabled={!owner}
                  />
                </label>
                <label className="field">
                  Type
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                    disabled={!owner}
                  >
                    {[
                      "purchase",
                      "refund",
                      "income",
                      "transfer",
                      "card_payment",
                      "interest",
                      "fee",
                    ].map((v) => (
                      <option key={v} value={v}>
                        {label(v)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {owner && (
                <>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    Use this category for this merchant in this account
                  </label>
                  <p className="hint">
                    Corrections are kept when this source refreshes.
                  </p>
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      (!remember && category === t.category && kind === t.kind)
                    }
                  >
                    {busy ? "Saving…" : "Save correction"}
                  </button>
                </>
              )}
            </Form>
            <div className="section-title">
              <h3>Linked receipts & evidence</h3>
              <ReceiptText size={17} />
            </div>
            {detail.evidence.length ? (
              detail.evidence.map((e) => (
                <button
                  key={e.id}
                  className="list-link"
                  onClick={() =>
                    void run(async () => {
                      await client.navigate("/records/evidence/" + e.id);
                    })
                  }
                >
                  <span>
                    <strong>{e.data.merchant}</strong>
                    <small>
                      {label(e.data.kind)} · {dateLabel(e.data.occurredOn)}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))
            ) : (
              <p className="muted">
                No linked evidence is available to this view.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
