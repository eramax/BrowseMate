import { describe, it, expect } from 'vitest';
import { renderDocHtml, pageShell } from '../src/background/doc-template';

describe('renderDocHtml', () => {
  it('renders letter with paragraphs, meta and print support', () => {
    const html = renderDocHtml({
      title: 'Cover Letter — Software Engineer',
      subtitle: 'Acme Corp',
      meta: ['Jan 1, 2027', 'To: Hiring Manager'],
      paragraphs: ['First paragraph.', 'Second paragraph.'],
      signature: 'John Doe',
    });
    expect(html).toContain('@page');
    expect(html).toContain('A4');
    expect(html).toContain('Cover Letter');
    expect(html).toContain('First paragraph.');
    expect(html).toContain('#print');
    expect(html).toContain('window.print()');
  });
  it('renders sections with bullets', () => {
    const html = renderDocHtml({ title: 'Report', sections: [{ heading: 'Findings', bullets: ['A', 'B'] }] });
    expect(html).toContain('<h2>Findings</h2>');
    expect(html).toContain('<li>A</li>');
  });
  it('escapes untrusted text', () => {
    const html = renderDocHtml({ title: '<b>x</b>', paragraphs: ['<script>alert(1)</script>'] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('pageShell has print toolbar hidden in print CSS', () => {
    const html = pageShell({ title: 't', body: '<p>x</p>' });
    expect(html).toContain('.toolbar { display: none !important; }');
  });
});
