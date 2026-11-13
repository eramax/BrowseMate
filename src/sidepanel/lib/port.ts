// اتصال الـ panel مع SW — إعادة اتصال تلقائية (SW يُطفأ في MV3) + rpc
import type { PanelToWorker, WorkerToPanel } from '../../shared/types';

export function openPanelPort(
  onEvent: (e: WorkerToPanel) => void,
  onReconnect?: () => void,
) {
  let port: chrome.runtime.Port | null = null;
  let everConnected = false;

  function connect() {
    port = chrome.runtime.connect({ name: 'panel' });
    port.onMessage.addListener(onEvent as any);
    port.onDisconnect.addListener(() => {
      port = null;
      // إعادة اتصال فورية — الأحداث الفائتة تُستعاد عبر resync من الجلسة
      setTimeout(() => {
        try {
          connect();
          if (everConnected) onReconnect?.();
          everConnected = true;
        } catch { /* الإضافة أُعيد تحميلها */ }
      }, 50);
    });
    everConnected = true;
  }
  connect();

  return {
    send(msg: PanelToWorker) {
      if (!port) {
        try { connect(); } catch { return; }
      }
      try { port!.postMessage(msg); }
      catch {
        // انقطع بين الفحص والإرسال — أعد الاتصال ثم أرسل مرة واحدة
        try { connect(); port!.postMessage(msg); } catch { /* تجاهل: resync لاحق */ }
      }
    },
    disconnect() { port?.disconnect(); port = null; },
  };
}

export function rpc<T = any>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
  return chrome.runtime.sendMessage({ type, ...extra }) as Promise<T>;
}
