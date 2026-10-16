/** @jsxRuntime automatic */
import { useEffect } from 'react';
import { AskRiButton, Button, ButtonRow, EmptyState, ErrorState, LoadingState, StatusLabel, useQuery, useRiApp } from '@ri/app-kit/ui';
import { formatDate } from '@ri/app-kit/time';
import type { Location } from './app.js';
import type { TodayData } from './types.js';
import { durationText, FORMAT_TEXT, shortDate, viewerZone, whenText } from './format.js';

export function TodayView({ go, onSaveJob }: { go: (patch: Partial<Location>) => void; onSaveJob: () => void }) {
  const app = useRiApp();
  const today = useQuery<TodayData>('get_today', { zone: viewerZone });
  useEffect(() => {
    app.context({ section: 'today' });
  }, [app]);
  if (today.error && !today.data) return <ErrorState message={today.error} onRetry={today.reload} />;
  if (!today.data) return <LoadingState label="Loading today" />;
  const data = today.data;
  const openOpportunity = (id: string) => go({ tab: 'opportunities', opportunityId: id, selected: id, prepare: null, section: null });
  const nothing = !data.interviews.length && !data.scheduling.length && !data.deadlines.length && !data.responses.length && !data.suggestions.length;
  const dateLine = (() => {
    try {
      return formatDate(data.date, 'weekdayLong');
    } catch {
      return data.date;
    }
  })();
  if (nothing)
    return (
      <EmptyState title="Nothing needs attention today" action={data.counts.opportunities ? <Button onClick={() => go({ tab: 'opportunities' })}>View opportunities</Button> : <Button variant="primary" onClick={onSaveJob}>Save a job</Button>}>
        <p>Interviews, invitations to choose times, deadlines you set and responses that need a decision appear here.</p>
      </EmptyState>
    );
  return (
    <div className="ri-stack ri-stack--loose">
      <section className="ri-stack" aria-labelledby="js-today-interviews">
        <div className="ri-section-heading">
          <h2 id="js-today-interviews" className="ri-h2">{data.interviews.length === 0 ? 'No interviews scheduled' : data.interviews.length === 1 ? 'One interview ahead' : `${data.interviews.length} interviews ahead`}</h2>
          <p>{dateLine}</p>
        </div>
        {data.interviews.map((interview) => (
          <div className="js-strip" key={interview.interviewId}>
            <div className="js-strip__text">
              <span className="ri-eyebrow">{whenText(interview.startAt, interview.zone, { relative: true })}</span>
              <h3 className="js-strip__title">{interview.company} · {interview.title}</h3>
              <p className="js-strip__meta">{[interview.participants.join(', '), durationText(interview.startAt, interview.endAt), FORMAT_TEXT[interview.format as keyof typeof FORMAT_TEXT] ?? null, interview.prepared ? 'Preparation saved' : 'Not prepared yet'].filter(Boolean).join(' · ')}</p>
            </div>
            <ButtonRow>
              {interview.meetingLink && <Button onClick={() => void app.openExternal(interview.meetingLink!)}>Open meeting link</Button>}
              <Button variant="primary" onClick={() => go({ tab: 'opportunities', prepare: { opportunityId: interview.opportunityId, interviewId: interview.interviewId } })}>Open preparation</Button>
            </ButtonRow>
          </div>
        ))}
        {data.scheduling.map((item) => (
          <div className="js-row" key={item.interviewId}>
            <div className="js-row__text">
              <StatusLabel tone="warning">Scheduling needed</StatusLabel>
              <p className="js-row__title">{item.company} · {item.role}</p>
              <p className="ri-small ri-muted">Asked to choose interview times on {shortDate(item.since)}. Not scheduled until a time is confirmed.</p>
            </div>
            <ButtonRow>
              <AskRiButton prompt={`Help me reply to ${item.company} with my availability for the ${item.role} interview. Draft editable text only and do not send anything.`}>Draft a reply with Ri</AskRiButton>
              <Button onClick={() => openOpportunity(item.opportunityId)}>View opportunity</Button>
            </ButtonRow>
          </div>
        ))}
      </section>

      {data.deadlines.length > 0 && (
        <section className="ri-stack" aria-labelledby="js-today-actions">
          <h2 id="js-today-actions" className="ri-h2">Your next actions</h2>
          <ul className="js-list">
            {data.deadlines.map((item, index) => {
              const linked = data.followUps.find((followUp) => followUp.opportunityId === item.opportunityId && followUp.state === 'created');
              return (
                <li className="js-row" key={`${item.opportunityId}-${item.kind}-${index}`}>
                  <div className="js-row__text">
                    <p className="js-row__title">{item.kind === 'deadline' ? `${item.label} ${shortDate(item.date)}` : item.label}</p>
                    <p className="ri-small ri-muted">
                      {item.company} · {item.role}
                      {item.kind === 'action' ? (item.date ? ` · Chosen for ${shortDate(item.date)}` : ' · No date chosen') : ''}
                      {linked ? ' · Ri task linked' : ''}
                    </p>
                    {item.overdue && <StatusLabel tone="warning">Past its date</StatusLabel>}
                  </div>
                  <ButtonRow>
                    {/follow/i.test(item.label) && <AskRiButton prompt={`Help me draft a follow-up for my ${item.role} application at ${item.company}, using its saved records. Draft editable text only and do not send it.`}>Draft with Ri</AskRiButton>}
                    <Button onClick={() => openOpportunity(item.opportunityId)}>View opportunity</Button>
                  </ButtonRow>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.responses.length > 0 && (
        <section className="ri-stack" aria-labelledby="js-today-responses">
          <div className="ri-section-heading">
            <h2 id="js-today-responses" className="ri-h2">Responses needing your decision</h2>
            <p>Nothing changes until you choose</p>
          </div>
          <ul className="js-list">
            {data.responses.slice(0, 4).map((review) => (
              <li className="js-row" key={review.id}>
                <div className="js-row__text">
                  <p className="js-row__title">{review.title}</p>
                  <p className="ri-small ri-muted">{review.summary}</p>
                </div>
                <Button onClick={() => go({ tab: 'sources' })}>Review</Button>
              </li>
            ))}
          </ul>
          {data.responses.length > 4 && <Button variant="link" onClick={() => go({ tab: 'sources' })}>See all {data.responses.length} in Sources</Button>}
        </section>
      )}

      {data.suggestions.length > 0 && (
        <section className="ri-stack" aria-labelledby="js-today-suggestions">
          <div className="ri-section-heading">
            <h2 id="js-today-suggestions" className="ri-h2">Suggestions</h2>
            <p>Based only on dates you recorded. A quiet application is not a rejection.</p>
          </div>
          <ul className="js-list">
            {data.suggestions.map((item) => (
              <li className="js-row" key={item.opportunityId}>
                <div className="js-row__text">
                  <span className="js-tag">Suggestion</span>
                  <p className="js-row__title">Consider a follow-up with {item.company}</p>
                  <p className="ri-small ri-muted">{item.role} · Applied {shortDate(item.appliedOn)} · No new correspondence for {item.quietDays} days</p>
                </div>
                <ButtonRow>
                  <AskRiButton prompt={`Help me draft a short follow-up for my ${item.role} application at ${item.company}. I applied on ${item.appliedOn}. Draft editable text only and do not send it.`}>Draft with Ri</AskRiButton>
                  <Button onClick={() => openOpportunity(item.opportunityId)}>View opportunity</Button>
                </ButtonRow>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
