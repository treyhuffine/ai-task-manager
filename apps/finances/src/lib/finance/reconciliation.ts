import type {
  FinanceAccountRecord,
  FinanceAllocationRecord,
  FinanceEvidenceRecord,
  FinanceTransactionRecord,
} from '@/db/types';
import { allocateMoney, sumMoney } from './money';
import { createHash } from 'node:crypto';

export function refundGaps(
  evidence: FinanceEvidenceRecord,
  transactions: FinanceTransactionRecord[],
  allocations: FinanceAllocationRecord[],
  accounts: FinanceAccountRecord[] = [],
) {
  const data = evidence.data;
  const returnedSubtotal = data.items.length
    ? sumMoney(
        data.items
          .filter((i) => i.returnedQuantity > 0)
          .map((i) => {
            if (i.returnedQuantity > i.quantity)
              throw new Error('Returned quantity exceeds purchase');
            return allocateMoney(i.amountMinor, [
              i.returnedQuantity,
              i.quantity - i.returnedQuantity,
            ])[0];
          }),
      )
    : data.totalMinor;
  const subtotal = sumMoney(data.items.map((i) => i.amountMinor));
  const adjustments = data.adjustments
    ? sumMoney([
        data.adjustments.taxMinor,
        data.adjustments.shippingMinor,
        -data.adjustments.discountMinor,
      ])
    : 0;
  const returnedMinor =
    returnedSubtotal === null
      ? null
      : data.items.length && subtotal > 0
        ? sumMoney([
            returnedSubtotal,
            allocateMoney(adjustments, [
              returnedSubtotal,
              subtotal - returnedSubtotal,
            ])[0],
          ])
        : returnedSubtotal;
  const approved = allocations.filter(
    (a) =>
      a.evidenceId === evidence.id &&
      ['human', 'confirmed'].includes(a.decision),
  );
  const settled = approved
    .filter(
      (a) =>
        a.role === 'refund' ||
        a.role === 'recharge' ||
        (a.role === null &&
          transactions.some(
            (t) => t.id === a.transactionId && t.amountMinor < 0,
          )),
    )
    .filter((a) =>
      transactions.some(
        (t) =>
          t.id === a.transactionId &&
          t.state === 'posted' &&
          ['refund', 'purchase'].includes(t.kind),
      ),
    );
  // A later debit reverses a credit. Pending removals never enter settlement.
  const invalid = settled.some((a) => {
    const t = transactions.find((t) => t.id === a.transactionId)!;
    return a.amountMinor > Math.abs(t.amountMinor);
  });
  const cashPromise = data.refundParts?.length
    ? sumMoney(
        data.refundParts
          .filter((part) => ['cash', 'card'].includes(part.destination))
          .map((part) => part.amountMinor),
      )
    : data.promiseMinor;
  const promises = data.refundParts?.length
    ? data.refundParts
    : data.destination !== 'unknown' && data.promiseMinor !== null
      ? [
          {
            destination: data.destination,
            amountMinor: data.promiseMinor,
            maskedHint: null,
          },
        ]
      : [];
  const normalizeMask = (value: string | null | undefined) =>
    value
      ? value
          .replace(/[^a-z0-9]/gi, '')
          .slice(-4)
          .toLowerCase()
      : null;
  const groups = new Map<
    string,
    {
      destination: 'card' | 'cash';
      maskedHint: string | null;
      promiseMinor: number;
      settledMinor: number;
    }
  >();
  for (const part of promises.filter((part) =>
    ['card', 'cash'].includes(part.destination),
  )) {
    const mask = normalizeMask(part.maskedHint),
      key = part.destination + ':' + (mask ?? 'unspecified'),
      old = groups.get(key);
    groups.set(key, {
      destination: part.destination as 'card' | 'cash',
      maskedHint: mask,
      promiseMinor: sumMoney([old?.promiseMinor ?? 0, part.amountMinor]),
      settledMinor: 0,
    });
  }
  const destinationOf = (a: FinanceAllocationRecord) => {
    const t = transactions.find((t) => t.id === a.transactionId)!,
      account = accounts.find((ac) => ac.id === t.accountId),
      destination =
        account?.kind === 'credit'
          ? 'card'
          : account?.kind === 'cash'
            ? 'cash'
            : !accounts.length && !data.refundParts?.length
              ? data.destination
              : 'unknown',
      mask = normalizeMask(account?.mask);
    return (
      [...groups.values()].find(
        (group) =>
          group.destination === destination &&
          group.maskedHint !== null &&
          group.maskedHint === mask,
      ) ??
      [...groups.values()].find(
        (group) =>
          group.destination === destination && group.maskedHint === null,
      )
    );
  };
  for (const a of settled) {
    const group = destinationOf(a);
    if (group)
      group.settledMinor = sumMoney([
        group.settledMinor,
        transactions.find((t) => t.id === a.transactionId)!.amountMinor < 0
          ? a.amountMinor
          : -a.amountMinor,
      ]);
  }
  const destinationGaps = [...groups.values()].map((part) => ({
    ...part,
    gapMinor: Math.max(0, part.promiseMinor - part.settledMinor),
  }));
  const eligible = settled.filter((a) => !!destinationOf(a));
  const settledMinor = sumMoney(
    eligible.map((a) => {
      const t = transactions.find((t) => t.id === a.transactionId)!;
      return t.amountMinor < 0 ? a.amountMinor : -a.amountMinor;
    }),
  );
  const cashDestination =
    ['card', 'cash'].includes(data.destination) ||
    !!data.refundParts?.some((part) =>
      ['card', 'cash'].includes(part.destination),
    );
  return {
    id: evidence.id,
    merchant: data.merchant,
    occurredOn: data.occurredOn,
    destination: data.destination,
    currency: data.currency,
    purchaseMinor: returnedMinor,
    promiseMinor: data.promiseMinor,
    settledMinor: cashDestination && !invalid ? settledMinor : null,
    cashPromiseMinor: cashDestination ? cashPromise : null,
    destinationGaps,
    nonCashPromises: promises.filter(
      (part) => !['card', 'cash'].includes(part.destination),
    ),
    unexplainedDeductionMinor:
      returnedMinor !== null && data.promiseMinor !== null
        ? Math.max(
            0,
            returnedMinor -
              data.promiseMinor -
              (data.adjustments?.deductionMinor ?? 0),
          )
        : null,
    deductionMinor:
      returnedMinor !== null && data.promiseMinor !== null
        ? Math.max(0, returnedMinor - data.promiseMinor)
        : null,
    settlementGapMinor:
      cashDestination && cashPromise !== null && !invalid
        ? sumMoney(destinationGaps.map((part) => part.gapMinor))
        : null,
    status: invalid
      ? 'needs_review'
      : !cashDestination
        ? 'non_cash'
        : data.promiseMinor === null
          ? 'unknown'
          : destinationGaps.length > 0 &&
              destinationGaps.every((part) => part.gapMinor === 0)
            ? 'settled'
            : 'awaiting',
    settlementDueOn: data.settlementDueOn,
    transactionIds: settled.map((a) => a.transactionId),
  };
}
export function suggestEvidenceMatches(
  evidence: FinanceEvidenceRecord,
  transactions: FinanceTransactionRecord[],
) {
  const data = evidence.data,
    refund = data.kind === 'refund',
    target = refund ? data.promiseMinor : data.totalMinor;
  if (
    target === null ||
    (refund && !['card', 'cash'].includes(data.destination))
  )
    return [];
  return transactions
    .filter(
      (t) =>
        t.state !== 'removed' &&
        t.currency === data.currency &&
        (refund
          ? t.amountMinor < 0 && t.kind === 'refund'
          : t.amountMinor > 0 &&
            ['purchase', 'interest', 'fee'].includes(t.kind)),
    )
    .map((t) => {
      let score = 0;
      const signals: string[] = [];
      if (Math.abs(t.amountMinor) === target) {
        score += 0.45;
        signals.push('amount');
      }
      const merchant = data.merchant.toLowerCase().replace(/[^a-z0-9]/g, ''),
        actual = t.merchant.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        merchant.length >= 3 &&
        (actual.includes(merchant) || merchant.includes(actual))
      ) {
        score += 0.3;
        signals.push('merchant');
      }
      const days =
        Math.abs(Date.parse(t.postedOn) - Date.parse(data.occurredOn)) /
        86400000;
      if (days <= 7) {
        score += 0.2;
        signals.push('date');
      } else if (days <= 30) {
        score += 0.05;
        signals.push('nearby_date');
      }
      return { transactionId: t.id, confidence: score, signals };
    })
    .filter((m) => m.confidence >= 0.65)
    .sort((a, b) => b.confidence - a.confidence);
}
export function detectRecurring(
  transactions: FinanceTransactionRecord[],
  evidence: FinanceEvidenceRecord[],
) {
  const groups = new Map<string, FinanceTransactionRecord[]>();
  const anchors=new Map<string,FinanceEvidenceRecord>();
  for (const t of transactions.filter(
    (t) =>
      t.state === 'posted' &&
      t.amountMinor > 0 &&
      ['purchase', 'fee', 'interest'].includes(t.kind),
  )) {
    const key = JSON.stringify([
      t.accountId,
      t.currency,
      t.merchant.toLowerCase().replace(/\s+/g, ' ').trim(),
    ]);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for(const e of evidence.filter(e=>e.data.kind==='renewal'&&(e.data.recurrence?.renewalMinor??e.data.totalMinor)!==null)){
    if([...groups.values()].some(rows=>rows.some(t=>t.currency===e.data.currency&&t.merchant.toLowerCase()===e.data.merchant.toLowerCase())))continue;
    const key=JSON.stringify([e.accountId,e.data.currency,e.data.merchant.toLowerCase().replace(/\s+/g,' ').trim()]);
    groups.set(key,[]);const prior=anchors.get(key);if(!prior||prior.occurredOn<e.occurredOn)anchors.set(key,e);
  }
  return [...groups].flatMap(([key, rows]) => {
    const anchor=anchors.get(key);
    const sorted = rows.sort((a, b) => a.postedOn.localeCompare(b.postedOn)),
      last = sorted.at(-1)??{accountId:anchor!.accountId,merchant:anchor!.data.merchant,currency:anchor!.data.currency,amountMinor:anchor!.data.recurrence?.renewalMinor??anchor!.data.totalMinor!,category:'subscriptions',postedOn:anchor!.occurredOn};
    const terms = evidence.filter(
      (e) =>
        e.data.merchant.toLowerCase() === last.merchant.toLowerCase() &&
        e.data.currency === last.currency &&
        ['renewal', 'cancellation'].includes(e.data.kind),
    );
    const intervals = sorted
      .slice(1)
      .map(
        (t, i) =>
          (Date.parse(t.postedOn) - Date.parse(sorted[i].postedOn)) / 86400000,
      );
    const monthly =
        intervals.length > 0 && intervals.every((d) => d >= 25 && d <= 37),
      annual =
        intervals.length > 0 && intervals.every((d) => d >= 340 && d <= 390);
    if (!monthly && !annual && !terms.length) return [];
    const latestTerms = terms.sort((a, b) =>
      b.occurredOn.localeCompare(a.occurredOn),
    )[0];
    const cadence = latestTerms?.data.recurrence?.cadence??(annual
      ? ('annual' as const)
      : monthly
        ? ('monthly' as const)
        : ('variable' as const));
    const lastDate = new Date(`${last.postedOn}T12:00:00Z`),
      year = lastDate.getUTCFullYear() + (cadence==='annual' ? 1 : 0),
      month = lastDate.getUTCMonth() + (cadence==='annual' ? 0 : 1);
    const next = new Date(
      Date.UTC(
        year,
        month,
        Math.min(
          lastDate.getUTCDate(),
          new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
        ),
      ),
    );
    return [
      {
        key: createHash('sha256').update(key).digest('hex'),
        accountId: last.accountId,
        merchant: last.merchant,
        category: last.category,
        currency: last.currency,
        amountMinor: latestTerms?.data.recurrence?.renewalMinor??last.amountMinor,
        cadence,
        nextOn: latestTerms?.data.recurrence?.trialEndsOn??latestTerms?.data.recurrence?.nextChargeOn??latestTerms?.data.deadlineOn ?? next.toISOString().slice(0, 10),
        status:
          latestTerms?.data.kind === 'cancellation'
            ? ('cancelled' as const)
            : terms.length
              ? ('confirmed' as const)
              : ('suspected' as const),
        annualMinor:
          cadence === 'annual'
            ? latestTerms?.data.recurrence?.renewalMinor??last.amountMinor
            : cadence === 'monthly'
              ? sumMoney(Array(12).fill(latestTerms?.data.recurrence?.renewalMinor??last.amountMinor))
              : null,
        previousAmountMinor:
          latestTerms?.data.recurrence?.renewalMinor!=null&&latestTerms.data.recurrence.renewalMinor!==last.amountMinor?last.amountMinor:sorted.length > 1 ? sorted.at(-2)!.amountMinor : null,
        transactionIds: sorted.map((t) => t.id),
        evidenceIds: terms.map((e) => e.id),
        afterCancellation:
          sorted.length>0&&latestTerms?.data.kind === 'cancellation' &&
          last.postedOn > latestTerms.occurredOn,
      },
    ];
  });
}
