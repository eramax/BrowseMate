import { describe, expect, it } from 'vitest';
import { toModelMessages } from '../src/background/agent';
import type { ChatMessage } from '../src/shared/types';

function msg(i: number, chars: number): ChatMessage {
  return { id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `${i}:`.padEnd(chars, 'x'), ts: i };
}

describe('agent model context', () => {
  it('keeps recent history and stays within the character budget', () => {
    const history = Array.from({ length: 30 }, (_, i) => msg(i, 10_000));
    const out = toModelMessages(history);
    const total = out.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(60_000 + 200);
    expect(out.at(-1)!.content.startsWith('29:')).toBe(true);
    expect(out[0].content).toContain('اختصار');
  });

  it('truncates a single huge message and preserves role', () => {
    const out = toModelMessages([msg(0, 100_000)]);
    expect(out).toHaveLength(1);
    expect(out[0].content.length).toBe(24_000);
    expect(out[0].role).toBe('user');
  });
});
