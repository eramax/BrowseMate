// حلقة الوكيل — العقل الكامل (SW): بث + أدوات + خطط + حفظ حي + رد احتياطي عند فراغ النص
import { streamText, generateText, isStepCount } from 'ai';
import { makeModel } from './llm';
import { loadSettings } from './settings';
import { asAISDKTools } from './tools/registry';
import type { ChatMessage, ToolCallInfo, ToolContext, WorkerToPanel } from '../shared/types';
import type { SessionStore } from './sessions';

export interface RunHandle { ac: AbortController; sessionId: string }

export interface AgentDeps {
  sessions: SessionStore;
  emit: (sessionId: string, evt: WorkerToPanel) => void;
  getActiveTab: () => Promise<chrome.tabs.Tab>;
  approvals: {
    request: (tool: string, args: unknown, steps?: string[], notify?: (i: { id: string; tool: string; args: unknown; steps?: string[] }) => void) => Promise<boolean>;
  };
  runs: Map<string, RunHandle>;
}

const MAX_STEPS = 24;

const SYSTEM = `أنت BrowseMate — وكيل متصفح داخل إضافة كروم. تتحكم بالتبويب النشط عبر الأدوات المتاحة.
القواعد:
- عند التخطيط لعمل حساس متعدد الخطوات، ابدأ ردك بوسم خطة:
::plan
خطوة أولى
خطوة ثانية
::endplan
ثم نفّذ الأدوات. الموافقة على الخطة تُغطي تسلسلها كاملاً.
- اقرأ الصفحة (read_page) قبل أي تعديل للحصول على معرفات العناصر.
- لا تكرر أداة فشلت بنفس الوسائط؛ غيّر النهج واسأل المستخدم عند الحاجة.
- بعد الانتهاء من الأدوات يجب أن تكتب ردًا نهائيًا يلخّص النتيجة — لا تنهِ دورك بأداة فقط.
- لإنشاء مستندات منسقة (سيرة، خطاب، تقرير): استخدم render_cv أو render_document ببيانات منظمة. لا تكتب HTML ولا تستخدم export_pdf إلا إذا طلب المستخدم PDF مباشراً.
- عندما يطلب المستخدم تحويل إجراء/خطوات إلى مهارة: استدعِ save_skill_from_run فوراً. المهارة يجب أن تكون عامة قابلة لإعادة الاستخدام: حدّد whenToUse (المشكلة)، وsite إن كانت للموقع نفسه، ومرّر replacements لتحويل القيم المحددة (روابط، كلمات بحث، أسماء) إلى معاملات {{param}}، وعرّفها في params مع description وexample. لا تعرض JSON ولا تطلب تأكيداً. لا تقل "تم الحفظ" إلا إذا أعادت الأداة saved.
- إن كانت الخطوات موجودة في سجل الأدوات المرفق بالرسائل، اعتمد عليه كما هو.
- الردود markdown بلغة المستخدم (غالبًا العربية).`;

interface ToolLogEntry extends ToolCallInfo { result?: string }

export async function runChat(deps: AgentDeps, sessionId: string, userText: string) {
  const runId = crypto.randomUUID();
  const ac = new AbortController();
  deps.runs.set(runId, { ac, sessionId });
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo?.().catch(() => {}), 10000);

  let full = '';
  let plan: string[] | undefined;
  let planArmed = false;
  const toolLog: ToolLogEntry[] = [];
  const artifacts: ChatMessage['artifacts'] = [];
  let draftId = '';

  // حفظ حي: مسودة الرد + tool calls تُكتب أثناء التشغيل (تصمد لو قُتل SW)
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPersist = 0;
  const persist = (force = false) => {
    if (!draftId) return;
    const doIt = () => {
      lastPersist = Date.now();
      deps.sessions.patchMessage(sessionId, draftId, {
        content: full, toolCalls: toolLog.map(({ result, ...t }) => t), plan,
      }).catch(() => {});
    };
    if (force || Date.now() - lastPersist > 700) doIt();
    else { clearTimeout(persistTimer); persistTimer = setTimeout(doIt, 700); }
  };

  try {
    const session = await deps.sessions.get(sessionId);
    if (!session) throw new Error('session not found');
    const tab = await deps.getActiveTab();
    deps.emit(sessionId, { type: 'chat-started', runId, sessionId });

    // رسالة المستخدم تُحفظ أولاً — تظهر في الجلسة حتى لو فشل الاتصال/الإعدادات
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: userText, ts: Date.now() };
    await deps.sessions.append(sessionId, userMsg);
    if (session.messages.length === 0)
      await deps.sessions.update(sessionId, { title: userText.trim().slice(0, 42) });
    const history: ChatMessage[] = [...session.messages, userMsg];

    // مسودة رد فارغة تُضاف فوراً ثم تُحدَّث — tool calls لا تختفي عند أي انقطاع
    draftId = crypto.randomUUID();
    await deps.sessions.append(sessionId, { id: draftId, role: 'assistant', content: '', ts: Date.now() });

    const model = await makeModel();
    const { approvalMode } = await loadSettings();

    const ctx: ToolContext = {
      getActiveTab: deps.getActiveTab,
      emit: (e) => deps.emit(sessionId, e),
      signal: ac.signal,
      approvalMode,
      getToolLog: () => toolLog.map(({ result, ...t }) => t),
      getSessionToolLog: async () => {
        const s = await deps.sessions.get(sessionId);
        const last = [...(s?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.toolCalls?.length);
        return last?.toolCalls ?? [];
      },
      requestApproval: (tool, args, steps) =>
        deps.approvals.request(tool, args, steps, (info) =>
          deps.emit(sessionId, { type: 'approval-request', id: info.id, tool: info.tool, args: info.args, steps: info.steps })),
    };

    const result = streamText({
      model,
      instructions: SYSTEM + `\n\nسياق التبويب النشط الآن: title="${tab?.title ?? ''}" url="${tab?.url ?? ''}"`,
      abortSignal: ac.signal,
      stopWhen: isStepCount(MAX_STEPS),
      messages: toModelMessages(history),
      tools: asAISDKTools(ctx, () => planArmed),
    });

    for await (const part of result.stream) {
      const type = (part as any).type;
      if (type === 'text-delta') {
        full += (part as any).text ?? '';
        // كشف ::plan…::endplan → خطة معلنة + موافقة مجمعة واحدة
        if (!plan && full.includes('::endplan')) {
          const m = full.match(/::plan\s*\n([\s\S]*?)::endplan/);
          if (m) {
            plan = m[1].split('\n').map((s) => s.trim().replace(/^[-*\d.\s]+/, '')).filter(Boolean);
            deps.emit(sessionId, { type: 'plan', runId, steps: plan });
            planArmed = approvalMode === 'never' || await deps.approvals.request('plan', { steps: plan }, plan, (info) =>
              deps.emit(sessionId, { type: 'approval-request', id: info.id, tool: 'plan', args: { steps: plan }, steps: plan }));
            full = planArmed
              ? full.replace(/::plan[\s\S]*?::endplan/, '').trim()
              : full.replace(/::plan[\s\S]*?::endplan/, '> ⛔ لم توافق على الخطة.');
            deps.emit(sessionId, { type: 'delta', runId, text: full });
          }
        }
        const shown = full.includes('::plan') ? full.slice(0, full.indexOf('::plan')) + '…' : full;
        deps.emit(sessionId, { type: 'delta', runId, text: shown });
        persist();
      } else if (type === 'tool-call') {
        toolLog.push({ name: (part as any).toolName, args: (part as any).input, status: 'running' });
        deps.emit(sessionId, { type: 'tool-start', runId, info: { name: (part as any).toolName, args: (part as any).input, status: 'running' } });
        persist(true);
      } else if (type === 'tool-result') {
        const out: any = (part as any).output;
        if (out?.artifact?.id) artifacts.push(out.artifact);
        const entry = toolLog.find((t) => t.name === (part as any).toolName && t.status === 'running');
        if (entry) {
          entry.status = out?.error === 'REFUSED_BY_USER' ? 'refused' : 'ok';
          entry.result = safeStringify(out).slice(0, 500);
        }
        deps.emit(sessionId, {
          type: 'tool-end', runId,
          info: { name: (part as any).toolName, args: (part as any).input, status: out?.error === 'REFUSED_BY_USER' ? 'refused' : 'ok' },
        });
        persist(true);
      } else if (type === 'error') {
        throw (part as any).error;
      }
    }

    // ===== رد احتياطي: النموذج أنهى التشغيل بلا نص (استنفاد خطوات/موديل يعيد reasoning فقط) =====
    if (!full.trim()) {
      full = await fallbackAnswer(model, history, toolLog, sessionId, deps).catch(() => '');
      if (!full.trim()) {
        full = toolLog.length
          ? `نفّذت ${toolLog.length} خطوة (${[...new Set(toolLog.map((t) => t.name))].join(', ')}) لكن النموذج لم يُرجع نصًا نهائيًا. جرّب إعادة المحاولة أو نموذجًا آخر.`
          : 'لم يُرجع النموذج أي نص. جرّب إعادة المحاولة أو نموذجًا آخر.';
      }
    }

    await deps.sessions.patchMessage(sessionId, draftId, {
      content: full, toolCalls: toolLog.map(({ result, ...t }) => t), plan,
      artifacts: artifacts.length ? artifacts : undefined,
    });
    deps.emit(sessionId, { type: 'done', runId });
  } catch (e: any) {
    if (deps.runs.get(runId)?.ac.signal.aborted) {
      const note = full.trim() ? `${full}\n\n> ⏹️ أُوقف بواسطة المستخدم` : '> ⏹️ أُوقف بواسطة المستخدم';
      await deps.sessions.patchMessage(sessionId, draftId, { content: note, toolCalls: toolLog.map(({ result, ...t }) => t), plan }).catch(() => {});
      deps.emit(sessionId, { type: 'done', runId });
      return;
    }
    const { message, code } = friendlyError(e);
    const note = (full.trim() ? full + '\n\n' : '') + `> ⚠️ ${message}`;
    await deps.sessions.patchMessage(sessionId, draftId, { content: note, toolCalls: toolLog.map(({ result, ...t }) => t), plan }).catch(() => {});
    deps.emit(sessionId, { type: 'error', runId, message, code });
  } finally {
    clearTimeout(persistTimer);
    clearInterval(keepAlive);
    deps.runs.delete(runId);
  }
}

/** طلب نص نهائي واحد بدون أدوات — عندما ينتهي التشغيل بلا كلام */
async function fallbackAnswer(
  model: Awaited<ReturnType<typeof makeModel>>,
  history: ChatMessage[],
  toolLog: ToolLogEntry[],
  _sessionId: string,
  _deps: AgentDeps,
): Promise<string> {
  const transcript = toolLog
    .map((t) => `- ${t.name}(${safeStringify(t.args).slice(0, 200)}) → ${t.status}${t.result ? ': ' + t.result.slice(0, 300) : ''}`)
    .join('\n');
  const res = await generateText({
    model,
    instructions: 'اكتب الآن ردًا نهائيًا موجزًا بالعربية يلخّص ما تم تنفيذه ونتيجته. لا تستخدم أدوات.',
    messages: [
      ...toModelMessages(history),
      { role: 'assistant' as const, content: `سجل الأدوات المنفذة:\n${transcript}` },
      { role: 'user' as const, content: 'لخّص النتيجة النهائية لي في رد قصير.' },
    ],
  });
  return res.text ?? '';
}

function safeStringify(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
}

/** رسائل النموذج + سجل الأدوات — بدونه لا يعرف النموذج ما نُفّذ في الأدوار السابقة */
function toModelMessages(history: ChatMessage[]) {
  return history.map((m) => {
    let content = m.content?.trim() ? m.content : ' ';
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const lines = m.toolCalls
        .slice(0, 30)
        .map((t) => `- ${t.name}(${safeStringify(t.args).slice(0, 180)}) [${t.status}]`)
        .join('\n');
      content += `\n\n[سجل الأدوات المنفذة في هذا الرد]\n${lines}`;
    }
    return { role: (m.role === 'system' ? 'user' : m.role) as 'user' | 'assistant', content };
  });
}

export function friendlyError(e: any): { message: string; code?: string } {
  if (e?.message === 'SETTINGS_MISSING')
    return { message: 'أكمل الإعدادات أولاً: Base URL + API key + النموذج.', code: 'SETTINGS_MISSING' };
  return { message: `خطأ: ${e?.message ?? String(e)}` };
}
