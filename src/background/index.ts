// نقطة دخول SW — توصيل كل المكونات: Port + RPC + الجلسات + الموافقات + الوكيل
import { loadSettings, saveSettings } from './settings';
import { listModels } from './llm';
import { createSessionStore, MAX_MSGS_PER_SESSION } from './sessions';
import { createApprovalManager } from './approvals';
import { runChat, type RunHandle } from './agent';
import { seedSkills } from './seed';
import { getArtifact } from './artifacts';
import { chromeKV } from '../shared/storage';
import { validateSkill, buildSkillFromToolCalls } from './skills';
import { setLang } from '../shared/i18n';
import type { PanelToWorker, WorkerToPanel, SkillFile } from '../shared/types';
import './tools/page';
import './tools/tabs';
import './tools/misc';
import './tools/inspect';
import './tools/pdf';
import './tools/youtube';
import './tools/cv';
import './tools/doc';
import './tools/skillTools';

const sessions = createSessionStore(chromeKV);
const approvals = createApprovalManager();
const runs = new Map<string, RunHandle>();

let port: chrome.runtime.Port | undefined;
let activeSessionId = '';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
initLang();
seedSkills().catch(() => {});

async function initLang() {
  const s = await loadSettings();
  setLang(s.lang);
}

chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'panel') return;
  seedSkills().catch((e) => console.warn('seedSkills:', e));
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
      approvals.rejectAll(); // لا تترك أداة معلقة على موافقة لن تأتي
      for (const r of runs.values()) r.ac.abort();
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
        case 'update-skill': {
          const all = (await chromeKV.get<Record<string, SkillFile>>('skills')) ?? {};
          const skill = all[msg.name];
          if (!skill) { send({ ok: false, error: 'مهارة غير موجودة' }); break; }
          const next = { ...skill, ...msg.patch, name: skill.name };
          if (msg.patch?.instructions !== undefined) next.seedRev = -1; // المستخدم عدّل التعليمات
          const err = validateSkill(next);
          if (err) { send({ ok: false, error: err }); break; }
          all[msg.name] = next;
          await chromeKV.set('skills', all);
          send({ ok: true });
          break;
        }
        case 'download-artifact':
        case 'print-artifact': {
          const a = await getArtifact(msg.id);
          if (!a) { send({ ok: false, error: 'المستند غير موجود (انتهت صلاحيته)' }); break; }
          if (msg.type === 'download-artifact') {
            const url = a.dataUrl ?? ('data:text/html;charset=utf-8,' + encodeURIComponent(a.html ?? ''));
            send({ ok: true, url, filename: a.filename });
            break;
          }
          if (a.dataUrl) {
            // PDF جاهز: افتحه في عارض كروم
            await chrome.tabs.create({ url: a.dataUrl, active: true });
            send({ ok: true, printed: false, opened: true });
            break;
          }
          // طباعة: افتح المستند مع #print فتُفتح نافذة الطباعة تلقائياً (حفظ كـ PDF) — بدون debugger
          await chrome.tabs.create({
            url: 'data:text/html;charset=utf-8,' + encodeURIComponent(a.html ?? '') + '#print',
            active: true,
          });
          send({ ok: true, printed: true });
          break;
        }
        case 'create-skill-from-message': {
          const session = await sessions.get(msg.sessionId);
          const target = session?.messages.find((m) => m.id === msg.msgId);
          if (!target?.toolCalls?.length) { send({ ok: false, error: 'لا توجد أدوات في هذه الرسالة' }); break; }
          const built = buildSkillFromToolCalls(msg.name, msg.description ?? '', target.toolCalls);
          if ('error' in built) { send({ ok: false, error: built.error }); break; }
          const all = (await chromeKV.get<Record<string, SkillFile>>('skills')) ?? {};
          all[built.name] = built;
          await chromeKV.set('skills', all);
          send({ ok: true, skill: built });
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
        case 'run-active':
          send({ ok: true, active: [...runs.values()].some((r) => r.sessionId === msg.sessionId) });
          break;
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
