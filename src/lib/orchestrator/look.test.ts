import { describe, expect, it } from 'vitest';
import { APP_NAME } from '@/constants/app';
import { avatarArtSvg } from './art';
import { ORCHESTRATOR_COLORS, isOrchestratorColor, parseOrchestratorLook, textColorOn } from './look';
import { normalizeOrchestratorName } from './name';
import { ORCHESTRATOR_PRESETS } from './presets';

const image = {
  fileName: '01a0f8ec-b320-7fb4-8368-699677275515.png',
  originalName: 'me.png',
  mimeType: 'image/png',
  size: 1234,
  uploadedAt: '2026-10-01T00:00:00.000Z',
};

describe('parseOrchestratorLook', () => {
  it('leaves out what the body leaves out', () => {
    expect(parseOrchestratorLook({ name: 'Trey' })).toEqual({ patch: {} });
  });

  it('keeps one emoji and folds a blank one to none', () => {
    expect(parseOrchestratorLook({ orchestratorEmoji: ' 🍞 ' })).toEqual({ patch: { orchestratorEmoji: '🍞' } });
    expect(parseOrchestratorLook({ orchestratorEmoji: '👩‍🚀' })).toEqual({ patch: { orchestratorEmoji: '👩‍🚀' } });
    expect(parseOrchestratorLook({ orchestratorEmoji: '' })).toEqual({ patch: { orchestratorEmoji: null } });
    expect(parseOrchestratorLook({ orchestratorEmoji: null })).toEqual({ patch: { orchestratorEmoji: null } });
  });

  it('refuses words and strings of emoji', () => {
    expect(parseOrchestratorLook({ orchestratorEmoji: 'Rye' })).toHaveProperty('error');
    expect(parseOrchestratorLook({ orchestratorEmoji: '🍞🍞🍞' })).toHaveProperty('error');
    expect(parseOrchestratorLook({ orchestratorEmoji: 5 })).toHaveProperty('error');
  });

  it('holds colors to the palette', () => {
    expect(parseOrchestratorLook({ orchestratorColor: '#4F7CF0' })).toEqual({ patch: { orchestratorColor: '#4f7cf0' } });
    expect(parseOrchestratorLook({ orchestratorColor: null })).toEqual({ patch: { orchestratorColor: null } });
    expect(parseOrchestratorLook({ orchestratorColor: '#123456' })).toHaveProperty('error');
    expect(parseOrchestratorLook({ orchestratorColor: 'red' })).toHaveProperty('error');
  });

  it('takes an uploaded image and nothing else', () => {
    expect(parseOrchestratorLook({ orchestratorImage: image })).toEqual({ patch: { orchestratorImage: image } });
    expect(parseOrchestratorLook({ orchestratorImage: null })).toEqual({ patch: { orchestratorImage: null } });
    expect(parseOrchestratorLook({ orchestratorImage: { ...image, mimeType: 'application/pdf' } })).toHaveProperty('error');
    expect(parseOrchestratorLook({ orchestratorImage: { ...image, fileName: '../../etc/passwd' } })).toHaveProperty('error');
    expect(parseOrchestratorLook({ orchestratorImage: 'me.png' })).toHaveProperty('error');
  });
});

describe('the palette', () => {
  it('gives every color a readable initial', () => {
    for (const { hex } of ORCHESTRATOR_COLORS) {
      expect(isOrchestratorColor(hex)).toBe(true);
      expect(['#ffffff', '#1c1917']).toContain(textColorOn(hex));
    }
    expect(textColorOn('#f3ead8')).toBe('#1c1917');
    expect(textColorOn('#4f7cf0')).toBe('#ffffff');
  });
});

describe('ORCHESTRATOR_PRESETS', () => {
  it('starts from the default name and its mark', () => {
    expect(ORCHESTRATOR_PRESETS[0]).toMatchObject({ name: APP_NAME, emoji: null, color: null });
  });

  it('holds only names, emoji and colors a write would accept', () => {
    const names = new Set<string>();
    for (const preset of ORCHESTRATOR_PRESETS) {
      expect(normalizeOrchestratorName(preset.name)).toBe(preset.name);
      names.add(preset.name);
      const parsed = parseOrchestratorLook({ orchestratorEmoji: preset.emoji, orchestratorColor: preset.color });
      expect(parsed).toEqual({ patch: { orchestratorEmoji: preset.emoji, orchestratorColor: preset.color } });
      expect(preset.note).not.toMatch(/[—–;]/);
    }
    expect(names.size).toBe(ORCHESTRATOR_PRESETS.length);
  });
});

describe('avatarArtSvg', () => {
  it('draws the same picture for the same seed and different ones otherwise', () => {
    expect(avatarArtSvg(42)).toBe(avatarArtSvg(42));
    expect(avatarArtSvg(42)).not.toBe(avatarArtSvg(43));
  });

  it('is a plain square SVG with nothing that runs or links', () => {
    for (const seed of [0, 1, 7, 99, 2 ** 31 - 1]) {
      const svg = avatarArtSvg(seed);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toMatch(/<script|on[a-z]+=|href|<text|<foreignObject/i);
    }
  });
});
