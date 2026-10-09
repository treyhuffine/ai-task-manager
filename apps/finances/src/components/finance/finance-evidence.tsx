'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpcClient } from '@/lib/trpc/client';
import { parseMoney, formatMoney, currencyDigits } from '@/lib/finance/money';
import type {
  FinanceAccountRecord,
  FinanceEvidenceRecord,
  FinanceTransactionRecord,
} from '@/db/types';
export function FinanceManualEvidence({
  accounts,
  onSaved,
}: {
  accounts: FinanceAccountRecord[];
  onSaved: (e: FinanceEvidenceRecord) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? ''),
    [kind, setKind] =
      useState<FinanceEvidenceRecord['data']['kind']>('receipt'),
    [merchant, setMerchant] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [total, setTotal] = useState(''),
    [promise, setPromise] = useState(''),
    [excerpt, setExcerpt] = useState(''),
    [source, setSource] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const account = accounts.find((a) => a.id === accountId);
  return (
    <details className="mt-5 rounded-xl border border-border p-5">
      <summary className="cursor-pointer text-sm font-medium">
        Add receipt, refund or merchant evidence
      </summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!account) return;
          setBusy(true);
          setError('');
          void (async () => {
            try {
              const result = await trpcClient.finance.saveEvidence.mutate({
                reviewed: true,
                data: {
                  accountId,
                  sourceId: 'manual:' + crypto.randomUUID(),
                  kind,
                  merchant,
                  orderId: null,
                  occurredOn: date,
                  currency: account.currency,
                  totalMinor: total
                    ? parseMoney(total, account.currency)
                    : null,
                  promiseMinor: promise
                    ? parseMoney(promise, account.currency)
                    : null,
                  destination: 'unknown',
                  deadlineOn: null,
                  settlementDueOn: null,
                  items: [],
                  excerpt,
                  confidence: 1,
                  provenance: {
                    source: 'manual',
                    extractorVersion: 'human',
                    messageIds: [],
                    termsSource: source || null,
                  },
                },
              });
              await onSaved(result);
              setMerchant('');
              setExcerpt('');
              setTotal('');
              setPromise('');
            } catch (e) {
              setError(
                e instanceof Error ? e.message : 'Could not save evidence',
              );
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label className="text-xs">
          Account or mailbox
          <select
            className="block w-full rounded border border-border bg-background p-2"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Evidence type
          <select
            className="block w-full rounded border border-border bg-background p-2"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {[
              'receipt',
              'return',
              'refund',
              'renewal',
              'cancellation',
              'statement',
            ].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Merchant
          <Input
            required
            value={merchant}
            maxLength={300}
            onChange={(e) => setMerchant(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Evidence date
          <Input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Purchase or returned allocation ({account?.currency})
          <Input value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        <label className="text-xs">
          Promised refund ({account?.currency})
          <Input value={promise} onChange={(e) => setPromise(e.target.value)} />
        </label>
        <label className="text-xs sm:col-span-2">
          Order page or terms source
          <Input
            value={source}
            maxLength={500}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label className="text-xs sm:col-span-2">
          Supplied receipt, terms or merchant explanation
          <textarea
            required
            className="block min-h-24 w-full rounded border border-border bg-background p-2"
            value={excerpt}
            maxLength={24000}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          This saves your supplied evidence privately. The source page is
          recorded without being fetched. Review the destination and matching
          records after saving.
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" disabled={busy || !account}>
          Save protected evidence
        </Button>
      </form>
    </details>
  );
}

export function FinanceEvidenceEditor({
  evidence,
  transactions,
  onSaved,
}: {
  evidence: FinanceEvidenceRecord;
  transactions: FinanceTransactionRecord[];
  onSaved: (e: FinanceEvidenceRecord) => Promise<void>;
}) {
  const [draft, setDraft] = useState(evidence.data),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [role, setRole] = useState<'purchase' | 'refund' | 'recharge'>('refund'),
    [transactionId, setTransactionId] = useState(''),
    [amount, setAmount] = useState('');
  const units = 10 ** currencyDigits(draft.currency);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evidence update failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Close correction' : 'Correct evidence'}
        </Button>
        {evidence.attachments.map((a) => (
          <a
            key={a.file_name}
            className="rounded border border-border px-3 py-2 text-xs underline"
            href={`/api/finance/evidence/${evidence.id}/attachments/${encodeURIComponent(a.file_name)}`}
            target="_blank"
            rel="noreferrer"
          >
            {a.original_name}
          </a>
        ))}
      </div>
      {editing && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await trpcClient.finance.saveEvidence.mutate({
                data: draft,
                reviewed: true,
                expectedRevision: evidence.revision,
              });
              setEditing(false);
              await onSaved(result);
            });
          }}
        >
          <label className="text-xs">
            Evidence type
            <select
              className="block w-full rounded border border-border bg-background p-2"
              value={draft.kind}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  kind: e.target.value as typeof draft.kind,
                })
              }
            >
              {[
                'receipt',
                'return',
                'refund',
                'renewal',
                'cancellation',
                'statement',
              ].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Merchant
            <Input
              value={draft.merchant}
              onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Order reference
            <Input
              value={draft.orderId ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, orderId: e.target.value || null })
              }
            />
          </label>
          <label className="text-xs">
            Occurrence date
            <Input
              type="date"
              value={draft.occurredOn}
              onChange={(e) =>
                setDraft({ ...draft, occurredOn: e.target.value })
              }
            />
          </label>
          {(['totalMinor', 'promiseMinor'] as const).map((field) => (
            <label key={field} className="text-xs">
              {field === 'totalMinor'
                ? 'Returned purchase amount'
                : 'Promised refund'}{' '}
              ({draft.currency})
              <Input
                type="number"
                min="0"
                step={1 / units}
                value={draft[field] === null ? '' : draft[field]! / units}
                onChange={(e) => {
                  try {
                    setDraft({
                      ...draft,
                      [field]: e.target.value
                        ? parseMoney(e.target.value, draft.currency)
                        : null,
                    });
                  } catch {}
                }}
              />
            </label>
          ))}
          <label className="text-xs">
            Refund destination
            <select
              className="block w-full rounded border border-border bg-background p-2"
              value={draft.destination}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  destination: e.target.value as typeof draft.destination,
                })
              }
            >
              {['cash', 'card', 'gift_card', 'store_credit', 'unknown'].map(
                (d) => (
                  <option key={d} value={d}>
                    {d.replace('_', ' ')}
                  </option>
                ),
              )}
            </select>
          </label>
          {(['deadlineOn', 'settlementDueOn'] as const).map((field) => (
            <label key={field} className="text-xs">
              {field === 'deadlineOn'
                ? 'Return deadline'
                : 'Promised settlement deadline'}
              <Input
                type="date"
                value={draft[field] ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, [field]: e.target.value || null })
                }
              />
            </label>
          ))}
          {['renewal','cancellation'].includes(draft.kind)&&<fieldset className="grid gap-2 rounded border border-border p-3 sm:col-span-2 sm:grid-cols-2"><legend className="text-xs">Recurring terms from this evidence</legend><label className="text-xs">Cadence<select className="block w-full rounded border border-border bg-background p-2" value={draft.recurrence?.cadence??'variable'} onChange={e=>setDraft({...draft,recurrence:{...(draft.recurrence??{cadence:'variable',renewalMinor:null,nextChargeOn:null,trialEndsOn:null}),cadence:e.target.value as 'monthly'|'annual'|'variable'}})}>{['monthly','annual','variable'].map(c=><option key={c}>{c}</option>)}</select></label><label className="text-xs">Expected renewal amount ({draft.currency})<Input type="number" min="0" step={1/units} value={draft.recurrence?.renewalMinor==null?'':draft.recurrence.renewalMinor/units} onChange={e=>{try{setDraft({...draft,recurrence:{...(draft.recurrence??{cadence:'variable',renewalMinor:null,nextChargeOn:null,trialEndsOn:null}),renewalMinor:e.target.value?parseMoney(e.target.value,draft.currency):null}})}catch{}}}/></label>{(['nextChargeOn','trialEndsOn'] as const).map(field=><label className="text-xs" key={field}>{field==='nextChargeOn'?'Next charge date':'Trial deadline'}<Input type="date" value={draft.recurrence?.[field]??''} onChange={e=>setDraft({...draft,recurrence:{...(draft.recurrence??{cadence:'variable',renewalMinor:null,nextChargeOn:null,trialEndsOn:null}),[field]:e.target.value||null}})}/></label>)}</fieldset>}
          <label className="text-xs">
            Terms source or order page
            <Input
              value={draft.provenance.termsSource ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  provenance: {
                    ...draft.provenance,
                    termsSource: e.target.value || null,
                  },
                })
              }
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Evidence and explanation
            <textarea
              className="mt-1 block min-h-24 w-full rounded border border-border bg-background p-2"
              value={draft.excerpt}
              maxLength={24000}
              onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
            />
          </label>
          {draft.items.map((item, i) => (
            <div
              className="grid gap-2 rounded border border-border p-3 text-xs sm:col-span-2 sm:grid-cols-4"
              key={item.id}
            >
              <label>
                Item
                <Input
                  value={item.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((r, j) =>
                        j === i ? { ...r, name: e.target.value } : r,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Purchased quantity
                <Input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((r, j) =>
                        j === i
                          ? { ...r, quantity: Number(e.target.value) }
                          : r,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Item subtotal ({draft.currency})
                <Input
                  type="number"
                  step={1 / units}
                  value={item.amountMinor / units}
                  onChange={(e) => {
                    try {
                      setDraft({
                        ...draft,
                        items: draft.items.map((r, j) =>
                          j === i
                            ? {
                                ...r,
                                amountMinor: parseMoney(
                                  e.target.value || '0',
                                  draft.currency,
                                ),
                              }
                            : r,
                        ),
                      });
                    } catch {}
                  }}
                />
              </label>
              <label>
                Returned quantity
                <Input
                  aria-label={`Returned quantity for ${item.name}`}
                  type="number"
                  min="0"
                  max={item.quantity}
                  value={item.returnedQuantity}
                  onChange={(e) => {
                    const items = [...draft.items];
                    items[i] = {
                      ...item,
                      returnedQuantity: Number(e.target.value),
                    };
                    setDraft({ ...draft, items });
                  }}
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: draft.items.filter((_, j) => j !== i),
                  })
                }
              >
                Remove item
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft({
                ...draft,
                items: [
                  ...draft.items,
                  {
                    id: crypto.randomUUID(),
                    name: 'Item',
                    quantity: 1,
                    returnedQuantity: 0,
                    amountMinor: 0,
                  },
                ],
              })
            }
          >
            Add item
          </Button>
          {(
            [
              'taxMinor',
              'shippingMinor',
              'discountMinor',
              'deductionMinor',
            ] as const
          ).map((field) => (
            <label key={field} className="text-xs">
              {
                {
                  taxMinor: 'Order tax',
                  shippingMinor: 'Order shipping',
                  discountMinor: 'Order discount',
                  deductionMinor: 'Explained return deduction',
                }[field]
              }{' '}
              ({draft.currency})
              <Input
                type="number"
                min="0"
                step={1 / units}
                value={(draft.adjustments?.[field] ?? 0) / units}
                onChange={(e) => {
                  try {
                    setDraft({
                      ...draft,
                      adjustments: {
                        taxMinor: 0,
                        shippingMinor: 0,
                        discountMinor: 0,
                        deductionMinor: 0,
                        ...draft.adjustments,
                        [field]: parseMoney(
                          e.target.value || '0',
                          draft.currency,
                        ),
                      },
                    });
                  } catch {}
                }}
              />
            </label>
          ))}
          {(['paymentParts', 'refundParts'] as const).map((field) => (
            <div className="space-y-2 sm:col-span-2" key={field}>
              <h3 className="text-xs font-medium">
                {field === 'paymentParts'
                  ? 'Original payment breakdown'
                  : 'Promised refund destinations'}
              </h3>
              {(draft[field] ?? []).map((part, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <select
                    aria-label={`${field} destination ${i + 1}`}
                    className="rounded border border-border bg-background p-2 text-xs"
                    value={part.destination}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [field]: draft[field]!.map((r, j) =>
                          j === i
                            ? {
                                ...r,
                                destination: e.target
                                  .value as typeof r.destination,
                              }
                            : r,
                        ),
                      })
                    }
                  >
                    {['card', 'cash', 'gift_card', 'store_credit'].map((d) => (
                      <option key={d} value={d}>
                        {d.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="w-32"
                    aria-label={`${field} amount ${i + 1}`}
                    type="number"
                    min="0"
                    step={1 / units}
                    value={part.amountMinor / units}
                    onChange={(e) => {
                      try {
                        setDraft({
                          ...draft,
                          [field]: draft[field]!.map((r, j) =>
                            j === i
                              ? {
                                  ...r,
                                  amountMinor: parseMoney(
                                    e.target.value || '0',
                                    draft.currency,
                                  ),
                                }
                              : r,
                          ),
                        });
                      } catch {}
                    }}
                  />
                  <Input
                    className="w-32"
                    aria-label={`${field} masked destination ${i + 1}`}
                    placeholder="Last four digits"
                    maxLength={32}
                    value={part.maskedHint ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [field]: draft[field]!.map((r, j) =>
                          j === i
                            ? { ...r, maskedHint: e.target.value || null }
                            : r,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        [field]: draft[field]!.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    [field]: [
                      ...(draft[field] ?? []),
                      { destination: 'card', amountMinor: 0, maskedHint: null },
                    ],
                  })
                }
              >
                Add{' '}
                {field === 'paymentParts' ? 'payment' : 'refund destination'}
              </Button>
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <h3 className="text-xs font-medium">
              Purchase and return timeline
            </h3>
            {(draft.events ?? []).map((event, i) => (
              <div className="flex flex-wrap gap-2" key={i}>
                <select
                  aria-label={`Event type ${i + 1}`}
                  className="rounded border border-border bg-background p-2 text-xs"
                  value={event.kind}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      events: draft.events!.map((r, j) =>
                        j === i
                          ? { ...r, kind: e.target.value as typeof r.kind }
                          : r,
                      ),
                    })
                  }
                >
                  {[
                    'ordered',
                    'delivered',
                    'return_requested',
                    'dispatched',
                    'refund_promised',
                    'exchanged',
                    'recharged',
                  ].map((k) => (
                    <option key={k} value={k}>
                      {k.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
                <Input
                  className="w-40"
                  aria-label={`Event date ${i + 1}`}
                  type="date"
                  value={event.on}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      events: draft.events!.map((r, j) =>
                        j === i ? { ...r, on: e.target.value } : r,
                      ),
                    })
                  }
                />
                <Input
                  className="w-48"
                  aria-label={`Event source ${i + 1}`}
                  value={event.source}
                  placeholder="Source"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      events: draft.events!.map((r, j) =>
                        j === i ? { ...r, source: e.target.value } : r,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      events: draft.events!.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setDraft({
                  ...draft,
                  events: [
                    ...(draft.events ?? []),
                    { kind: 'ordered', on: draft.occurredOn, source: '' },
                  ],
                })
              }
            >
              Add event
            </Button>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Your correction is saved as a reviewed revision and survives later
            extraction. A promise does not prove that money arrived.
          </p>
          <Button size="sm" type="submit" disabled={busy}>
            Save evidence correction
          </Button>
        </form>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer">Match a charge or credit</summary>
        <p className="my-2 text-muted-foreground">
          Choose the actual posted record and the amount allocated to this
          purchase. Separate partial credits and later recharges can be linked
          individually.
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const allocations = await trpcClient.finance.allocations.query({
                evidenceId: evidence.id,
              });
              const prior = allocations.find(
                (a) => a.transactionId === transactionId,
              );
              await trpcClient.finance.matchEvidence.mutate({
                evidenceId: evidence.id,
                transactionId,
                amountMinor: parseMoney(amount, draft.currency),
                decision: 'human',
                role,
                confidence: 1,
                expectedRevision: prior?.revision ?? 0,
                mutationKey: crypto.randomUUID(),
              });
              await onSaved(evidence);
            });
          }}
        >
          <select
            aria-label="Transaction to match"
            className="max-w-full rounded border border-border bg-background p-2"
            required
            value={transactionId}
            onChange={(e) => {
              setTransactionId(e.target.value);
              const t = transactions.find((t) => t.id === e.target.value);
              if (t) setAmount(String(Math.abs(t.amountMinor) / units));
            }}
          >
            <option value="">Choose charge or credit</option>
            {transactions
              .filter(
                (t) => t.currency === draft.currency && t.state !== 'removed',
              )
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.postedOn} • {t.merchant} •{' '}
                  {formatMoney(t.amountMinor, t.currency)} • {t.state}
                </option>
              ))}
          </select>
          <Input
            className="w-36"
            aria-label="Matched amount"
            type="number"
            step={1 / units}
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <select
            aria-label="Match purpose"
            className="rounded border border-border bg-background p-2"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="purchase">Original purchase</option>
            <option value="refund">Refund credit</option>
            <option value="recharge">Later recharge or reversal</option>
          </select>
          <Button size="sm" disabled={busy || !transactionId}>
            Save match
          </Button>
        </form>
      </details>
    </div>
  );
}
