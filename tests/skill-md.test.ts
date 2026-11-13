import { describe, it, expect } from 'vitest';
import { toSkillMd, fromSkillMd } from '../src/shared/skill-md';
import type { SkillFile } from '../src/shared/types';

const skill: SkillFile = {
  name: 'web-builder',
  description: 'يبني موقعاً بملف HTML واحد',
  whenToUse: 'عند طلب تصميم موقع',
  site: 'أي متصفح',
  notes: 'CDN فقط',
  params: [{ name: 'style', type: 'string', description: 'الطابع', example: 'dark' }],
  steps: [{ tool: 'preview_html', args: { filename: 'index.html' } }],
  instructions: 'استخدم Tailwind CDN أو CSS داخلي.\n\n```js\nconsole.log("hi");\n```',
  context: '# السيرة\nخبرة 8 سنوات',
};

describe('SKILL.md format', () => {
  it('round-trips all fields including JS code and Arabic context', () => {
    const md = toSkillMd(skill);
    expect(md.startsWith('---')).toBe(true);
    expect(md).toContain('```skill-context');
    const r = fromSkillMd(md);
    expect(r.error).toBeUndefined();
    const s = r.skill!;
    expect(s.name).toBe(skill.name);
    expect(s.description).toBe(skill.description);
    expect(s.whenToUse).toBe(skill.whenToUse);
    expect(s.params).toEqual(skill.params);
    expect(s.steps).toEqual(skill.steps);
    expect(s.instructions).toContain('console.log("hi")');
    expect(s.context).toContain('خبرة 8 سنوات');
  });
  it('accepts playbook-only skills (no steps)', () => {
    const md = toSkillMd({ ...skill, steps: [], instructions: 'افعل كذا' });
    const r = fromSkillMd(md);
    expect(r.skill!.steps).toEqual([]);
    expect(r.skill!.instructions).toBe('افعل كذا');
  });
  it('rejects files without frontmatter', () => {
    expect(fromSkillMd('# hello').error).toMatch(/---/);
  });
});
