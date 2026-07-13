/**
 * The graduation engine — pure functions over acceptance telemetry.
 * Promotion is only ever OFFERED (the user's acceptance writes the config);
 * demotion on trailing-window regression is automatic and announced in the
 * digest. Never flips autonomy up by itself. Spec §1.5 / §3.11.
 */

import {
  getAcceptanceStats,
  getTrailingAcceptance,
  getStreamAutonomy,
  setStreamAutonomy,
  type AcceptanceStats,
} from '@/lib/db/queries';
import type { StreamAutonomyLevel, TriageDisposition } from '@/db/types';
import {
  GRADUATE_SUGGEST_TO_AUTO,
  GRADUATE_AUTO_TO_SILENT,
  DEMOTE_TRAILING,
} from './constants';

const LEVEL_ORDER: StreamAutonomyLevel[] = ['suggest', 'auto_digest', 'silent'];

export interface GraduationEvaluation {
  disposition: TriageDisposition;
  action: 'offer_promotion' | 'demote' | 'hold';
  fromLevel: StreamAutonomyLevel;
  toLevel: StreamAutonomyLevel;
  rate: number | null;
  sample: number;
}

/** Pure rule evaluation for one disposition. */
export function evaluateGraduation(
  disposition: TriageDisposition,
  currentLevel: StreamAutonomyLevel,
  lifetime: { rate: number | null; sample: number },
  trailing: { rate: number | null; sample: number },
): GraduationEvaluation {
  // Demotion first: trust loss reacts before trust gain.
  if (
    currentLevel !== 'suggest' &&
    trailing.sample >= DEMOTE_TRAILING.minSample &&
    trailing.rate != null &&
    trailing.rate < DEMOTE_TRAILING.belowRate
  ) {
    const toLevel = LEVEL_ORDER[Math.max(0, LEVEL_ORDER.indexOf(currentLevel) - 1)];
    return { disposition, action: 'demote', fromLevel: currentLevel, toLevel, rate: trailing.rate, sample: trailing.sample };
  }
  if (
    currentLevel === 'suggest' &&
    lifetime.sample >= GRADUATE_SUGGEST_TO_AUTO.minSample &&
    lifetime.rate != null &&
    lifetime.rate >= GRADUATE_SUGGEST_TO_AUTO.minRate
  ) {
    return { disposition, action: 'offer_promotion', fromLevel: currentLevel, toLevel: 'auto_digest', rate: lifetime.rate, sample: lifetime.sample };
  }
  if (
    currentLevel === 'auto_digest' &&
    lifetime.sample >= GRADUATE_AUTO_TO_SILENT.minSample &&
    lifetime.rate != null &&
    lifetime.rate >= GRADUATE_AUTO_TO_SILENT.minRate
  ) {
    return { disposition, action: 'offer_promotion', fromLevel: currentLevel, toLevel: 'silent', rate: lifetime.rate, sample: lifetime.sample };
  }
  return { disposition, action: 'hold', fromLevel: currentLevel, toLevel: currentLevel, rate: lifetime.rate, sample: lifetime.sample };
}

export interface GraduationSweepResult {
  /** Raise offers for the digest — applied only when the user accepts. */
  offers: GraduationEvaluation[];
  /** Demotions already applied (automatic) — announced in the digest. */
  demotions: GraduationEvaluation[];
}

/**
 * Evaluate every disposition at sweep end. Applies demotions immediately,
 * returns offers for the digest. With the kill switch on this is a no-op —
 * the user has said "everything through me," so no offers either.
 */
export function evaluateAllGraduations(): GraduationSweepResult {
  const autonomy = getStreamAutonomy();
  if (autonomy.killSwitch) return { offers: [], demotions: [] };

  const statsByDisposition = new Map<TriageDisposition, AcceptanceStats>(
    getAcceptanceStats().map((s) => [s.disposition, s]),
  );

  const offers: GraduationEvaluation[] = [];
  const demotions: GraduationEvaluation[] = [];

  for (const disposition of Object.keys(autonomy.levels) as TriageDisposition[]) {
    const lifetime = statsByDisposition.get(disposition);
    const evaluation = evaluateGraduation(
      disposition,
      autonomy.levels[disposition],
      { rate: lifetime?.rate ?? null, sample: lifetime?.sample ?? 0 },
      getTrailingAcceptance(disposition, DEMOTE_TRAILING.window),
    );
    if (evaluation.action === 'offer_promotion') offers.push(evaluation);
    if (evaluation.action === 'demote') {
      setStreamAutonomy({ levels: { [disposition]: evaluation.toLevel } });
      demotions.push(evaluation);
    }
  }
  return { offers, demotions };
}

/**
 * Side-effect-free variant for GET surfaces: standing promotion offers
 * only. Demotions are applied exclusively at sweep end so a read can never
 * change config.
 */
export function previewGraduationOffers(): GraduationEvaluation[] {
  const autonomy = getStreamAutonomy();
  if (autonomy.killSwitch) return [];
  const statsByDisposition = new Map<TriageDisposition, AcceptanceStats>(
    getAcceptanceStats().map((s) => [s.disposition, s]),
  );
  const offers: GraduationEvaluation[] = [];
  for (const disposition of Object.keys(autonomy.levels) as TriageDisposition[]) {
    const lifetime = statsByDisposition.get(disposition);
    const evaluation = evaluateGraduation(
      disposition,
      autonomy.levels[disposition],
      { rate: lifetime?.rate ?? null, sample: lifetime?.sample ?? 0 },
      getTrailingAcceptance(disposition, DEMOTE_TRAILING.window),
    );
    if (evaluation.action === 'offer_promotion') offers.push(evaluation);
  }
  return offers;
}

/** Human copy for a graduation line in the digest. Calm, no percentages
 *  beyond the one that earns the ask, no internal vocabulary. */
export function describeGraduation(g: GraduationEvaluation): string {
  const what = DISPOSITION_PHRASES[g.disposition] ?? g.disposition;
  const pct = g.rate != null ? Math.round(g.rate * 100) : 0;
  if (g.action === 'offer_promotion' && g.toLevel === 'auto_digest') {
    return `You have accepted ${pct}% of my suggestions to ${what} (${g.sample} so far). Want me to start doing those automatically? You can undo any of them in one tap.`;
  }
  if (g.action === 'offer_promotion' && g.toLevel === 'silent') {
    return `Handling ${what} automatically has gone well (${pct}% over ${g.sample}). Want me to stop listing those in the digest too?`;
  }
  if (g.action === 'demote') {
    return `I have been getting ${what} wrong lately, so I will go back to ${g.toLevel === 'suggest' ? 'suggesting them' : 'listing them in the digest'} instead.`;
  }
  return '';
}

const DISPOSITION_PHRASES: Record<TriageDisposition, string> = {
  promote_task: 'turn captures into tasks',
  promote_note: 'turn captures into notes',
  merge_task: 'add captures to existing tasks',
  merge_note: 'add captures to existing notes',
  combine_task: 'combine related captures into one task',
  combine_note: 'combine related captures into one note',
  journal: 'keep captures as thoughts',
  dismiss: 'set aside noise',
  incubate: 'save captures for later',
};
