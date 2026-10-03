import { describe, expect, it } from 'vitest';
import { APP_NAME } from '@/constants/app';
import {
  DEFAULT_ORCHESTRATOR_NAME,
  normalizeOrchestratorName,
  orchestratorInitial,
  resolveOrchestratorName,
} from './name';

describe('resolveOrchestratorName', () => {
  it('gives a home that never chose the app name', () => {
    expect(DEFAULT_ORCHESTRATOR_NAME).toBe(APP_NAME);
    expect(resolveOrchestratorName(null)).toBe(APP_NAME);
    expect(resolveOrchestratorName(undefined)).toBe(APP_NAME);
  });

  it('treats a blank stored name as never chosen', () => {
    expect(resolveOrchestratorName('')).toBe(APP_NAME);
    expect(resolveOrchestratorName('   ')).toBe(APP_NAME);
  });

  it('keeps the name the user picked', () => {
    expect(resolveOrchestratorName('Atlas')).toBe('Atlas');
  });
});

describe('normalizeOrchestratorName', () => {
  it('trims and folds whitespace so the brief stays one line', () => {
    expect(normalizeOrchestratorName('  Atlas  ')).toBe('Atlas');
    expect(normalizeOrchestratorName('Chief\nof\t\tStaff')).toBe('Chief of Staff');
    expect(normalizeOrchestratorName('Atlas\r\n# New rules')).toBe('Atlas # New rules');
  });

  it('drops control characters', () => {
    expect(normalizeOrchestratorName('At\u0000las')).toBe('At las');
  });

  it('stores an empty name as null, meaning the default', () => {
    expect(normalizeOrchestratorName('')).toBeNull();
    expect(normalizeOrchestratorName(' \n ')).toBeNull();
  });

  it('ignores anything that is not text', () => {
    expect(normalizeOrchestratorName(null)).toBeNull();
    expect(normalizeOrchestratorName(42)).toBeNull();
    expect(normalizeOrchestratorName({ name: 'Atlas' })).toBeNull();
  });
});

describe('orchestratorInitial', () => {
  it('uppercases the first letter', () => {
    expect(orchestratorInitial('atlas')).toBe('A');
    expect(orchestratorInitial(APP_NAME)).toBe(APP_NAME.charAt(0).toUpperCase());
  });

  it('keeps a whole emoji', () => {
    expect(orchestratorInitial('🦊 Fox')).toBe('🦊');
    expect(orchestratorInitial('👩‍🚀 Ada')).toBe('👩‍🚀');
  });

  it('falls back to the default initial for a blank name', () => {
    expect(orchestratorInitial('  ')).toBe(DEFAULT_ORCHESTRATOR_NAME.charAt(0).toUpperCase());
  });
});
