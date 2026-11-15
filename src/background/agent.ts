// حلقة الوكيل — العقل الكامل (SW): بث + أدوات + خطط + حفظ حي + رد احتياطي عند فراغ النص
import { streamText, generateText, isStepCount } from 'ai';
import { makeModel } from './llm';
import { loadSettings } from './settings';
import { allTools, asAISDKTools } from './tools/registry';
import { isGroupableUrl, isTabGroupingRequest } from './intent';
import { createDebugLogger, type DebugLogger } from './debug';
import type { ChatMessage, ToolCallInfo, ToolContext, WorkerToPanel, VoiceMessage } from '../shared/types';
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
- إن وعدت بإصلاح أو إعادة محاولة، نفّذ الأداة في نفس الدور. لا تنهِ دورك بجملة «سأصلح» أو «سأعيد» بدون تنفيذ.
- بعد الانتهاء من الأدوات يجب أن تكتب ردًا نهائيًا يلخّص النتيجة — لا تنهِ دورك بأداة فقط.
- لإنشاء مستندات منسقة (سيرة، خطاب، تقرير): استخدم render_cv أو render_document ببيانات منظمة. لا تكتب HTML ولا تستخدم export_pdf إلا إذا طلب المستخدم PDF مباشراً.
- لبناء موقع/تطبيق ويب: استخدم ws_write للجزء الأول من index.html، ثم ws_append للاستكمال وedit (diff) للتعديل. استخدم ws_patch فقط لعدة تعديلات في نداء واحد. بعد نجاح edit لا تعيد ws_read؛ انتقل إلى ws_preview. لا تستخدم ws_write بعد أول كتابة إلا مع overwrite:true. لا تكتب الملف كله في نداء واحد، ولا تستخدم قوالب جاهزة. بعد الكتابة استخدم ws_preview ثم preview_diagnostics.
- للعمل في الخلفية دون إزعاج المستخدم: افتح تبويباً بـ open_tab (active:false)، ثم اقرأه بـ read_page({tabId}) أو انقله بـ navigate({tabId}) أو تفاعل بـ click_element({tabId})، وأغلقه بـ close_tab. لا تغيّر التبويب النشط إلا إذا كان التفاعل يتطلب التركيز. أعد استخدام نفس التبويب بدل فتح تبويب لكل خطوة.
- للقراءة الصوتية داخل الصفحة: استخدم page_outline أولاً لرؤية الفقرات مع IDs، ثم read_aloud مع blockIds للأجزاء المطلوبة فقط. تظهر رسالة صوتية داخل المحادثة مع أزرار التحكم، وأزرار عائمة داخل الصفحة عند القراءة منها؛ لا تضف تبويباً في البانل. لا تقرأ القوائم/التذييل/الإعلانات. للقراءة من موضع لآخر استخدم fromBlockId/toBlockId، وللقراءة من تحديد المستخدم استخدم selection:true. أصوات Microsoft Edge العصبية هي الافتراضية (engine:'edge') وهي الأفضل والأكثر طبيعية. إذا لم يطلب المستخدم صوتاً أو لهجة محددة، استدعِ read_aloud مع engine:'edge' فقط — القارئ يستخدم إعدادات القراءة المحفوظة في Settings (الافتراضي: Shakir للعربية، Emma للإنجليزية). إذا طلب لهجة/صوتاً (مثل السعودية أو صوت رجل) استخدم list_tts_voices({engine:'edge',lang:'ar'}) ومرّر voice. إذا فشل Edge أو طلب صوت المتصفح استخدم engine:'browser'. لا تعِد read_aloud بنفس الوسائط إذا كانت القراءة تعمل بالفعل.
- للإشارة إلى موضع في الصفحة دون قراءة: استخدم highlight_in_page مع text (يبحث أيضاً داخل الأزرار والروابط) أو blockIds أو selector. مثال: «أين زر تسجيل الدخول؟» → highlight_in_page({text:"تسجيل الدخول"}). التظليل يبقى حتى clear_highlights أو تغيير الصفحة. أثناء القراءة، read_aloud يظلل الفقرة والكلمة تلقائياً.
- لا تمرر tabId:0 أبداً — احذف tabId لاستخدام التبويب النشط. إذا أعادت read_page أو page_outline خطأ PAGE_RESTRICTED، لا تعِد المحاولة على نفس التبويب؛ الصفحة قد تكون PWA/تطبيقاً محمياً. افتح رابط المقال في تبويب عادي إن أمكن، ثم استخدم page_outline + read_aloud بـ blockIds. إذا تعذر DOM (مثل Google Notebook أو صفحة محمية)، استخدم النص الذي نسخه المستخدم مع read_aloud({text}) — سيُقرأ مباشرة في الرسالة الصوتية داخل المحادثة بدون فتح صفحة، ولن يوجد تظليل داخل الصفحة الأصلية.
- لتجميع التبويبات: استخدم list_tabs مرة واحدة ثم group_tabs مرة واحدة مع groups. لا تجمع تبويباً واحداً في كل نداء. التبويبات المثبتة (pinned) لا تُضمّن إلا إذا طلب المستخدم ذلك صراحةً (includePinned:true). لا تدّعِ التجميع بدون groupId من نتيجة الأداة.
- لا تدّعِ تنفيذ أي إجراء على المتصفح دون استدعاء الأداة المناسبة؛ إن لم تستدعِها فقل بوضوح إنك لم تنفذ.
- إذا وصلت مهارة محددة من واجهة التشغيل (اسم + معاملات) فاستدعِ run_skill مباشرة؛ لا تستدعِ list_skills. استخدم list_skills فقط للاستكشاف أو إذا لم تعرف الاسم.
- عندما يطلب المستخدم تحويل إجراء/خطوات إلى مهارة: استدعِ save_skill_from_run فوراً. المهارة يجب أن تكون عامة قابلة لإعادة الاستخدام: حدّد whenToUse (المشكلة)، وsite إن كانت للموقع نفسه، ومرّر replacements لتحويل القيم المحددة (روابط، كلمات بحث، أسماء) إلى معاملات {{param}}، وعرّفها في params مع description وexample. لا تعرض JSON ولا تطلب تأكيداً. لا تقل "تم الحفظ" إلا إذا أعادت الأداة saved.
- إن كانت الخطوات موجودة في سجل الأدوات المرفق بالرسائل، اعتمد عليه كما هو.
- الردود markdown بلغة المستخدم (غالبًا العربية).`;

interface ToolLogEntry extends ToolCallInfo { result?: string }

export async function runChat(
  deps: AgentDeps,
  sessionId: string,
  userText: string,
  skill?: { name: string; params: Record<string, string> },
) {
  const runId = crypto.randomUUID();
  let debugRef: DebugLogger | undefined;
  const ac = new AbortController();
  deps.runs.set(runId, { ac, sessionId });
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo?.().catch(() => {}), 10000);

  let full = '';
  let plan: string[] | undefined;
  let planArmed = false;
  const toolLog: ToolLogEntry[] = [];
  const artifacts: ChatMessage['artifacts'] = [];
  const voices: VoiceMessage[] = [];
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
        ...(voices.length ? { voices: [...voices] } : {}),
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

    // ===== تجميع التبويبات: سياق حتمي + إجبار الأداة في الخطوة الأولى =====
    const groupIntent = isTabGroupingRequest(userText);
    let groupingTabs: Array<{
      id?: number; title: string; url: string; pinned: boolean; groupable: boolean; groupId: number; windowId: number;
    }> = [];
    if (groupIntent) {
      try {
        groupingTabs = (await chrome.tabs.query({})).map((t) => ({
          id: t.id,
          title: (t.title ?? '').slice(0, 120),
          url: (t.url ?? '').slice(0, 180),
          pinned: Boolean(t.pinned),
          groupable: isGroupableUrl(t.url),
          groupId: t.groupId,
          windowId: t.windowId,
        }));
      } catch {
        groupingTabs = [];
      }
    }
    const groupingForced = groupIntent && groupingTabs.length > 0;
    const groupingContext = groupIntent
      ? `\n\nطلب تجميع تبويبات. هذه التبويبات الحالية (لا تخمّن):\n${JSON.stringify(groupingTabs)}\nاستدعِ group_tabs الآن مرة واحدة مع groups:[{title,color,tabIds},...]. لا تضم pinned إلا إذا طلب المستخدم ذلك صراحةً (includePinned:true). لا ترد بدون group_tabs ولا تدّعِ النجاح بدون groupId.`
      : '';
    const skillContext = skill
      ? `\n\nالمستخدم يشغّل المهارة "${skill.name}" مباشرة بمعاملات ${JSON.stringify(skill.params)}. استدعِ run_skill الآن بهذا الاسم الدقيق وهذه المعاملات؛ لا تستدعِ list_skills.`
      : '';
    const instructions =
      SYSTEM +
      `\n\nسياق التبويب النشط الآن: title="${tab?.title ?? ''}" url="${tab?.url ?? ''}"` +
      groupingContext +
      skillContext;

    // مسودة رد فارغة تُضاف فوراً ثم تُحدَّث — tool calls لا تختفي عند أي انقطاع
    draftId = crypto.randomUUID();
    await deps.sessions.append(sessionId, { id: draftId, role: 'assistant', content: '', ts: Date.now() });

    const model = await makeModel();
    const settings = await loadSettings();
    const { approvalMode } = settings;
    const dbg = createDebugLogger(sessionId, Boolean(settings.debug));
    debugRef = dbg;
    dbg.log('run:start', {
      runId,
      sessionId,
      userText,
      model: settings.model,
      baseUrl: settings.baseUrl,
      approvalMode,
      debug: settings.debug,
      version: chrome.runtime.getManifest().version,
      tab: { title: tab?.title, url: tab?.url },
      grouping: groupIntent ? groupingTabs : undefined,
      skill: skill ?? undefined,
      instructions,
    });
    dbg.log('run:history', { messages: history });
    dbg.log('run:messages', { messages: toModelMessages(history) });
    dbg.log('run:tools', {
      tools: allTools().map((t) => ({
        name: t.name,
        description: t.description,
        sensitive: t.sensitive,
        idempotent: Boolean(t.idempotent),
        schema: t.jsonSchema,
      })),
    });

    const ctx: ToolContext = {
      seenCalls: new Map<string, number>(),
      callCount: { value: 0 },
      lastPatchError: new Map<string, string>(),
      debug: dbg,
      getActiveTab: deps.getActiveTab,
      sessionId,
      runId,
      emit: (e) => deps.emit(sessionId, e),
      signal: ac.signal,
      approvalMode,
      getToolLog: () => toolLog.map(({ result, ...t }) => t),
      getSessionToolLog: async () => {
        const s = await deps.sessions.get(sessionId);
        const last = [...(s?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.toolCalls?.length);
        return last?.toolCalls ?? [];
      },
      requestApproval: (tool, args, steps) => {
        dbg.log('approval:request', { tool, args, steps });
        return deps.approvals
          .request(tool, args, steps, (info) =>
            deps.emit(sessionId, { type: 'approval-request', id: info.id, tool: info.tool, args: info.args, steps: info.steps }))
          .then((ok) => {
            dbg.log('approval:result', { tool, approved: ok }, ok ? 'info' : 'warn');
            return ok;
          });
      },
    };

    const result = streamText({
      model,
      instructions,
      abortSignal: ac.signal,
      stopWhen: isStepCount(MAX_STEPS),
      messages: toModelMessages(history),
      tools: asAISDKTools(ctx, () => planArmed),
      prepareStep: skill
        ? ({ stepNumber }: any) =>
            stepNumber === 0
              ? { toolChoice: { type: 'tool', toolName: 'run_skill' } }
              : undefined
        : groupingForced
          ? ({ stepNumber }: any) =>
              stepNumber === 0
                ? { toolChoice: { type: 'tool', toolName: 'group_tabs' } }
                : undefined
          : undefined,
    });

    let textChunk = '';
    let lastTextLog = Date.now();
    for await (const part of result.stream) {
      const type = (part as any).type;
      if (type === 'text-delta') {
        const delta = (part as any).text ?? '';
        full += delta;
        textChunk += delta;
        if (textChunk.length >= 1500 || Date.now() - lastTextLog > 1500) {
          dbg.log('stream:text', { text: textChunk });
          textChunk = '';
          lastTextLog = Date.now();
        }
        // كشف ::plan…::endplan → خطة معلنة + موافقة مجمعة واحدة
        if (!plan && full.includes('::endplan')) {
          const m = full.match(/::plan\s*\n([\s\S]*?)::endplan/);
          if (m) {
            plan = m[1].split('\n').map((s) => s.trim().replace(/^[-*\d.\s]+/, '')).filter(Boolean);
            dbg.log('plan:detected', { steps: plan });
            deps.emit(sessionId, { type: 'plan', runId, steps: plan });
            planArmed = approvalMode === 'never' || await deps.approvals.request('plan', { steps: plan }, plan, (info) =>
              deps.emit(sessionId, { type: 'approval-request', id: info.id, tool: 'plan', args: { steps: plan }, steps: plan }));
            dbg.log('plan:approval', { approved: planArmed }, planArmed ? 'info' : 'warn');
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
        dbg.log('stream:tool-call', { name: (part as any).toolName, input: (part as any).input }, 'debug');
        toolLog.push({ name: (part as any).toolName, args: (part as any).input, status: 'running' });
        deps.emit(sessionId, { type: 'tool-start', runId, info: { name: (part as any).toolName, args: (part as any).input, status: 'running' } });
        persist(true);
      } else if (type === 'tool-result') {
        const out: any = (part as any).output;
        dbg.log('stream:tool-result', { name: (part as any).toolName, output: out }, 'debug');
        const voice = extractVoiceMessage((part as any).toolName, out);
        if (voice) voices.push(voice);
        if (out?.artifact?.id) {
          // إبقاء زر تحميل واحد لكل اسم ملف (آخر إصدار يفوز)
          const i = artifacts.findIndex((a) => a.filename === out.artifact.filename);
          if (i >= 0) artifacts[i] = out.artifact;
          else artifacts.push(out.artifact);
        }
        const entry = toolLog.find((t) => t.name === (part as any).toolName && t.status === 'running');
        const status: ToolCallInfo['status'] =
          out?.error === 'REFUSED_BY_USER' ? 'refused' : out?.error ? 'error' : 'ok';
        if (entry) {
          entry.status = status;
          entry.result = safeStringify(out).slice(0, 500);
        }
        deps.emit(sessionId, {
          type: 'tool-end', runId,
          info: { name: (part as any).toolName, args: (part as any).input, status },
        });
        persist(true);
      } else if (type === 'error') {
        dbg.log('stream:error', { error: (part as any).error }, 'error');
        throw (part as any).error;
      } else {
        dbg.log('stream:part', { type, part }, 'debug');
      }
    }
    if (textChunk) dbg.log('stream:text', { text: textChunk });

    // لا تسمح بادعاء التجميع بدون استدعاء ناجح لـ group_tabs.
    const grouped = toolLog.some((t) => t.name === 'group_tabs' && t.status === 'ok');
    if (groupingForced && !grouped && !ac.signal.aborted) {
      full =
        (full.trim() ? full + '\n\n' : '') +
        '> ⚠️ لم أستدعِ group_tabs، لذلك لم تتغير أي مجموعة. أعد المحاولة.';
    }

    dbg.log('run:post-stream', { full, toolLog, grouped });

    // ===== رد احتياطي: النموذج أنهى التشغيل بلا نص (استنفاد خطوات/موديل يعيد reasoning فقط) =====
    if (!full.trim()) {
      dbg.log('fallback:start', { toolLog });
      full = await fallbackAnswer(model, history, toolLog, sessionId, deps).catch(() => '');
      dbg.log('fallback:end', { full });
    }
    // ضمان عدم وجود رد فارغ أبداً — خصوصاً بعد إنشاء ملفات
    if (!full.trim()) {
      full = artifacts.length
        ? `تم إنشاء الملف: ${artifacts.map((a) => a.filename).join('، ')} — استخدم زر التحميل أدناه.`
        : toolLog.length
          ? `نفّذت ${toolLog.length} خطوة (${[...new Set(toolLog.map((t) => t.name))].join(', ')}) لكن النموذج لم يُرجع نصًا نهائيًا. جرّب إعادة المحاولة أو نموذجًا آخر.`
          : 'لم يُرجع النموذج أي نص. جرّب إعادة المحاولة أو نموذجًا آخر.';
    }

    await deps.sessions.patchMessage(sessionId, draftId, {
      content: full, toolCalls: toolLog.map(({ result, ...t }) => t), plan,
      artifacts: artifacts.length ? artifacts : undefined,
      ...(voices.length ? { voices } : {}),
    });
    let finishReason: unknown;
    let usage: unknown;
    try { finishReason = await (result as any).finishReason; } catch {}
    try { usage = await (result as any).usage; } catch {}
    dbg.log('run:end', { runId, finishReason, usage, full, toolLog, artifacts, plan });
    await dbg.flush();
    deps.emit(sessionId, { type: 'done', runId });
  } catch (e: any) {
    if (deps.runs.get(runId)?.ac.signal.aborted) {
      const note = full.trim() ? `${full}\n\n> ⏹️ أُوقف بواسطة المستخدم` : '> ⏹️ أُوقف بواسطة المستخدم';
      await deps.sessions.patchMessage(sessionId, draftId, { content: note, toolCalls: toolLog.map(({ result, ...t }) => t), plan, ...(voices.length ? { voices } : {}) }).catch(() => {});
      debugRef?.log('run:aborted', { runId, full, toolLog }, 'warn');
      await debugRef?.flush();
      deps.emit(sessionId, { type: 'done', runId });
      return;
    }
    const { message, code } = friendlyError(e);
    const note = (full.trim() ? full + '\n\n' : '') + `> ⚠️ ${message}`;
    await deps.sessions.patchMessage(sessionId, draftId, { content: note, toolCalls: toolLog.map(({ result, ...t }) => t), plan, ...(voices.length ? { voices } : {}) }).catch(() => {});
    debugRef?.log('run:error', { runId, message, code, error: e, full, toolLog }, 'error');
    await debugRef?.flush();
    deps.emit(sessionId, { type: 'error', runId, message, code });
  } finally {
    clearTimeout(persistTimer);
    clearInterval(keepAlive);
    await debugRef?.flush().catch(() => {});
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

/** يستخرج رسالة صوتية قابلة للحفظ من نتيجة أداة read_aloud */
export function extractVoiceMessage(toolName: string, out: any): VoiceMessage | null {
  if (toolName !== 'read_aloud' || !out?.ok || !out?.data?.text) return null;
  return {
    id: String(out.data.voiceId || crypto.randomUUID()),
    text: String(out.data.text),
    voice: String(out.data.voice || ''),
    rate: Number(out.data.rate) || 1,
    engine: out.data.engine === 'browser' ? 'browser' : 'edge',
    createdAt: Date.now(),
  };
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
