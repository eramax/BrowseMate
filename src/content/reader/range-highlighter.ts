// تظليل القراءة عبر CSS Custom Highlight API — لا يلمس DOM ولا يعيد كتابة innerHTML.
// إن لم يدعم المتصفح الـ API، نعود إلى Highlighter القديم (Nova TTS).

import { Highlighter } from './highlighter';
import type { HighlightColors } from './highlighter';
import { rangeForTextOffset } from './pointer';

const PARA_NAME = 'bm-reader-para';
const WORD_NAME = 'bm-reader-word';
const STYLE_ID = 'bm-reader-range-styles';

interface HighlighterLike {
  setColors(c: Partial<HighlightColors>): void;
  highlightParagraph(el: HTMLElement, text: string): void;
  highlightWord(word: string, charIndex: number): void;
  clearWord(): void;
  clearAll(): void;
}

function hexToRgba(hex: string, alpha: number): string {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  let c = hex.replace('#', '').split('');
  if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
  const n = parseInt(c.join(''), 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

class CssRangeHighlighter implements HighlighterLike {
  private currentEl: HTMLElement | null = null;
  private colors: HighlightColors = { paragraph: '#ffc107', word: '#00bcd4' };
  private styleEl: HTMLStyleElement | null = null;

  setColors(c: Partial<HighlightColors>): void {
    if (c.paragraph) this.colors.paragraph = c.paragraph;
    if (c.word) this.colors.word = c.word;
    if (this.styleEl) this.styleEl.textContent = this.buildCSS();
  }

  private buildCSS(): string {
    return `
      ::highlight(${PARA_NAME}) {
        background-color: ${hexToRgba(this.colors.paragraph, 0.18)};
      }
      ::highlight(${WORD_NAME}) {
        background-color: ${hexToRgba(this.colors.word, 0.6)};
        color: #000;
      }
    `;
  }

  private ensureStyle(): void {
    if (this.styleEl?.isConnected) return;
    this.styleEl = document.createElement('style');
    this.styleEl.id = STYLE_ID;
    this.styleEl.textContent = this.buildCSS();
    (document.head || document.documentElement).appendChild(this.styleEl);
  }

  private rangesApi(): { highlights: any; Highlight: any } | null {
    const w = globalThis as any;
    if (w.CSS?.highlights && typeof w.Highlight === 'function') {
      return { highlights: w.CSS.highlights, Highlight: w.Highlight };
    }
    return null;
  }

  private scrollToRange(range: Range): void {
    try {
      const rect = range.getBoundingClientRect();
      if (rect.top < 60 || rect.bottom > window.innerHeight - 60) {
        window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: 'smooth' });
      }
    } catch {
      /* ignore */
    }
  }

  highlightParagraph(el: HTMLElement, text: string): void {
    this.clearAll();
    const api = this.rangesApi();
    if (!api || !el.isConnected) return;
    this.currentEl = el;
    this.ensureStyle();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      api.highlights.set(PARA_NAME, new api.Highlight(range));
      this.scrollToRange(range);
    } catch {
      /* ignore */
    }
  }

  highlightWord(word: string, charIndex: number): void {
    const api = this.rangesApi();
    if (!api || !this.currentEl) return;
    const clean = (word || '').trim();
    if (!clean) return;
    // لا نحاول مطابقة الكلمات داخل <pre> لأن النص المطبّع يختلف عن الأسطر
    if (this.currentEl.tagName === 'PRE') return;
    const range = rangeForTextOffset(this.currentEl, charIndex, clean.length);
    if (!range) return;
    try {
      api.highlights.set(WORD_NAME, new api.Highlight(range));
      this.scrollToRange(range);
    } catch {
      /* ignore */
    }
  }

  clearWord(): void {
    try { this.rangesApi()?.highlights.delete(WORD_NAME); } catch { /* ignore */ }
  }

  clearAll(): void {
    try {
      const h = this.rangesApi()?.highlights;
      h?.delete(WORD_NAME);
      h?.delete(PARA_NAME);
    } catch {
      /* ignore */
    }
    this.currentEl = null;
  }
}

/** واجهة موحّدة: CSS Highlight إن توفر، وإلا التظليل القديم */
export class ReaderHighlighter implements HighlighterLike {
  private impl: HighlighterLike;

  constructor() {
    const w = globalThis as any;
    this.impl = w.CSS?.highlights && typeof w.Highlight === 'function'
      ? new CssRangeHighlighter()
      : new Highlighter();
  }

  setColors(c: Partial<HighlightColors>): void { this.impl.setColors(c); }
  highlightParagraph(el: HTMLElement, text: string): void { this.impl.highlightParagraph(el, text); }
  highlightWord(word: string, charIndex: number): void { this.impl.highlightWord(word, charIndex); }
  clearWord(): void { this.impl.clearWord(); }
  clearAll(): void { this.impl.clearAll(); }
}
