import { describe, expect, it } from 'vitest';
import { buildEdgeWsUrl } from '../src/background/edge';

describe('Edge synthesis endpoint', () => {
  it('uses the Edge 155+ msedgeservices host and the legacy subscription token', async () => {
    const url = new URL(await buildEdgeWsUrl());
    expect(url.protocol).toBe('wss:');
    expect(url.host).toBe('api.msedgeservices.com');
    expect(url.pathname).toBe('/tts/cognitiveservices/websocket/v1');
    expect(url.searchParams.get('Ocp-Apim-Subscription-Key')).toBe(
      '6A5AA1D4EAFF4E9FB37E23D68491D6F4',
    );
    expect(url.searchParams.get('Sec-MS-GEC')).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
    expect(url.searchParams.get('Sec-MS-GEC-Version')).toBe('2-143.0.3650.96');
    expect(url.searchParams.get('ConnectionId')).toBeTruthy();
  });
});
