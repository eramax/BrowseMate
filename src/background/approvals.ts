// إدارة الموافقات المعلقة — مرتبطة بالتشغيل/الجلسة، وبمهلة حتى لا تعلق الأدوات للأبد.
export interface PendingApproval {
  id: string;
  tool: string;
  args: unknown;
  steps?: string[];
  sessionId?: string;
  runId?: string;
}

interface Entry {
  res: (ok: boolean) => void;
  info: PendingApproval;
  timer: ReturnType<typeof setTimeout>;
}

export interface ApprovalMeta {
  sessionId?: string;
  runId?: string;
  timeoutMs?: number;
}

export function createApprovalManager() {
  const pending = new Map<string, Entry>();

  function settle(id: string, ok: boolean): boolean {
    const e = pending.get(id);
    if (!e) return false;
    pending.delete(id);
    clearTimeout(e.timer);
    e.res(ok);
    return true;
  }

  return {
    request(
      tool: string,
      args: unknown,
      steps?: string[],
      notify?: (info: PendingApproval) => void,
      meta: ApprovalMeta = {},
    ): Promise<boolean> {
      const info: PendingApproval = {
        id: crypto.randomUUID(),
        tool,
        args,
        steps,
        sessionId: meta.sessionId,
        runId: meta.runId,
      };
      let res!: (ok: boolean) => void;
      const p = new Promise<boolean>((r) => (res = r));
      const timeoutMs = Math.max(100, Number(meta.timeoutMs) || 300_000);
      const timer = setTimeout(() => settle(info.id, false), timeoutMs);
      pending.set(info.id, { res, info, timer });
      notify?.(info);
      return p;
    },
    pending(): PendingApproval[] {
      return [...pending.values()].map((x) => x.info);
    },
    resolve(id: string, ok: boolean): boolean {
      return settle(id, ok);
    },
    /** إيقاف/انقطاع تشغيل معين فقط */
    rejectRun(runId: string): void {
      for (const [id, e] of [...pending]) if (e.info.runId === runId) settle(id, false);
    },
    rejectSession(sessionId: string): void {
      for (const [id, e] of [...pending]) if (e.info.sessionId === sessionId) settle(id, false);
    },
    /** إيقاف: افصل كل الموافقات المعلقة كرفض حتى لا تعلق الأدوات */
    rejectAll(): void {
      for (const id of [...pending.keys()]) settle(id, false);
    },
  };
}
