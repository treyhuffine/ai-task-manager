'use client';
import { useState } from 'react';
import type { FinanceAccountRecord } from '@/db/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpcClient } from '@/lib/trpc/client';
import { parseMoney, currencyDigits } from '@/lib/finance/money';
export function FinanceManualAccount({
  account,
  onSaved,
}: {
  account: FinanceAccountRecord;
  onSaved: () => Promise<void>;
}) {
  const [balance, setBalance] = useState(
      account.balanceMinor == null
        ? ''
        : String(account.balanceMinor / 10 ** currencyDigits(account.currency)),
    ),
    [includesPending, setIncludes] = useState(account.balanceIncludesPending),
    [mask, setMask] = useState(account.mask ?? ''),
    [error, setError] = useState('');
  return (
    <details className="w-full text-xs">
      <summary className="cursor-pointer">Update manual balance</summary>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          void (async () => {
            try {
              await trpcClient.finance.updateManualAccount.mutate({
                id: account.id,
                balanceMinor: balance
                  ? parseMoney(balance, account.currency)
                  : null,
                balanceIncludesPending: includesPending,
                mask: mask || null,
              });
              await onSaved();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : 'Balance update failed',
              );
            }
          })();
        }}
      >
        <label>
          Current balance ({account.currency})
          <Input
            className="w-36"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </label>
        <label>
          Last four digits
          <Input
            className="w-28"
            maxLength={32}
            value={mask}
            onChange={(e) => setMask(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={includesPending}
            onChange={(e) => setIncludes(e.target.checked)}
          />{' '}
          Balance includes pending activity
        </label>
        <Button size="sm" type="submit">
          Confirm balance
        </Button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
export function FinanceManualTransaction({
  accounts,
  onSaved,
}: {
  accounts: FinanceAccountRecord[];
  onSaved: () => Promise<void>;
}) {
  const [accountId, setAccount] = useState(
      accounts.find((a) => a.kind !== 'mailbox' && a.kind !== 'excluded')?.id ??
        '',
    ),
    [merchant, setMerchant] = useState(''),
    [amount, setAmount] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [category, setCategory] = useState('other'),
    [kind, setKind] = useState<
      | 'purchase'
      | 'refund'
      | 'income'
      | 'transfer'
      | 'card_payment'
      | 'interest'
      | 'fee'
    >('purchase'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const account = accounts.find((a) => a.id === accountId);
  return (
    <details className="space-y-3">
      <summary className="cursor-pointer text-sm font-medium">
        Record a manual transaction
      </summary>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!account) return;
          setBusy(true);
          setError('');
          void (async () => {
            try {
              const n = parseMoney(amount, account.currency);
              await trpcClient.finance.recordTransaction.mutate({
                mutationKey: crypto.randomUUID(),
                data: {
                  accountId,
                  merchant,
                  amountMinor: ['income', 'refund'].includes(kind)
                    ? -Math.abs(n)
                    : n,
                  currency: account.currency,
                  postedOn: date,
                  authorizedOn: null,
                  category,
                  kind,
                  state: 'posted',
                  pendingSourceId: null,
                  obligationId: null,
                  refundOf: null,
                },
              });
              setMerchant('');
              setAmount('');
              await onSaved();
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : 'Transaction could not be saved',
              );
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label className="text-xs">
          Account
          <select
            className="block w-full rounded border border-border bg-background p-2"
            value={accountId}
            onChange={(e) => setAccount(e.target.value)}
          >
            {accounts
              .filter((a) => !['mailbox', 'excluded'].includes(a.kind))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs">
          Merchant or description
          <Input
            required
            value={merchant}
            maxLength={300}
            onChange={(e) => setMerchant(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Amount ({account?.currency})
          <Input
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Posting date
          <Input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Category
          <Input
            required
            value={category}
            maxLength={80}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Kind
          <select
            className="block w-full rounded border border-border bg-background p-2"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {[
              'purchase',
              'refund',
              'income',
              'transfer',
              'card_payment',
              'interest',
              'fee',
            ].map((k) => (
              <option key={k} value={k}>
                {k.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-3">
          Income and refunds are credits. Other amounts use positive for a debit
          and negative for a credit. Recording activity does not move money.
          Confirm manual balances afterward.
        </p>
        {error && <p role="alert">{error}</p>}
        <Button size="sm" type="submit" disabled={busy || !account}>
          Record transaction
        </Button>
      </form>
    </details>
  );
}
