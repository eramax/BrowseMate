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
import { getTtsVoices } from './tts';
import { fetchEdgeVoices, ensureEdgeConnected, edgeWarm, edgeCold } from './edge';
import {
  downloadTts,
  getTtsState,
  handleEdgeEvent,
  initTtsLifecycle,
  nextTts,
  pauseTts,
  prevTts,
  replayTts,
  resumeTts,
  seekTts,
  setTtsChatSession,
  setTtsEmitter,
  speakTextDirect,
  startPagePlayback,
  stopTts,
} from './tts-session';
import { validateSkill, buildSkillFromToolCalls } from './skills';
import {
  getSkills, getOrderedSkills, saveSkill as storeSkill, deleteSkill as storeDeleteSkill,
  setOrder as storeSetOrder, saveSkillsBulk, syncNow, syncStatus, pullSkills,
} from './skill-store';
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

const ports = new Set<chrome.runtime.Port>();
let activeSessionId = '';
let warmPanels = 0;
setTtsEmitter((state) => {
  for (const p of ports) {
    try { p.postMessage({ type: 'tts-state', state }); } catch { /* انقطع */ }
  }
});
initTtsLifecycle();

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
  ports.add(p);
  p.onDisconnect.addListener(() => {
    ports.delete(p);
    warmPanels = Math.max(0, warmPanels - 1);
    if (!warmPanels) void edgeCold().catch(() => {});
  });
  // مزامنة أولية: البانل قد يُفتح بعد بدء الصوت أو بعد إعادة تشغيل الـ SW
  try { p.postMessage({ type: 'tts-state', state: getTtsState() }); } catch { /* ignore */ }
  // تسخين اتصال Edge وإبقاء الـ offscreen حياً أثناء فتح البانل (Chrome يغلقه بعد 30ث بلا صوت)
  warmPanels++;
  void ensureEdgeConnected()
    .then((r) => { if (r.ok && warmPanels > 0) void edgeWarm().catch(() => {}); })
    .catch(() => {});
  p.onMessage.addListener((msg: PanelToWorker) => {
    if (msg.type === 'chat') {
      activeSessionId = msg.sessionId;
      setTtsChatSession(msg.sessionId);
      runChat({ sessions, emit, getActiveTab, approvals, runs }, msg.sessionId, msg.text, msg.skill)
        .catch((e) => emit(msg.sessionId, { type: 'error', message: String(e) }));
    } else if (msg.type === 'approval-response') {
      approvals.resolve(msg.id, msg.approved);
    } else if (msg.type === 'stop') {
      approvals.rejectAll(); // لا تترك أداة معلقة على موافقة لن تأتي
      for (const r of runs.values()) r.ac.abort();
      // زر الإيقاف يوقف أيضاً القراءة الصوتية الجارية/المعلّقة لهذه الجلسة
      const stopFor = msg.sessionId || activeSessionId;
      if (stopFor) void stopTts({ kind: 'session', sessionId: stopFor });
    } else if (msg.type === 'tts-download') {
      // عبر Port وليس sendMessage: التصدير الطويل قد يتجاوز مهلة رسالة الـ RPC
      void downloadTts(msg.text, msg.voice, msg.rate, msg.sessionId)
        .then((res) => {
          try {
            p.postMessage({
              type: 'tts-download-result',
              requestId: msg.requestId,
              ok: Boolean(res.ok),
              ...(res.error ? { error: res.error } : {}),
              ...(res.filename ? { filename: res.filename } : {}),
              ...(res.downloadId != null ? { downloadId: res.downloadId } : {}),
            });
          } catch { /* البانل أُغلق */ }
        })
        .catch((e) => {
          try {
            p.postMessage({
              type: 'tts-download-result',
              requestId: msg.requestId,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          } catch { /* ignore */ }
        });
    } else if (msg.type === 'session-switch') {
      activeSessionId = msg.sessionId;
      setTtsChatSession(msg.sessionId);
    }
  });
});

function emit(sessionId: string, evt: WorkerToPanel) {
  for (const p of ports) {
    try { p.postMessage({ ...evt, sessionId }); } catch { /* انقطع */ }
  }
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
          send(await startPagePlayback(msg, tabId));
          break;
        }
        case 'tts-speak-text':
          send(await speakTextDirect(String(msg.text || ''), msg.voice, msg.rate, 'edge', msg.sessionId, msg.voiceId, Boolean(msg.replay)));
          break;
        case 'tts-replay':
          send(await replayTts(String(msg.sessionId || '')));
          break;
        case 'tts-pause':
          send({ ok: pauseTts(String(msg.sessionId || '')) });
          break;
        case 'tts-resume':
          send({ ok: resumeTts(String(msg.sessionId || '')) });
          break;
        case 'tts-stop': {
          // من content script: إيقاف ملك هذا التبويب فقط. من البانل: الجلسة أو الكل.
          // ملاحظة: البانل قد يُفتح كصفحة امتداد داخل تبويب، لذا لا نثق بـ sender.tab وحده.
          const fromContent = msg.scope === 'tab'
            || (sender.tab?.id != null && typeof sender.url === 'string' && !sender.url.startsWith('chrome-extension://'));
          const scope = fromContent && sender.tab?.id != null
            ? { kind: 'tab' as const, tabId: sender.tab.id }
            : msg.sessionId
              ? { kind: 'session' as const, sessionId: String(msg.sessionId) }
              : { kind: 'all' as const };
          send({ ok: await stopTts(scope) });
          break;
        }
        case 'tts-status':
          send({ ok: true, state: getTtsState() });
          break;
        case 'tts-download':
          send(await downloadTts(String(msg.text || ''), msg.voice, msg.rate, msg.sessionId));
          break;
        case 'tts-seek':
          send({ ok: seekTts(Number(msg.time) || 0, String(msg.sessionId || '')) });
          break;
        case 'tts-next':
          send(await nextTts(String(msg.sessionId || '')));
          break;
        case 'tts-prev':
          send(await prevTts(String(msg.sessionId || '')));
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
          if (first) {
            activeSessionId = first.id;
            setTtsChatSession(first.id);
            send({ ok: true, id: first.id });
            break;
          }
          const s = await sessions.create(msg.title || 'New chat');
          activeSessionId = s.id;
          setTtsChatSession(s.id);
          send({ ok: true, id: s.id });
          break;
        }
        case 'get-session': send({ ok: true, session: await sessions.get(msg.id) }); break;
        case 'list-sessions': send({ ok: true, sessions: await sessions.list() }); break;
        case 'new-session': {
          const s = await sessions.create(msg.title || 'New chat');
          activeSessionId = s.id;
          setTtsChatSession(s.id);
          send({ ok: true, session: s });
          break;
        }
        case 'delete-session': {
          await stopTts({ kind: 'session', sessionId: msg.id });
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
