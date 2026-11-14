// تظليل الفقرة والكلمة الحالية داخل الصفحة — مقتبس من Nova TTS مع أسماء معزولة
// يعيد HTML الأصلي عند الإيقاف حتى لا يتلف الصفحة.

export interface HighlightColors {
  paragraph: string;
  word: string;
}

export class Highlighter {
  private currentParaEl: HTMLElement | null = null;
  private originalHTML: string | null = null;
  private prevSpan: HTMLSpanElement | null = null;
  private wordSpan: HTMLSpanElement | null = null;
  private restSpan: HTMLSpanElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private currentText = '';
  private colors: HighlightColors = { paragraph: '#ffc107', word: '#00bcd4' };

  setColors(c: Partial<HighlightColors>): void {
    if (c.paragraph) this.colors.paragraph = c.paragraph;
    if (c.word) this.colors.word = c.word;
    this.updateStyles();
  }

  private hexToRgba(hex: string, alpha: number): string {
    if (!hex) return `rgba(0,0,0,${alpha})`;
    let c = hex.replace('#', '').split('');
    if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    const n = parseInt(c.join(''), 16);
    if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  private buildCSS(): string {
    const paraBg = this.hexToRgba(this.colors.paragraph, 0.15);
    const paraBorder = this.colors.paragraph;
    const wordBg = this.hexToRgba(this.colors.word, 0.5);
    const wordShadow = this.hexToRgba(this.colors.word, 0.4);
    return `
      .bm-reader-para {
        background: ${paraBg} !important;
        border-left: 3px solid ${paraBorder} !important;
        padding: 4px 8px !important;
        border-radius: 4px;
        transition: background 0.3s ease;
      }
      .bm-reader-prev { color: inherit; opacity: 0.5; }
      .bm-reader-word {
        background: ${wordBg};
        color: #000;
        padding: 1px 3px;
        border-radius: 3px;
        font-weight: 600;
        box-shadow: 0 0 8px ${wordShadow};
      }
      .bm-reader-word:empty { display: none; }
      .bm-reader-rest { color: inherit; }
    `;
  }

  private injectStyles(): void {
    if (this.styleEl?.isConnected) return;
    this.styleEl = document.createElement('style');
    this.styleEl.id = 'bm-reader-styles';
    this.styleEl.textContent = this.buildCSS();
    (document.head || document.documentElement).appendChild(this.styleEl);
  }

  private updateStyles(): void {
    if (this.styleEl) this.styleEl.textContent = this.buildCSS();
  }

  highlightParagraph(el: HTMLElement, text: string): void {
    this.clearAll();
    if (!el || !text) return;
    this.injectStyles();
    this.currentParaEl = el;
    this.currentText = text;
    this.originalHTML = el.innerHTML;

    this.prevSpan = document.createElement('span');
    this.prevSpan.className = 'bm-reader-prev';
    this.wordSpan = document.createElement('span');
    this.wordSpan.className = 'bm-reader-word';
    this.restSpan = document.createElement('span');
    this.restSpan.className = 'bm-reader-rest';
    this.restSpan.textContent = text;

    el.textContent = '';
    el.appendChild(this.prevSpan);
    el.appendChild(this.wordSpan);
    el.appendChild(this.restSpan);
    el.classList.add('bm-reader-para');
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
  }

  highlightWord(word: string, charIndex: number): void {
    if (!this.currentParaEl || !this.currentText || !this.prevSpan || !this.wordSpan || !this.restSpan) return;
    const clean = (word || '').trim();
    if (!clean) return;
    const start = Math.max(0, Math.min(charIndex, this.currentText.length));
    const end = Math.min(this.currentText.length, start + clean.length);
    this.prevSpan.textContent = this.currentText.slice(0, start);
    this.wordSpan.textContent = this.currentText.slice(start, end);
    this.restSpan.textContent = this.currentText.slice(end);

    try {
      const rect = this.wordSpan.getBoundingClientRect();
      if (rect.top < 60 || rect.bottom > window.innerHeight - 60) {
        this.wordSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch { /* ignore */ }
  }

  clearWord(): void {
    if (this.prevSpan && this.restSpan && this.wordSpan) {
      this.prevSpan.textContent = '';
      this.wordSpan.textContent = '';
      this.restSpan.textContent = this.currentText;
    }
  }

  clearParagraph(): void {
    if (this.currentParaEl && this.originalHTML !== null) {
      this.currentParaEl.innerHTML = this.originalHTML;
      this.currentParaEl.classList.remove('bm-reader-para');
    }
    this.currentParaEl = null;
    this.originalHTML = null;
    this.prevSpan = null;
    this.wordSpan = null;
    this.restSpan = null;
    this.currentText = '';
  }

  clearAll(): void {
    this.clearParagraph();
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }
}
