/**
 * The domain vocabulary without schemas, shared by the backend and the
 * sandboxed view: stages, outcomes, labels and the owned collections.
 */
export const STAGES = ['saved', 'applied', 'interviewing', 'offer', 'closed'] as const;
export const BOARD_STAGES = ['saved', 'applied', 'interviewing', 'offer'] as const;
export const OUTCOMES = ['rejected', 'withdrawn', 'accepted'] as const;
export type Stage = (typeof STAGES)[number];
export type Outcome = (typeof OUTCOMES)[number];
export const STAGE_LABELS: Record<Stage, string> = { saved: 'Saved', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', closed: 'Closed' };
export const OUTCOME_LABELS: Record<Outcome, string> = { rejected: 'Rejected', withdrawn: 'Withdrawn', accepted: 'Accepted' };
export const STAGE_ORDER: Record<Stage, number> = { saved: 0, applied: 1, interviewing: 2, offer: 3, closed: 4 };
export function stageLabel(stage: Stage, outcome: Outcome | null): string {
  return stage === 'closed' && outcome ? OUTCOME_LABELS[outcome] : STAGE_LABELS[stage];
}

export const WORK_ARRANGEMENTS = ['onsite', 'hybrid', 'remote'] as const;
export const WORK_LABELS = { onsite: 'On site', hybrid: 'Hybrid', remote: 'Remote' } as const;

/** Collections the app owns, beside one source per connected account. */
export const MANUAL_SOURCE = 'manual';
export const MATERIALS_SOURCE = 'materials';

export const COMP_KINDS = ['base', 'total', 'hourly', 'bonus', 'equity', 'other'] as const;
export const COMP_PERIODS = ['year', 'month', 'week', 'day', 'hour', 'one_time', 'unstated'] as const;
export const COMP_PERIOD_LABELS: Record<(typeof COMP_PERIODS)[number], string> = { year: 'a year', month: 'a month', week: 'a week', day: 'a day', hour: 'an hour', one_time: 'one time', unstated: 'period not stated' };
export const COMP_KIND_LABELS: Record<(typeof COMP_KINDS)[number], string> = { base: 'Base salary', total: 'Total compensation', hourly: 'Hourly rate', bonus: 'Bonus', equity: 'Equity', other: 'Compensation' };
export const CLASSIFICATIONS = ['acknowledgment', 'sent_application', 'scheduling', 'interview_confirmed', 'reschedule', 'cancellation', 'offer', 'rejection', 'recruiter', 'other'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  acknowledgment: 'Application received',
  sent_application: 'You sent an application',
  scheduling: 'Invitation to choose times',
  interview_confirmed: 'Interview confirmed',
  reschedule: 'Interview rescheduled',
  cancellation: 'Interview canceled',
  offer: 'Offer',
  rejection: 'Not moving forward',
  recruiter: 'Recruiter message',
  other: 'Message',
};
export const INTERVIEW_STATUSES = ['scheduling_needed', 'scheduled', 'canceled', 'completed'] as const;
export const INTERVIEW_FORMATS = ['video', 'phone', 'onsite', 'unknown'] as const;
export const MATERIAL_KINDS = ['resume', 'cover_letter', 'portfolio', 'writing_sample', 'other'] as const;
export const MATERIAL_LABELS: Record<(typeof MATERIAL_KINDS)[number], string> = { resume: 'Résumé', cover_letter: 'Cover letter', portfolio: 'Portfolio', writing_sample: 'Writing sample', other: 'Other material' };
export const CHANNELS = ['company_site', 'job_board', 'email', 'referral', 'recruiter', 'other'] as const;
export const CHANNEL_LABELS: Record<(typeof CHANNELS)[number], string> = { company_site: 'Company website', job_board: 'Job board', email: 'Email', referral: 'Referral', recruiter: 'Through a recruiter', other: 'Other' };
