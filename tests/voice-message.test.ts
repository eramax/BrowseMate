import { describe, expect, it } from 'vitest';
import { extractVoiceMessage } from '../src/background/agent';

describe('extractVoiceMessage', () => {
  it('extracts a voice message from a successful read_aloud result', () => {
    const v = extractVoiceMessage('read_aloud', {
      ok: true,
      data: {
        text: 'مرحباً بالعالم',
        voice: 'ar-EG-ShakirNeural',
        rate: 1.25,
        engine: 'edge',
        count: 1,
        total: 1,
      },
    });
    expect(v).toMatchObject({
      text: 'مرحباً بالعالم',
      voice: 'ar-EG-ShakirNeural',
      rate: 1.25,
      engine: 'edge',
    });
    expect(v?.id).toBeTruthy();
    expect(v?.createdAt).toBeGreaterThan(0);
  });

  it('reuses the playback voiceId so the live card binds to the saved message', () => {
    const v = extractVoiceMessage('read_aloud', {
      ok: true,
      data: { text: 'نص', voice: 'ar-EG-ShakirNeural', rate: 1, engine: 'edge', voiceId: 'voice-42' },
    });
    expect(v?.id).toBe('voice-42');
  });

  it('keeps a browser-default voice with an empty voice name', () => {
    const v = extractVoiceMessage('read_aloud', {
      ok: true,
      data: { text: 'Hello', voice: '', rate: 1, engine: 'browser' },
    });
    expect(v).toMatchObject({ text: 'Hello', voice: '', engine: 'browser' });
  });

  it('ignores other tools, errors and empty text', () => {
    expect(extractVoiceMessage('read_page', { ok: true, data: { text: 'x', voice: 'v' } })).toBeNull();
    expect(extractVoiceMessage('read_aloud', { ok: false, data: { text: 'x', voice: 'v' } })).toBeNull();
    expect(extractVoiceMessage('read_aloud', { ok: true, data: { text: '', voice: 'v' } })).toBeNull();
  });
});
