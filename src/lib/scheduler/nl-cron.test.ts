import { describe, expect, it } from 'vitest';
import { naturalLanguageToCron } from './nl-cron';

function ok(text: string, expression: string) {
  it(`compiles "${text}" to "${expression}"`, () => {
    const r = naturalLanguageToCron(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expression).toBe(expression);
  });
}

function fail(text: string) {
  it(`fails to compile "${text}"`, () => {
    const r = naturalLanguageToCron(text);
    expect(r.ok).toBe(false);
  });
}

describe('naturalLanguageToCron', () => {
  ok('every weekday at 9am', '0 9 * * 1-5');
  ok('every day at 9am', '0 9 * * *');
  ok('daily at 3pm', '0 15 * * *');
  ok('hourly', '0 * * * *');
  ok('every hour', '0 * * * *');
  ok('every 30 minutes', '*/30 * * * *');
  ok('every 2 hours', '0 */2 * * *');
  ok('every Monday at 10:30', '30 10 * * 1');
  ok('every monday and friday at 8am', '0 8 * * 1,5');
  ok('every weekend at noon', '0 12 * * 0,6');
  fail('blarg');
  fail('');
});
