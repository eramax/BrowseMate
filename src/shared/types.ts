// أنواع مشتركة بين SW والـ panel — بروتوكول Port + جلسات + أدوات + مهارات
export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  ts: number;
  toolCalls?: ToolCallInfo[];
  plan?: string[]; // خطة معلنة (تُعرض كبطاقة، وتُنزع ::plan من النص)
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
  | { type: 'chat'; sessionId: string; text: string }
  | { type: 'approval-response'; id: string; approved: boolean }
  | { type: 'stop' }
  | { type: 'session-switch'; sessionId: string };

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
  | { type: 'sessions-list'; sessions: Array<Pick<Session, 'id' | 'title' | 'updatedAt'>> }
  | { type: 'session-data'; session: Session };

// ===== أدوات بنمط MCP =====
export interface ToolContext {
  getActiveTab: () => Promise<chrome.tabs.Tab>;
  emit: (evt: WorkerToPanel) => void;
  requestApproval: (tool: string, args: unknown, steps?: string[]) => Promise<boolean>;
  signal?: AbortSignal;
  /** وضع الصلاحيات: sensitive = اسأل عن الحساس فقط، always = اسأل دائمًا، never = بدون سؤال */
  approvalMode: ApprovalMode;
  /** أدوات التشغيل الحالي — تتيح للنموذج تحويل ما نُفذ فعلاً إلى مهارة */
  getToolLog?: () => ToolCallInfo[];
  /** أدوات آخر تشغيل محفوظ في الجلسة (للطلب في دور لاحق) */
  getSessionToolLog?: () => Promise<ToolCallInfo[]>;
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
  params: SkillParam[];
  steps: SkillStep[];
  version?: number;
}
