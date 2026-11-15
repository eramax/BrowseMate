// أنواع مشتركة بين SW والـ panel — بروتوكول Port + جلسات + أدوات + مهارات
export type Role = 'user' | 'assistant' | 'system';

export interface VoiceMessage {
  id: string;
  text: string;
  voice: string;
  rate: number;
  engine: 'edge' | 'browser';
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  ts: number;
  toolCalls?: ToolCallInfo[];
  plan?: string[]; // خطة معلنة (تُعرض كبطاقة، وتُنزع ::plan من النص)
  artifacts?: Array<{ id: string; filename: string; mime: string; sizeKb: number }>;
  /** رسائل صوتية أُنشئت في هذا الرد — تبقى في السجل */
  voices?: VoiceMessage[];
}

export interface ToolCallInfo {
  name: string;
  args: unknown;
  status: 'running' | 'ok' | 'error' | 'refused';
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

// ===== بروتوكول Panel ↔ SW (Port واحد) =====
export type PanelToWorker =
  | {
      type: 'chat';
      sessionId: string;
      text: string;
      /** مهارة محددة من واجهة التشغيل — تسمح بتخطي list_skills */
      skill?: { name: string; params: Record<string, string> };
    }
  | { type: 'approval-response'; id: string; approved: boolean }
  | { type: 'stop'; sessionId?: string }
  | { type: 'session-switch'; sessionId: string };

/** حالة مشغّل الصوت داخل البانل (Edge/المتصفح) */
export interface TtsPanelState {
  active: boolean;
  playing: boolean;
  engine: 'edge' | 'browser';
  title: string;
  text: string;
  index: number;
  total: number;
  currentTime: number;
  duration: number;
  tabId: number | null;
  voice: string;
  rate: number;
  /** جلسة المحادثة التي بدأت الصوت — تمنع ظهور المشغل في جلسات أخرى */
  sessionId: string;
  /** معرّف التشغيل — تُتجاهل أحداث التشغيلات القديمة */
  playbackId?: string;
  /** معرّف الرسالة الصوتية المحفوظة — ثابت بين فقرات القراءة الواحدة */
  voiceId?: string;
  /** مرحلة التشغيل الحالية */
  status?: 'idle' | 'starting' | 'playing' | 'paused' | 'ended' | 'error';
  /** آخر تحديث للحالة (للتشخيص) */
  updatedAt?: number;
}

export type WorkerToPanel =
  | { type: 'chat-started'; runId: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'tool-start'; runId: string; info: ToolCallInfo }
  | { type: 'tool-end'; runId: string; info: ToolCallInfo }
  | { type: 'plan'; runId: string; steps: string[] }
  | { type: 'skill-progress'; skill: string; step: number; total: number }
  | { type: 'approval-request'; id: string; tool: string; args: unknown; steps?: string[] }
  | { type: 'done'; runId: string }
  | { type: 'error'; runId?: string; message: string; code?: string }
  | { type: 'sessions-list'; sessions: Array<Pick<Session, 'id' | 'title' | 'updatedAt' | 'createdAt'>> }
  | { type: 'session-data'; session: Session }
  | { type: 'tts-state'; state: TtsPanelState };

// ===== أدوات بنمط MCP =====
/** واجهة تسجيل تشخيصي — تُمرَّر للأدوات عند تفعيل Debug */
export interface DebugSink {
  log: (event: string, data?: unknown, level?: 'debug' | 'info' | 'warn' | 'error') => void;
}

export interface ToolContext {
  getActiveTab: () => Promise<chrome.tabs.Tab>;
  emit: (evt: WorkerToPanel) => void;
  requestApproval: (tool: string, args: unknown, steps?: string[]) => Promise<boolean>;
  signal?: AbortSignal;
  /** جلسة المحادثة التي ينتمي إليها هذا التشغيل — أساس عزل الصوت */
  sessionId: string;
  /** معرّف التشغيل الحالي (اختياري للتشخيص) */
  runId?: string;
  /** وضع الصلاحيات: sensitive = اسأل عن الحساس فقط، always = اسأل دائمًا، never = بدون سؤال */
  approvalMode: ApprovalMode;
  /** أدوات التشغيل الحالي — تتيح للنموذج تحويل ما نُفذ فعلاً إلى مهارة */
  getToolLog?: () => ToolCallInfo[];
  /** أدوات آخر تشغيل محفوظ في الجلسة (للطلب في دور لاحق) */
  getSessionToolLog?: () => Promise<ToolCallInfo[]>;
  /** حماية من الحلقات: بصمات الاستدعاءات المتكررة */
  seenCalls?: Map<string, number>;
  /** عدد استدعاءات الأدوات في هذا التشغيل */
  callCount?: { value: number };
  /** آخر خطأ تحقق لكل ملف — لكشف التعديلات التي لا تُحدث تقدماً */
  lastPatchError?: Map<string, string>;
  /** سجل تشخيصي اختياري */
  debug?: DebugSink;
}

export type ApprovalMode = 'sensitive' | 'always' | 'never';

// ===== ملف مهارة (JSON واحد قابل للتصدير/الاستيراد) =====
export interface SkillStep {
  tool: string;
  args: Record<string, unknown>;
  approval?: boolean;
  note?: string; // لماذا هذه الخطوة / ماذا تتوقع
}
export interface SkillParam {
  name: string;
  type: 'string' | 'number';
  required?: boolean;
  description?: string; // ماذا يمثل هذا المعامل
  example?: string;
}
export interface SkillFile {
  name: string; // اسم حر (عربي مسموح)
  description: string;
  whenToUse?: string; // المشكلة/الحالة التي تُستخدم فيها
  site?: string; // النطاق أو الموقع المرتبط (اختياري)
  notes?: string; // قيود، تحذيرات، خطوات يدوية
  context?: string; // Markdown مرفق (مثل السيرة الذاتية) يُمرر للنموذج
  instructions?: string; // مهارة Playbook: تعليمات ينفذها النموذج بالأدوات (بدل خطوات ثابتة)
  params: SkillParam[];
  steps: SkillStep[];
  version?: number;
  seedRev?: number; // -1 = عدّلها المستخدم فلا تُلمس عند الزرع
  order?: number; // ترتيب العرض في تبويب المهارات
  updatedAt?: number; // آخر تعديل (للمزامنة)
}
