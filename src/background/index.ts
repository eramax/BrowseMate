// نقطة دخول SW — توصيل كل المكونات: Port + RPC + الجلسات + الموافقات + الوكيل
import { loadSettings, saveSettings } from './settings';
import { listModels } from './llm';
import { createSessionStore, MAX_MSGS_PER_SESSION } from './sessions';
import { createApprovalManager } from './approvals';
import { runChat } from './agent';
import { chromeKV } from '../shared/storage';
import { validateSkill } from './skills';
import { setLang } from '../shared/i18n';
import type { PanelToWorker, WorkerToPanel, SkillFile } from '../shared/types';
import './tools/page';
import './tools/tabs';
import './tools/misc';
import './tools/inspect';
import './tools/skillTools';

const sessions = createSessionStore(chromeKV);
const approvals = createApprovalManager();
const runs = new Map<string, AbortController>();

let port: chrome.runtime.Port | undefined;
let activeSessionId = '';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
chrome.runtime.onStartup?.addListener?.(initLang);
initLang();

async function initLang() {
  const s = await loadSettings();
  setLang(s.lang);
}

chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'panel') return;
  port = p;
  p.onDisconnect.addListener(() => { port = undefined; });
  p.onMessage.addListener((msg: PanelToWorker) => {
    if (msg.type === 'chat') {
      activeSessionId = msg.sessionId;
      runChat({ sessions, emit, getActiveTab, approvals, runs }, msg.sessionId, msg.text)
        .catch((e) => emit(msg.sessionId, { type: 'error', message: String(e) }));
    } else if (msg.type === 'approval-response') {
      approvals.resolve(msg.id, msg.approved);
    } else if (msg.type === 'stop') {
      for (const ac of runs.values()) ac.abort(); // يلغي البث والمهارات الجارية (بين الخطوات)
    } else if (msg.type === 'session-switch') {
      activeSessionId = msg.sessionId;
    }
  });
});

function emit(sessionId: string, evt: WorkerToPanel) {
  port?.postMessage({ ...evt, sessionId });
}

// ===== RPC بسيط للطلبات غير المتدفقة (إعدادات/جلسات/مهارات) =====
chrome.runtime.onMessage.addListener((msg: any, _s, send) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'list-models': {
          try { send({ ok: true, models: await listModels() }); }
          catch (e: any) { send({ ok: false, error: e.message === 'SETTINGS_MISSING' ? 'FILL_FIRST' : e.message }); }
          break;
        }
        case 'save-settings': {
          await saveSettings(msg.patch);
          if (msg.patch.lang) setLang(msg.patch.lang);
          send({ ok: true });
          break;
        }
        case 'get-settings': send({ ok: true, settings: await loadSettings() }); break;
        case 'ensure-session': {
          const first = (await sessions.list())[0];
          if (first) { send({ ok: true, id: first.id }); break; }
          const s = await sessions.create('جلسة جديدة');
          send({ ok: true, id: s.id });
          break;
        }
        case 'get-session': send({ ok: true, session: await sessions.get(msg.id) }); break;
        case 'list-sessions': send({ ok: true, sessions: await sessions.list() }); break;
        case 'new-session': {
          const s = await sessions.create(msg.title || 'جلسة جديدة');
          activeSessionId = s.id;
          send({ ok: true, session: s });
          break;
        }
        case 'delete-session': {
          await sessions.remove(msg.id);
          if (activeSessionId === msg.id) activeSessionId = '';
          send({ ok: true });
          break;
        }
        case 'rename-session': {
          await sessions.update(msg.id, { title: msg.title });
          send({ ok: true });
          break;
        }
        case 'list-skills': {
          const all = (await chromeKV.get<Record<string, SkillFile>>('skills')) ?? {};
          send({ ok: true, skills: Object.values(all) });
          break;
        }
        case 'import-skill': {
          const err = validateSkill(msg.skill);
          if (err) { send({ ok: false, error: err }); break; }
          const all = (await chromeKV.get<Record<string, SkillFile>>('skills')) ?? {};
          all[msg.skill.name] = msg.skill;
          await chromeKV.set('skills', all);
          send({ ok: true, name: msg.skill.name });
          break;
        }
        case 'delete-skill': {
          const all = (await chromeKV.get<Record<string, SkillFile>>('skills')) ?? {};
          delete all[msg.name];
          await chromeKV.set('skills', all);
          send({ ok: true });
          break;
        }
        case 'max-msgs': send({ ok: true, max: MAX_MSGS_PER_SESSION }); break;
        default: send({ ok: false, error: `unknown rpc: ${msg?.type}` });
      }
    } catch (e: any) {
      send({ ok: false, error: e?.message ?? String(e) });
    }
  })();
  return true; // رد غير متزامن
});

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
