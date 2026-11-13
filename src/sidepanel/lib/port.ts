// اتصال الـ panel مع SW — Port واحد للأحداث المتدفقة + rpc للطلبات البسيطة
import type { PanelToWorker, WorkerToPanel } from '../../shared/types';

export function openPanelPort(onEvent: (e: WorkerToPanel) => void) {
  const port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener(onEvent);
  return {
    send: (msg: PanelToWorker) => port.postMessage(msg),
    disconnect: () => port.disconnect(),
  };
}

export function rpc<T = any>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
  return chrome.runtime.sendMessage({ type, ...extra }) as Promise<T>;
}
