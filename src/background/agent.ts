// حلقة الوكيل — العقل الكامل للإضافة يعيش هنا (SW): بث + أدوات + خطط + مهارات
import { streamText, isStepCount } from 'ai';
import { makeModel } from './llm';
import { asAISDKTools } from './tools/registry';
import type { ChatMessage, ToolContext, WorkerToPanel } from '../shared/types';
import type { SessionStore } from './sessions';

export interface AgentDeps {
  sessions: SessionStore;
  emit: (sessionId: string, evt: WorkerToPanel) => void;
  getActiveTab: () => Promise<chrome.tabs.Tab>;
  approvals: {
    request: (tool: string, args: unknown, steps?: string[], notify?: (i: { id: string; tool: string; args: unknown; steps?: string[] }) => void) => Promise<boolean>;
  };
  runs: Map<string, AbortController>;
}

const SYSTEM = `أنت BrowseMate — وكيل متصفح داخل إضافة كروم. تتحكم بالتبويب النشط عبر الأدوات المتاحة.
القواعد:
- عند التخطيط لعمل حساس متعدد الخطوات (مثل بحث أسعار عبر مواقع، أو ملء نموذج وإرساله)، ابدأ ردك بوسم خطة:
::plan
خطوة أولى
خطوة ثانية
::endplan
ثم نفّذ الأدوات. الموافقة على الخطة تُغطي تسلسلها كاملاً.
- اقرأ الصفحة (read_page) قبل أي تعديل للحصول على معرفات العناصر.
- لا تكرر أداة فشلت بنفس الوسائط؛ غيّر النهج واسأل المستخدم عند الحاجة.
- الردود markdown بلغة المستخدم (غالبًا العربية). خذ بعين الاعتبار أن نتائج run_skill تعود إليك لتحليلها وردك بها.`;

export async function runChat(deps: AgentDeps, sessionId: string, userText: string) {
  const runId = crypto.randomUUID();
  const ac = new AbortController();
  deps.runs.set(runId, ac);
  try {
    const model = await makeModel();
    const session = await deps.sessions.get(sessionId);
    if (!session) throw new Error('session not found');
    const tab = await deps.getActiveTab();

    deps.emit(sessionId, { type: 'chat-started', runId, sessionId });

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: userText, ts: Date.now() };
    await deps.sessions.append(sessionId, userMsg);
    const history: ChatMessage[] = [...session.messages, userMsg];

    let planArmed = false;

    const ctx: ToolContext = {
      getActiveTab: deps.getActiveTab,
      emit: (e) => deps.emit(sessionId, e),
      signal: ac.signal,
      requestApproval: (tool, args, steps) =>
        deps.approvals.request(tool, args, steps, (info) =>
          deps.emit(sessionId, { type: 'approval-request', id: info.id, tool: info.tool, args: info.args, steps: info.steps })),
    };

    let full = '';
    let plan: string[] | undefined = undefined;

    const result = streamText({
      model,
      instructions: SYSTEM + `\n\nسياق التبويب النشط الآن: title="${tab?.title ?? ''}" url="${tab?.url ?? ''}"`,
      abortSignal: ac.signal,
      stopWhen: isStepCount(15),
      // v7 يرفض role:'system' داخل messages افتراضيًا — علامات القص تُحوّل لملاحظة مستخدم
      messages: history.map((m) => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })),
      tools: asAISDKTools(ctx, () => planArmed),
    });

    for await (const part of result.stream) {
      const type = (part as any).type;
      if (type === 'text-delta') {
        const delta: string = (part as any).text ?? '';
        full += delta;
        // كشف ::plan…::endplan كاملاً في النص المتراكم → خطة معلنة + موافقة مجمعة واحدة
        if (!plan && full.includes('::endplan')) {
          const m = full.match(/::plan\s*\n([\s\S]*?)::endplan/);
          if (m) {
            plan = m[1].split('\n').map((s) => s.trim().replace(/^[-*\d.\s]+/, '')).filter(Boolean);
            deps.emit(sessionId, { type: 'plan', runId, steps: plan });
            planArmed = await deps.approvals.request('plan', { steps: plan }, plan, (info) =>
              deps.emit(sessionId, { type: 'approval-request', id: info.id, tool: 'plan', args: { steps: plan }, steps: plan }));
            if (!planArmed) full = full.replace(/::plan[\s\S]*?::endplan/, '> ⛔ لم توافق على الخطة.');
            else full = full.replace(/::plan[\s\S]*?::endplan/, '').trim();
            deps.emit(sessionId, { type: 'delta', runId, text: full });
          }
        }
        const shown = full.includes('::plan') ? full.slice(0, full.indexOf('::plan')) + '…' : full;
        deps.emit(sessionId, { type: 'delta', runId, text: shown });
      } else if (type === 'tool-call') {
        deps.emit(sessionId, {
          type: 'tool-start', runId,
          info: { name: (part as any).toolName, args: (part as any).input, status: 'running' },
        });
      } else if (type === 'tool-result') {
        const out: any = (part as any).output;
        if (out?.error === 'REFUSED_BY_USER') {
          deps.emit(sessionId, {
            type: 'tool-end', runId,
            info: { name: (part as any).toolName, args: (part as any).input, status: 'refused' },
          });
        } else {
          deps.emit(sessionId, {
            type: 'tool-end', runId,
            info: { name: (part as any).toolName, args: (part as any).input, status: 'ok' },
          });
        }
      } else if (type === 'error') {
        throw (part as any).error;
      }
      // أجزاء أخرى (ping, steering-message, text-start/end…) تُتجاهل عمداً — لا switch حصري
    }

    await deps.sessions.append(sessionId, {
      id: crypto.randomUUID(), role: 'assistant',
      content: full || (planArmed ? '' : ''), ts: Date.now(), plan: plan ?? undefined,
    });
    deps.emit(sessionId, { type: 'done', runId });
  } catch (e: any) {
    if (deps.runs.get(runId)?.signal.aborted) {
      deps.emit(sessionId, { type: 'done', runId });
      return;
    }
    const { message, code } = friendlyError(e);
    try {
      await deps.sessions.append(sessionId, {
        id: crypto.randomUUID(), role: 'assistant', content: `> ⚠️ ${message}`, ts: Date.now(),
      });
    } catch { /* الجلسة ربما حُذفت أثناء الخطأ */ }
    deps.emit(sessionId, { type: 'error', runId, message, code });
  } finally {
    deps.runs.delete(runId);
  }
}

export function friendlyError(e: any): { message: string; code?: string } {
  if (e?.message === 'SETTINGS_MISSING')
    return { message: 'أكمل الإعدادات أولاً: Base URL + API key + النموذج.', code: 'SETTINGS_MISSING' };
  return { message: `خطأ: ${e?.message ?? String(e)}` };
}
