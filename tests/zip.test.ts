import { describe, it, expect } from 'vitest';
import { createZip, readZip } from '../src/shared/zip';

describe('zip', () => {
  it('creates a stored zip and reads it back (UTF-8 paths)', async () => {
    const files = [
      { path: 'skills/web-builder/SKILL.md', data: '---\nname: "web-builder"\n---\nمحتوى' },
      { path: 'skills/cv-tailor/SKILL.md', data: '---\nname: "السيرة"\n---\nنص' },
    ];
    const zip = createZip(files);
    expect(zip[0]).toBe(0x50);
    const out = await readZip(zip);
    expect(out).toHaveLength(2);
    expect(out[0].path).toContain('web-builder');
    expect(out[1].data).toBe(files[1].data);
  });
  it('rejects non-zip input', async () => {
    await expect(readZip(new Uint8Array([1, 2, 3]))).rejects.toThrow(/ZIP/);
  });
});
