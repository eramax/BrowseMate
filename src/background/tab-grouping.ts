// تخطيط مجموعات التبويبات: تصفية المثبتة وغير القابلة للتجميع قبل استدعاء chrome.tabs.group.
import { isGroupableUrl } from './intent';

export interface GroupSpec {
  title?: string;
  color?: string;
  tabIds: number[];
}

export interface TabInfo {
  id: number;
  title?: string;
  url?: string;
  pinned?: boolean;
  windowId: number;
}

export interface PlannedGroup {
  title?: string;
  color?: string;
  eligible: TabInfo[];
  skippedPinned: Array<{ id: number; title: string }>;
  skippedUnsupported: Array<{ id: number; title: string; url: string }>;
  missing: number[];
  error?: 'ALL_PINNED' | 'UNSUPPORTED_TABS' | 'NO_ELIGIBLE_TABS';
}

export function planGroups(specs: GroupSpec[], tabs: TabInfo[], includePinned = false): PlannedGroup[] {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  return specs.map((spec) => {
    const eligible: TabInfo[] = [];
    const skippedPinned: PlannedGroup['skippedPinned'] = [];
    const skippedUnsupported: PlannedGroup['skippedUnsupported'] = [];
    const missing: number[] = [];

    for (const id of spec.tabIds) {
      const tab = byId.get(id);
      if (!tab) {
        missing.push(id);
        continue;
      }
      if (tab.pinned && !includePinned) {
        skippedPinned.push({ id, title: (tab.title ?? '').slice(0, 80) });
        continue;
      }
      if (!isGroupableUrl(tab.url)) {
        skippedUnsupported.push({
          id,
          title: (tab.title ?? '').slice(0, 80),
          url: (tab.url ?? '').slice(0, 120),
        });
        continue;
      }
      eligible.push(tab);
    }

    let error: PlannedGroup['error'];
    if (!eligible.length) {
      if (skippedPinned.length && !skippedUnsupported.length) error = 'ALL_PINNED';
      else if (skippedUnsupported.length && !skippedPinned.length) error = 'UNSUPPORTED_TABS';
      else error = 'NO_ELIGIBLE_TABS';
    }

    return {
      title: spec.title,
      color: spec.color,
      eligible,
      skippedPinned,
      skippedUnsupported,
      missing,
      ...(error ? { error } : {}),
    };
  });
}
