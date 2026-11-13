// عميل LLM — الاتصال الخارجي الوحيد بالإضافة (بدون backend، المواصفة §1/§6)
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { loadSettings, isConfigured } from './settings';

export async function makeModel() {
  const s = await loadSettings();
  if (!isConfigured(s)) throw new Error('SETTINGS_MISSING');
  const provider = createOpenAICompatible({ name: 'browsemate', baseURL: s.baseUrl, apiKey: s.apiKey });
  return provider.chatModel(s.model);
}

export async function listModels(): Promise<string[]> {
  const { baseUrl, apiKey } = await loadSettings();
  if (!baseUrl || !apiKey) throw new Error('SETTINGS_MISSING');
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`models fetch failed: HTTP ${res.status}`);
  const data: any = await res.json();
  const list = data.data ?? data.models ?? data;
  return (Array.isArray(list) ? list : [])
    .map((m: any) => m.id ?? m.name)
    .filter((id: unknown): id is string => typeof id === 'string')
    .sort();
}
