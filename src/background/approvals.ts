// إدارة الموافقات المعلقة — TDD
export interface PendingApproval {
  id: string;
  tool: string;
  args: unknown;
  steps?: string[];
}

export function createApprovalManager() {
  const pending = new Map<string, { res: (ok: boolean) => void; info: PendingApproval }>();

  return {
    request(
      tool: string,
      args: unknown,
      steps?: string[],
      notify?: (info: PendingApproval) => void,
    ): Promise<boolean> {
      const info: PendingApproval = { id: crypto.randomUUID(), tool, args, steps };
      let res!: (ok: boolean) => void;
      const p = new Promise<boolean>((r) => (res = r));
      pending.set(info.id, { res, info });
      notify?.(info);
      return p;
    },
    pending(): PendingApproval[] {
      return [...pending.values()].map((x) => x.info);
    },
    resolve(id: string, ok: boolean): boolean {
      const e = pending.get(id);
      if (!e) return false;
      pending.delete(id);
      e.res(ok);
      return true;
    },
  };
}
