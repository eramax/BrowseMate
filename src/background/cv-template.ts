// قالب سيرة ذاتية ثابت (ATS-friendly) — النموذج يملأ JSON فقط، والتنسيق هنا (أسرع وأدق)
import { pageShell, escapeHtml } from './doc-template';

export interface CvData {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
  summary?: string;
  skills?: string[];
  experience?: Array<{ company: string; role: string; start?: string; end?: string; location?: string; bullets: string[] }>;
  education?: Array<{ school: string; degree?: string; start?: string; end?: string; details?: string }>;
  projects?: Array<{ name: string; description?: string; bullets?: string[] }>;
  certifications?: string[];
  languages?: string[];
}

const esc = escapeHtml;

const CV_CSS = `
  header { border-bottom: 1.5px solid #16181d; padding-bottom: 7px; margin-bottom: 12px; }
  .title { margin: 2px 0 4px; font-size: 11pt; color: #3c4250; }
  .contact { font-size: 9.2pt; color: #4a505e; }
  .contact span { margin-inline-end: 10px; white-space: nowrap; }
  .skills { margin: 0; padding: 0; list-style: none; }
  .skills li { display: inline; }
  .skills li:not(:last-child)::after { content: " · "; color: #8a90a0; }
  .item { margin-bottom: 7px; page-break-inside: avoid; }
  .line { display: flex; justify-content: space-between; gap: 10px; }
  .role { font-weight: 700; }
  .dates { color: #5a6070; font-size: 9.4pt; white-space: nowrap; }
  .sub { color: #3c4250; font-size: 9.8pt; margin-top: 1px; }
`;

const section = (title: string, body: string) =>
  body.trim() ? `<section><h2>${esc(title)}</h2>${body}</section>` : '';

export function renderCvHtml(d: CvData): string {
  const contact = [d.email, d.phone, d.location, ...(d.links ?? [])].filter(Boolean);
  const skills = (d.skills ?? []).filter(Boolean);
  const exp = (d.experience ?? [])
    .map((e) => {
      const dates = [e.start, e.end].filter(Boolean).join(' – ');
      const bullets = (e.bullets ?? []).filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join('');
      return `<div class="item">
        <div class="line"><span class="role">${esc(e.role)}</span><span class="dates">${esc(dates)}</span></div>
        <div class="sub">${esc(e.company)}${e.location ? ` · ${esc(e.location)}` : ''}</div>
        ${bullets ? `<ul>${bullets}</ul>` : ''}
      </div>`;
    })
    .join('');
  const edu = (d.education ?? [])
    .map((e) => {
      const dates = [e.start, e.end].filter(Boolean).join(' – ');
      return `<div class="item">
        <div class="line"><span class="role">${esc(e.degree ?? '')}</span><span class="dates">${esc(dates)}</span></div>
        <div class="sub">${esc(e.school)}${e.details ? ` — ${esc(e.details)}` : ''}</div>
      </div>`;
    })
    .join('');
  const projects = (d.projects ?? [])
    .map((p) => {
      const bullets = (p.bullets ?? []).filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join('');
      return `<div class="item">
        <div class="line"><span class="role">${esc(p.name)}</span></div>
        ${p.description ? `<div class="sub">${esc(p.description)}</div>` : ''}
        ${bullets ? `<ul>${bullets}</ul>` : ''}
      </div>`;
    })
    .join('');

  const body = `
<header>
  <h1>${esc(d.name)}</h1>
  ${d.title ? `<div class="title">${esc(d.title)}</div>` : ''}
  ${contact.length ? `<div class="contact">${contact.map((c) => `<span>${esc(String(c))}</span>`).join('')}</div>` : ''}
</header>
${section('Summary', d.summary ? `<p>${esc(d.summary)}</p>` : '')}
${section('Core Skills', skills.length ? `<ul class="skills">${skills.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '')}
${section('Experience', exp)}
${section('Projects', projects)}
${section('Education', edu)}
${section('Certifications', (d.certifications ?? []).length ? `<ul>${(d.certifications ?? []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '')}
${section('Languages', (d.languages ?? []).length ? `<ul class="skills">${(d.languages ?? []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '')}`;

  return pageShell({ title: `${d.name} — CV`, body, css: CV_CSS });
}
