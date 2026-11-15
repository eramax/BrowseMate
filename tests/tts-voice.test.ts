import { describe, expect, it } from 'vitest';
import { detectTextLang, edgeVoiceFor, pickBrowserVoice } from '../src/background/tts-voice';

const browserVoices = [
  { name: 'English US', lang: 'en-US', supportsWord: true },
  { name: 'Arabic Egypt', lang: 'ar-EG', supportsWord: false },
  { name: 'Arabic Saudi', lang: 'ar-SA', supportsWord: true },
];

describe('voice selection', () => {
  it('detects Arabic, English and numeric/other text', () => {
    expect(detectTextLang('مرحباً بكم في BrowseMate')).toBe('ar');
    expect(detectTextLang('Hello from BrowseMate')).toBe('en');
    expect(detectTextLang('12345 — 678')).toBe('other');
  });

  it('chooses Shakir for Arabic and Emma for English/other by default', () => {
    expect(edgeVoiceFor('نص عربي')).toBe('ar-EG-ShakirNeural');
    expect(edgeVoiceFor('English text')).toBe('en-US-EmmaMultilingualNeural');
    expect(edgeVoiceFor('12345')).toBe('en-US-EmmaMultilingualNeural');
    expect(edgeVoiceFor('نص', 'ar-SA-HamedNeural')).toBe('ar-SA-HamedNeural');
    expect(edgeVoiceFor('نص', 'Google UK English Female')).toBe('ar-EG-ShakirNeural');
  });

  it('never keeps an Edge voice when falling back to browser voices', () => {
    const picked = pickBrowserVoice('نص عربي', browserVoices, 'ar-EG-ShakirNeural');
    expect(picked).toBe('Arabic Saudi'); // supportsWord أولاً
    expect(browserVoices.some((v) => v.name === picked)).toBe(true);
  });

  it('accepts an explicitly requested browser voice', () => {
    expect(pickBrowserVoice('نص عربي', browserVoices, 'Arabic Egypt')).toBe('Arabic Egypt');
  });

  it('falls back to any installed voice instead of the empty default', () => {
    const onlyEnglish = [{ name: 'English US', lang: 'en-US' }];
    expect(pickBrowserVoice('نص عربي', onlyEnglish)).toBe('English US');
    expect(pickBrowserVoice('نص عربي', [])).toBe('');
  });
});
