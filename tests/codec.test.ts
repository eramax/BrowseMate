import { describe, it, expect } from 'vitest';
import { pack, unpack, chunkString } from '../src/shared/codec';

describe('codec', () => {
  it('round-trips unicode text through gzip+base64', async () => {
    const text = JSON.stringify({ name: 'السيرة الذاتية', body: 'x'.repeat(5000), emoji: '🧪' });
    const packed = await pack(text);
    expect(packed.startsWith('gz:') || packed.startsWith('raw:')).toBe(true);
    expect(await unpack(packed)).toBe(text);
  });
  it('compresses repetitive data substantially', async () => {
    const text = JSON.stringify({ skills: Array.from({ length: 50 }, (_, i) => ({ name: `skill-${i}`, context: 'ا'.repeat(200) })) });
    const packed = await pack(text);
    if (packed.startsWith('gz:')) expect(packed.length).toBeLessThan(text.length / 2);
  });
  it('chunks and reassembles exactly', () => {
    const s = 'abcdef'.repeat(5000);
    const chunks = chunkString(s, 6000);
    expect(chunks.every((c) => c.length <= 6000)).toBe(true);
    expect(chunks.join('')).toBe(s);
  });
});
