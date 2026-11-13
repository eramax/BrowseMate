import { describe, it, expect } from 'vitest';
import { renderCvHtml } from '../src/background/cv-template';

const base = {
  name: 'John Doe',
  title: 'Software Engineer',
  email: 'john@example.com',
  summary: 'Engineer with 8 years of experience.',
  skills: ['TypeScript', 'React'],
  experience: [
    { company: 'Acme', role: 'Senior Engineer', start: '2020', end: 'Present', bullets: ['Built X', 'Led Y'] },
  ],
  education: [{ school: 'TU', degree: 'BSc CS', start: '2012', end: '2016' }],
};

describe('renderCvHtml', () => {
  it('renders A4 print CSS and core sections', () => {
    const html = renderCvHtml(base);
    expect(html).toContain('@page');
    expect(html).toContain('A4');
    expect(html).toContain('Summary');
    expect(html).toContain('Core Skills');
    expect(html).toContain('Experience');
    expect(html).toContain('Education');
    expect(html).toContain('John Doe');
  });
  it('escapes HTML in all user fields', () => {
    const html = renderCvHtml({ ...base, name: '<img src=x onerror=alert(1)>', summary: '<script>x</script>' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;img');
  });
  it('omits empty sections', () => {
    const html = renderCvHtml({ name: 'A' });
    expect(html).not.toContain('<h2>Experience</h2>');
    expect(html).not.toContain('<h2>Projects</h2>');
  });
});
