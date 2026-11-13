// أدوات الصفحة داخل سياق الصفحة: قراءة/ملء/نقر — يُحقن عند الطلب فقط
// السجل: كل عنصر تفاعلي يحصل على معرف ta-N حتى تعيد الوكيل استخدامه في fill/click
interface Elem {
  id: string;
  tag: string;
  kind: 'input' | 'button' | 'link';
  label: string;
  placeholder?: string;
  value?: string;
}

const registry = new Map<string, HTMLElement>();
let nextId = 1;

function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l) return l.textContent?.trim() ?? '';
  }
  const inner = el.closest('label');
  if (inner) return inner.textContent?.trim() ?? '';
  const ph = (el as HTMLInputElement).placeholder;
  if (ph) return ph;
  return el.textContent?.trim().slice(0, 60) ?? '';
}

function collectInteractive(): Elem[] {
  const out: Elem[] = [];
  document.querySelectorAll<HTMLElement>('input, textarea, select, button, a[href], [role="button"]').forEach((el) => {
    if (!el.offsetParent && el.tagName !== 'A') return; // تخطي المخفي
    const kind =
      el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ? 'input'
      : el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? 'button'
      : el.tagName === 'A' ? 'link' : 'button';
    const id = `ta-${nextId++}`;
    el.setAttribute('data-ta-id', id);
    registry.set(id, el);
    out.push({
      id,
      tag: el.tagName.toLowerCase(),
      kind: kind as Elem['kind'],
      label: labelOf(el),
      placeholder: (el as HTMLInputElement).placeholder || undefined,
      value: (el as HTMLInputElement).value || undefined,
    });
  });
  return out.slice(0, 200);
}

chrome.runtime.onMessage.addListener((msg: any, _s, send) => {
  if (msg?.__ta !== 'page-tools') return;
  (async () => {
    if (msg.op === 'ping') { send({ ok: true }); return; }
    if (msg.op === 'read') {
      const text = document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 6000);
      send({ ok: true, data: { title: document.title, url: location.href, text, elements: collectInteractive() } });
      return;
    }
    if (msg.op === 'fill') {
      for (const { id, value } of msg.values as Array<{ id: string; value: string }>) {
        const el = registry.get(id) as HTMLInputElement | undefined;
        if (!el) { send({ ok: false, error: `element ${id} not found (re-read the page)` }); return; }
        el.focus();
        (el as any).value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      }
      send({ ok: true, data: { filled: msg.values.length } });
      return;
    }
    if (msg.op === 'click') {
      const el = msg.id
        ? registry.get(msg.id)
        : [...document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')]
            .find((e) => (e.textContent?.trim() || e.getAttribute('aria-label') || '').includes(msg.label));
      if (!el) { send({ ok: false, error: 'element not found (re-read the page)' }); return; }
      el.scrollIntoView({ block: 'center' });
      el.click();
      send({ ok: true, data: { clicked: true } });
    }
  })();
  return true; // رد غير متزامن
});
