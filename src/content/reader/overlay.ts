// شريط تحكم عائم داخل الصفحة — مقتبس من Nova TTS مع عزل الأسماء
// لا يضيف أي تبويب في البانل؛ الأزرار تظهر فوق الصفحة نفسها.

export type OverlayCallbacks = {
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSpeedChange?: (rate: number) => void;
};

const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class ReaderOverlay {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private controls: Record<string, HTMLElement> = {};
  private visible = false;
  private speedIdx = 2;
  private pendingSpeed: number | null = null;
  private callbacks: OverlayCallbacks = {};
  private onDocMove: ((e: MouseEvent) => void) | null = null;
  private onDocUp: (() => void) | null = null;

  setCallbacks(cb: OverlayCallbacks): void {
    this.callbacks = cb;
  }

  private create(): void {
    if (this.host) return;
    this.host = document.createElement('div');
    this.host.id = 'bm-reader-overlay';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .overlay {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px;
          background: rgba(18, 18, 24, 0.9);
          backdrop-filter: blur(16px) saturate(1.8);
          -webkit-backdrop-filter: blur(16px) saturate(1.8);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          cursor: grab;
          user-select: none;
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.3s ease, transform 0.3s ease;
        }
        .overlay.show { opacity: 1; transform: translateY(0); }
        .overlay.dragging { cursor: grabbing; }
        button {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.1);
          color: #e0e0e0;
          width: 36px; height: 36px;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 16px; line-height: 1;
        }
        button:hover { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.2); transform: scale(1.08); }
        button:active { transform: scale(0.95); }
        button.play-btn {
          width: 42px; height: 42px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border: none; color: #fff; font-size: 18px; border-radius: 12px;
          box-shadow: 0 4px 15px rgba(99,102,241,0.4);
        }
        button.play-btn:hover {
          box-shadow: 0 6px 20px rgba(99,102,241,0.6);
          background: linear-gradient(135deg, #818cf8, #a78bfa);
        }
        button.stop-btn { background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #f87171; }
        button.stop-btn:hover { background: rgba(239, 68, 68, 0.3); border-color: rgba(239, 68, 68, 0.5); }
        .speed {
          color: #a5b4fc; font-size: 12px; font-weight: 600;
          min-width: 36px; height: 36px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(99,102,241,0.15); border-radius: 10px;
          cursor: pointer; transition: all 0.2s ease;
          border: 1px solid rgba(99,102,241,0.2);
        }
        .speed:hover { background: rgba(99,102,241,0.3); }
        .para-info { color: rgba(255,255,255,0.45); font-size: 11px; padding: 0 4px; white-space: nowrap; }
        .brand { color: #a5b4fc; font-size: 14px; padding: 0 2px; }
        .divider { width: 1px; height: 24px; background: rgba(255,255,255,0.1); margin: 0 2px; }
      </style>
      <div class="overlay">
        <span class="brand" title="BrowseMate">✦</span>
        <div class="divider"></div>
        <button class="prev-btn" title="Previous paragraph">⏮</button>
        <button class="play-btn" title="Play / Pause">▶</button>
        <button class="next-btn" title="Next paragraph">⏭</button>
        <div class="divider"></div>
        <button class="stop-btn" title="Stop reading">⏹</button>
        <div class="divider"></div>
        <div class="speed" title="Click to change speed">1×</div>
        <span class="para-info"></span>
      </div>
    `;
    document.body.appendChild(this.host);

    const q = (sel: string) => this.shadow!.querySelector(sel) as HTMLElement;
    const overlay = q('.overlay');
    this.controls.playBtn = q('.play-btn');
    this.controls.prevBtn = q('.prev-btn');
    this.controls.nextBtn = q('.next-btn');
    this.controls.stopBtn = q('.stop-btn');
    this.controls.speedEl = q('.speed');
    this.controls.paraInfo = q('.para-info');

    this.controls.playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.controls.playBtn.textContent?.trim() === '▶') this.callbacks.onPlay?.();
      else this.callbacks.onPause?.();
    });
    this.controls.prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.callbacks.onPrev?.(); });
    this.controls.nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.callbacks.onNext?.(); });
    this.controls.stopBtn.addEventListener('click', (e) => { e.stopPropagation(); this.callbacks.onStop?.(); });
    this.controls.speedEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.speedIdx = (this.speedIdx + 1) % SPEED_STEPS.length;
      const spd = SPEED_STEPS[this.speedIdx];
      this.controls.speedEl.textContent = spd + '×';
      this.callbacks.onSpeedChange?.(spd);
    });

    let dragging = false;
    let dx = 0;
    let dy = 0;
    overlay.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'BUTTON' || t.classList.contains('speed')) return;
      dragging = true;
      dx = e.clientX - overlay.getBoundingClientRect().left;
      dy = e.clientY - overlay.getBoundingClientRect().top;
      overlay.classList.add('dragging');
    });
    document.addEventListener('mousemove', (this.onDocMove = (e) => {
      if (!dragging) return;
      overlay.style.left = e.clientX - dx + 'px';
      overlay.style.top = e.clientY - dy + 'px';
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
    }));
    document.addEventListener('mouseup', (this.onDocUp = () => {
      dragging = false;
      overlay.classList.remove('dragging');
    }));
  }

  show(): void {
    if (!this.host) this.create();
    this.visible = true;
    if (this.pendingSpeed !== null) {
      const idx = SPEED_STEPS.indexOf(this.pendingSpeed);
      if (idx >= 0) this.speedIdx = idx;
      if (this.controls.speedEl) this.controls.speedEl.textContent = this.pendingSpeed + '×';
      this.pendingSpeed = null;
    }
    requestAnimationFrame(() => {
      this.shadow?.querySelector('.overlay')?.classList.add('show');
    });
  }

  hide(): void {
    if (!this.shadow) return;
    this.shadow.querySelector('.overlay')?.classList.remove('show');
    this.visible = false;
    setTimeout(() => {
      if (!this.visible && this.host) {
        if (this.onDocMove) document.removeEventListener('mousemove', this.onDocMove);
        if (this.onDocUp) document.removeEventListener('mouseup', this.onDocUp);
        this.onDocMove = null;
        this.onDocUp = null;
        this.host.remove();
        this.host = null;
        this.shadow = null;
        this.controls = {};
      }
    }, 350);
  }

  isVisible(): boolean {
    return this.visible;
  }

  setPlaying(isPlaying: boolean): void {
    if (!this.controls.playBtn) return;
    this.controls.playBtn.textContent = isPlaying ? '⏸' : '▶';
    this.controls.playBtn.title = isPlaying ? 'Pause' : 'Play';
  }

  setParaInfo(current: number, total: number): void {
    if (!this.controls.paraInfo) return;
    this.controls.paraInfo.textContent = total > 0 ? `${current + 1}/${total}` : '';
  }

  setSpeed(rate: number): void {
    const idx = SPEED_STEPS.indexOf(rate);
    if (idx >= 0) this.speedIdx = idx;
    if (this.controls.speedEl) this.controls.speedEl.textContent = rate + '×';
    else this.pendingSpeed = rate;
  }
}
