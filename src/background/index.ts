// نقطة دخول SW — توصيل كل المكونات: Port + RPC + الجلسات + الموافقات + الوكيل
import { loadSettings, saveSettings } from './settings';
import { listModels } from './llm';
import { createSessionStore, MAX_MSGS_PER_SESSION } from './sessions';
import { createApprovalManager } from './approvals';
import { runChat, type RunHandle } from './agent';
import { seedSkills } from './seed';
import { getArtifact } from './artifacts';
import { debugStore, logSystemDebug } from './debug';
import { chromeKV } from '../shared/storage';
import { getTtsVoices, ttsPause, ttsResume, ttsSpeak, ttsStop } from './tts';
import { edgePause, edgeResume, edgeSeek, edgeSpeak, edgeStop, fetchEdgeVoices } from './edge';
import { validateSkill, buildSkillFromToolCalls } from './skills';
import {
  getSkills, getOrderedSkills, saveSkill as storeSkill, deleteSkill as storeDeleteSkill,
  setOrder as storeSetOrder, saveSkillsBulk, syncNow, syncStatus, pullSkills,
} from './skill-store';
import { setLang } from '../shared/i18n';
import type { PanelToWorker, WorkerToPanel, SkillFile, TtsPanelState } from '../shared/types';
import './tools/page';
import './tools/tabs';
import './tools/misc';
import './tools/inspect';
import './tools/pdf';
import './tools/youtube';
import './tools/cv';
import './tools/doc';
import './tools/web';
import './tools/workspace';
import './tools/reader';
import './tools/skillTools';

const sessions = createSessionStore(chromeKV);
const approvals = createApprovalManager();
const runs = new Map<string, RunHandle>();

self.addEventListener('error', (e) => {
  void logSystemDebug('sw:error', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    error: (e as any).error,
  });
});
self.addEventListener('unhandledrejection', (e) => {
  void logSystemDebug('sw:unhandledrejection', { reason: (e as any).reason });
});

let port: chrome.runtime.Port | undefined;
let activeSessionId = '';

const EMPTY_TTS_STATE: TtsPanelState = {
  active: false,
  playing: false,
  engine: 'edge',
  title: '',
  text: '',
  index: 0,
  total: 1,
  currentTime: 0,
  duration: 0,
  tabId: null,
  voice: '',
  rate: 1,
};
let ttsState: TtsPanelState = { ...EMPTY_TTS_STATE };

function emitTtsState() {
  port?.postMessage({ type: 'tts-state', state: ttsState });
}
function setTtsState(patch: Partial<TtsPanelState>) {
  ttsState = { ...ttsState, ...patch };
  emitTtsState();
}
function resetTtsState() {
  ttsState = { ...EMPTY_TTS_STATE };
  emitTtsState();
}

/** أحداث مشغل Edge (تعمل حتى بدون تبويب عند قراءة نص حر) */
function handleEdgeEvent(msg: any) {
  const e = msg?.event;
  if (!e) return;
  const type = e.type;
  if (type === 'start') {
    setTtsState({ playing: true, ...(Number.isFinite(Number(e.duration)) ? { duration: Number(e.duration) } : {}) });
  } else if (type === 'progress') {
    setTtsState({ currentTime: Number(e.currentTime) || 0, duration: Number(e.duration) || 0 });
  } else if (type === 'end' || type === 'error' || type === 'interrupted' || type === 'cancelled') {
    setTtsState({ playing: false });
  } else if (type === 'paused') {
    setTtsState({ playing: false });
  } else if (type === 'resumed') {
    setTtsState({ playing: true });
  }
  if (msg.tabId != null) chrome.tabs.sendMessage(msg.tabId, e).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
initLang();
pullSkills().then(() => seedSkills()).catch((e) => { console.warn('skills init:', e); void logSystemDebug('skills:init-error', { error: e }); });

async function initLang() {
  // الافتراضي الجديد: الإنجليزية — يُطبَّق مرة واحدة على من لم يغيّر اللغة يدوياً
  if (!(await chromeKV.get<boolean>('langDefaultEnApplied'))) {
    const s = await loadSettings();
    if (s.lang === 'ar') await saveSettings({ lang: 'en' });
    await chromeKV.set('langDefaultEnApplied', true);
  }
  const s = await loadSettings();
  setLang(s.lang);
}

chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'panel') return;
  pullSkills().then(() => seedSkills()).catch((e) => { console.warn('skills init:', e); void logSystemDebug('skills:init-error', { error: e }); });
  port = p;
  p.onDisconnect.addListener(() => { port = undefined; });
  p.onMessage.addListener((msg: PanelToWorker) => {
    if (msg.type === 'chat') {
      activeSessionId = msg.sessionId;
      runChat({ sessions, emit, getActiveTab, approvals, runs }, msg.sessionId, msg.text, msg.skill)
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

/** قراءة نص حر في مشغل البانل بدون الحاجة لصفحة أو content script */
async function speakTextDirect(
  text: string,
  voice: string | undefined,
  rate: number | undefined,
  engine: 'edge' | 'browser' | undefined,
): Promise<any> {
  const eng: 'edge' | 'browser' = engine === 'browser' ? 'browser' : 'edge';
  const chosenVoice = String(voice || '') || (eng === 'edge'
    ? (/[\u0600-\u06FF]/.test(text) ? 'ar-EG-ShakirNeural' : 'en-US-EmmaMultilingualNeural')
    : '');
  ttsState = {
    active: true,
    playing: true,
    engine: eng,
    title: '',
    text,
    index: 0,
    total: 1,
    currentTime: 0,
    duration: 0,
    tabId: null,
    voice: chosenVoice,
    rate: Number(rate) || 1,
  };
  emitTtsState();
  if (eng === 'edge') {
    ttsStop();
    const r = await edgeSpeak(text, chosenVoice, rate, null);
    if (r.ok) return { ok: true, engine: 'edge', voice: chosenVoice };
    if (r.error === 'EDGE_STOPPED') {
      resetTtsState();
      return { ok: false, error: 'EDGE_STOPPED' };
    }
    const b = ttsSpeak(text, rate, undefined, null);
    if (!b.ok) resetTtsState();
    else setTtsState({ engine: 'browser', voice: '' });
    return { ...b, engine: 'browser', voice: '', fallback: true, edgeError: r.error };
  }
  edgeStop();
  const b = ttsSpeak(text, rate, voice, null);
  if (!b.ok) resetTtsState();
  else setTtsState({ engine: 'browser', voice: chosenVoice });
  return { ...b, engine: 'browser', voice: chosenVoice };
}

// ===== RPC بسيط للطلبات غير المتدفقة (إعدادات/جلسات/مهارات) =====
chrome.runtime.onMessage.addListener((msg: any, sender, send) => {
  // رسائل الـ offscreen لها target خاص — لا يعالجها الـ SW
  if (msg?.target === 'offscreen') return;
  if (msg?.target === 'sw') {
    if (msg.type === 'edge-event') handleEdgeEvent(msg);
    send({ ok: true });
    return true;
  }
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
        case 'tts-speak': {
          const tabId = sender.tab?.id ?? null;
          const requested = msg.engine === 'browser' ? 'browser' : 'edge';
          ttsState = {
            active: true,
            playing: true,
            engine: requested,
            title: String(msg.title || ''),
            text: String(msg.text || ''),
            index: Number.isFinite(Number(msg.index)) ? Number(msg.index) : 0,
            total: Number.isFinite(Number(msg.total)) ? Number(msg.total) : 1,
            currentTime: 0,
            duration: 0,
            tabId,
            voice: String(msg.voice || ''),
            rate: Number(msg.rate) || 1,
          };
          emitTtsState();

          if (requested === 'edge') {
            ttsStop();
            const r = await edgeSpeak(
              msg.text,
              msg.voice,
              msg.rate,
              tabId,
              String(msg.key || ''),
              Array.isArray(msg.prefetch) ? msg.prefetch : [],
            );
            if (r.ok) {
              send({ ok: true, engine: 'edge' });
              break;
            }
            // المستخدم أوقف القراءة أثناء التركيب — لا تبدأ صوتاً بديلاً
            if (r.error === 'EDGE_STOPPED') {
              resetTtsState();
              send({ ok: false, error: 'EDGE_STOPPED' });
              break;
            }
            // احتياط: صوت المتصفح الافتراضي
            const b = ttsSpeak(msg.text, msg.rate, undefined, tabId);
            if (!b.ok) resetTtsState();
            else setTtsState({ engine: 'browser' });
            send({ ...b, engine: 'browser', fallback: true, edgeError: r.error });
            break;
          }
          edgeStop();
          const r = ttsSpeak(msg.text, msg.rate, msg.voice, tabId);
          if (!r.ok) resetTtsState();
          else setTtsState({ engine: 'browser' });
          send({ ...r, engine: 'browser' });
          break;
        }
        case 'tts-speak-text':
          send(await speakTextDirect(String(msg.text || ''), msg.voice, msg.rate, msg.engine));
          break;
        case 'tts-replay': {
          if (ttsState.tabId != null) {
            chrome.tabs.sendMessage(ttsState.tabId, { __ta: 'reader', op: 'replay' }).catch(() => {});
            send({ ok: true });
            break;
          }
          if (!ttsState.text) {
            send({ ok: false, error: 'NO_REPLAY' });
            break;
          }
          send(await speakTextDirect(ttsState.text, ttsState.voice, ttsState.rate, ttsState.engine));
          break;
        }
        case 'tts-pause': {
          const tabId = ttsState.tabId;
          ttsPause();
          edgePause();
          setTtsState({ playing: false });
          if (tabId != null) chrome.tabs.sendMessage(tabId, { action: 'tts-event', type: 'paused' }).catch(() => {});
          send({ ok: true });
          break;
        }
        case 'tts-resume': {
          const tabId = ttsState.tabId;
          ttsResume();
          edgeResume();
          setTtsState({ playing: true });
          if (tabId != null) chrome.tabs.sendMessage(tabId, { action: 'tts-event', type: 'resumed' }).catch(() => {});
          send({ ok: true });
          break;
        }
        case 'tts-stop': {
          const fromPanel = sender.tab?.id == null;
          const tabId = ttsState.tabId;
          ttsStop();
          edgeStop();
          if (fromPanel && tabId != null) {
            chrome.tabs.sendMessage(tabId, { __ta: 'reader', op: 'remote-stop' }).catch(() => {});
          }
          resetTtsState();
          send({ ok: true });
          break;
        }
        case 'tts-status':
          send({ ok: true, state: ttsState });
          break;
        case 'tts-seek': {
          const time = Number(msg.time) || 0;
          setTtsState({ currentTime: time });
          edgeSeek(time);
          send({ ok: true });
          break;
        }
        case 'tts-next':
          if (ttsState.tabId != null) {
            chrome.tabs.sendMessage(ttsState.tabId, { __ta: 'reader', op: 'next' }).catch(() => {});
          }
          send({ ok: true });
          break;
        case 'tts-prev':
          if (ttsState.tabId != null) {
            chrome.tabs.sendMessage(ttsState.tabId, { __ta: 'reader', op: 'prev' }).catch(() => {});
          }
          send({ ok: true });
          break;
        case 'tts-voices': {
          if (msg.engine === 'browser') {
            send({ ok: true, engine: 'browser', voices: await getTtsVoices() });
            break;
          }
          try {
            send({ ok: true, engine: 'edge', voices: await fetchEdgeVoices() });
          } catch (e: any) {
            send({ ok: false, error: 'EDGE_VOICES_FAILED', message: e?.message ?? String(e) });
          }
          break;
        }
        case 'ensure-session': {
          const first = (await sessions.list())[0];
          if (first) { send({ ok: true, id: first.id }); break; }
          const s = await sessions.create(msg.title || 'New chat');
          send({ ok: true, id: s.id });
          break;
        }
        case 'get-session': send({ ok: true, session: await sessions.get(msg.id) }); break;
        case 'list-sessions': send({ ok: true, sessions: await sessions.list() }); break;
        case 'new-session': {
          const s = await sessions.create(msg.title || 'New chat');
          activeSessionId = s.id;
          send({ ok: true, session: s });
          break;
        }
        case 'delete-session': {
          await sessions.remove(msg.id);
          await debugStore.clear(msg.id);
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
          send({ ok: true, skills: await getOrderedSkills() });
          break;
        }
        case 'reorder-skills': {
          await storeSetOrder(Array.isArray(msg.names) ? msg.names : []);
          send({ ok: true });
          break;
        }
        case 'get-artifact-html': {
          const a = await getArtifact(msg.id);
          if (!a) { send({ ok: false, error: 'not found' }); break; }
          send({ ok: true, html: a.html ?? '', filename: a.filename });
          break;
        }
        case 'preview-log': {
          const prev = (await chromeKV.get<{ id: string; entries: any[] }>('previewLogs')) ?? { id: '', entries: [] };
          const entries = [...(prev.id === msg.id ? prev.entries : []), ...(Array.isArray(msg.entries) ? msg.entries : [])].slice(-150);
          await chromeKV.set('previewLogs', { id: msg.id, entries, updatedAt: Date.now() });
          send({ ok: true });
          break;
        }
        case 'skills-sync': {
          send({ ok: true, status: msg.now ? await syncNow() : await syncStatus() });
          break;
        }
        case 'skills-pull': {
          send({ ok: true, ...(await pullSkills()) });
          break;
        }
        case 'import-skill': {
          const err = validateSkill(msg.skill);
          if (err) { send({ ok: false, error: err }); break; }
          await storeSkill(msg.skill);
          send({ ok: true, name: msg.skill.name });
          break;
        }
        case 'update-skill': {
          const all = await getSkills();
          const skill = all[msg.name];
          if (!skill) { send({ ok: false, error: 'مهارة غير موجودة' }); break; }
          const next = { ...skill, ...msg.patch, name: skill.name };
          if (msg.patch?.instructions !== undefined) next.seedRev = -1; // المستخدم عدّل التعليمات
          const err = validateSkill(next);
          if (err) { send({ ok: false, error: err }); break; }
          await storeSkill(next);
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
          await storeSkill(built);
          send({ ok: true, skill: built });
          break;
        }
        case 'delete-skill': {
          await storeDeleteSkill(msg.name);
          send({ ok: true });
          break;
        }
        case 'get-debug-log': {
          const log = await debugStore.read(msg.sessionId || activeSessionId);
          send({ ok: true, log: log ?? null });
          break;
        }
        case 'get-debug-all': send({ ok: true, logs: await debugStore.all() }); break;
        case 'clear-debug': {
          await debugStore.clearAll();
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
