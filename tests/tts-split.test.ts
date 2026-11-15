import { describe, expect, it } from 'vitest';
import { buildSpeechSegments, splitForSpeech, speechKey } from '../src/background/tts-split';

describe('speech splitting', () => {
  it('keeps short text as one segment', () => {
    expect(splitForSpeech('نص قصير')).toEqual(['نص قصير']);
  });

  it('splits long text at sentence/word boundaries under the max', () => {
    const text = ('هذه جملة عربية للاختبار. ' + 'وهذه جملة أخرى طويلة نسبياً. ').repeat(12);
    const parts = splitForSpeech(text, 200);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(200);
    expect(parts.join(' ')).toContain('جملة عربية');
    expect(parts.join(' ')).toContain('جملة أخرى');
  });

  it('still makes progress when the text has no spaces', () => {
    const parts = splitForSpeech('ا'.repeat(900), 200);
    expect(parts.length).toBe(5);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
  });

  it('creates stable keys for the same text/voice/rate', () => {
    const a = buildSpeechSegments('نص للتحميل', 'ar-EG-ShakirNeural', 1);
    const b = buildSpeechSegments('نص للتحميل', 'ar-EG-ShakirNeural', 1);
    expect(a).toEqual(b);
    expect(a[0].key).toBe(speechKey('نص للتحميل', 'ar-EG-ShakirNeural', 1));
    expect(a[0].key).not.toBe(speechKey('نص للتحميل', 'ar-EG-ShakirNeural', 1.5));
  });
});
