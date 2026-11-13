// غلاف تخزين قابل للحقن — يسمح باختبار المنطق بدون chrome APIs
export interface KV {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
}

export const chromeKV: KV = {
  get: async (k) => (await chrome.storage.local.get(k))[k] as any,
  set: async (k, v) => { await chrome.storage.local.set({ [k]: v }); },
  remove: async (k) => { await chrome.storage.local.remove(k); },
  keys: async () => Object.keys(await chrome.storage.local.get(null)),
};
