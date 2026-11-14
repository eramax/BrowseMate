import { describe, expect, it } from 'vitest';
import { hashSecMsGecV2 } from '../src/background/edge';

describe('Edge TTS Sec-MS-GEC v2', () => {
  it('matches the reference hash', async () => {
    const input = '13300000000000000000' + '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
    await expect(hashSecMsGecV2(input)).resolves.toBe(
      '5CD14C2E1CD3CE03-4EBBF4E61CD488C512723BD3810C6C3EA371951E80195D469992809BE8D700D5',
    );
  });
});
