import { describe, it, expect } from 'vitest';
import { runSkill, validateSkill, buildSkillFromToolCalls, generalizeSteps } from '../src/background/skills';
import type { SkillFile } from '../src/shared/types';

const skill: SkillFile = {
  name: 'test-skill',
  description: 'وصف تجريبي',
  params: [{ name: 'q', type: 'string', required: true }],
  steps: [
    { tool: 'navigate', args: { url: 'https://x.com/?q={{q}}' } },
    { tool: 'read_page', args: {} },
  ],
};

const noopDeps = {
  getTool: () => undefined,
  emit: () => {},
  isSensitive: () => false,
  requestApproval: async () => true,
};

describe('skill engine', () => {
  it('validates name/steps/params', () => {
    expect(validateSkill(skill)).toBeNull();
    expect(validateSkill({ ...skill, steps: [] })).toMatch(/steps/);
    expect(validateSkill({ ...skill, params: [{ name: 'bad name!', type: 'string' }] })).toMatch(/name/);
    expect(validateSkill({ ...skill, name: 'اسم عربي صالح' })).toBeNull(); // الأسماء العربية مسموحة
    expect(validateSkill({ ...skill, name: 'bad!name' })).toMatch(/name/);
  });
  it('runs steps in order, substitutes params, aggregates results', async () => {
    const calls: any[] = [];
    const reg = new Map([
      ['navigate', { execute: async (a: any) => { calls.push(['navigate', a]); return { ok: true }; } }],
      ['read_page', { execute: async (a: any) => { calls.push(['read_page', a]); return { title: 't' }; } }],
    ]);
    const progress: any[] = [];
    const r = await runSkill(skill, { q: 'oneplus 16' }, {
      ...noopDeps,
      getTool: (n) => reg.get(n),
      emit: (e: any) => progress.push(e),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0][1].url).toBe('https://x.com/?q=oneplus 16');
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(2);
    expect(r.results[1].result).toEqual({ title: 't' });
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({ type: 'skill-progress', step: 1, total: 2 });
  });
  it('missing required param fails before running', async () => {
    const r = await runSkill(skill, {}, noopDeps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/q/);
  });
  it('stops on first failure returning partial results', async () => {
    const reg = new Map([
      ['navigate', { execute: async () => { throw new Error('boom'); } }],
      ['read_page', { execute: async () => ({}) }],
    ]);
    const r = await runSkill(skill, { q: 'x' }, { ...noopDeps, getTool: (n) => reg.get(n) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
    expect(r.results).toHaveLength(0);
  });
  it('unknown tool fails', async () => {
    const r = await runSkill(skill, { q: 'x' }, noopDeps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/navigate/);
  });
  it('aborted signal returns user-cancelled between steps', async () => {    const ac = new AbortController();
    const reg = new Map([
      ['navigate', { execute: async () => { ac.abort(); return {}; } }],
      ['read_page', { execute: async () => ({}) }],
    ]);
    const r = await runSkill(skill, { q: 'x' }, { ...noopDeps, getTool: (n) => reg.get(n), signal: ac.signal });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ألغى المستخدم');
    expect(r.results).toHaveLength(1); // نتيجة الخطوة الأولى فقط
  });
});

describe('buildSkillFromToolCalls', () => {
  it('builds steps from successful real tool calls only (skips meta/failed)', () => {
    const r = buildSkillFromToolCalls('مهارة جديدة', 'وصف', [
      { name: 'navigate', args: { url: 'https://x.com' }, status: 'ok' },
      { name: 'read_page', args: {}, status: 'ok' },
      { name: 'save_skill', args: { skill: {} }, status: 'ok' },
      { name: 'click_element', args: { label: 'x' }, status: 'refused' },
    ]);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.name).toBe('مهارة جديدة');
    expect(r.steps.map((s) => s.tool)).toEqual(['navigate', 'read_page']);
  });
  it('rejects when nothing usable', () => {
    const r = buildSkillFromToolCalls('x', '', [
      { name: 'save_skill', args: {}, status: 'ok' },
      { name: 'navigate', args: {}, status: 'error' },
    ]);
    expect('error' in r).toBe(true);
  });
});

describe('generalizeSteps', () => {
  it('replaces concrete values with {{param}} placeholders (longest first)', () => {
    const steps = [
      { tool: 'navigate', args: { url: 'https://github.com/ripienaar/free-for-dev/commits' } },
      { tool: 'read_page', args: {} },
      { tool: 'navigate', args: { url: 'https://github.com/search?q=ripienaar/free-for-dev' } },
    ];
    const out = generalizeSteps(steps, [
      { param: 'repo', value: 'ripienaar/free-for-dev' },
      { param: 'url', value: 'https://github.com/ripienaar/free-for-dev/commits' },
    ]);
    expect(out[0].args.url).toBe('{{url}}');
    expect(out[2].args.url).toBe('https://github.com/search?q={{repo}}');
  });
  it('leaves args untouched with no replacements', () => {
    const steps = [{ tool: 'x', args: { a: 'b' } }];
    expect(generalizeSteps(steps, [])).toEqual(steps);
  });
});
