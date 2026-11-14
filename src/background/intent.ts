// كشف نية تجميع التبويبات — يُستخدم لتجهيز سياق التبويبات وإجبار group_tabs.
export function isTabGroupingRequest(text: string): boolean {
  const t = String(text ?? '');
  const action = /(جمّع|جمع|تجميع|رتب|نظّم|نظم|group)/i.test(t);
  const target = /(تبويب|تبويبات|tabs?)/i.test(t);
  return action && target;
}

/** URLs التي لا تقبل التجميع في كروم */
export function isGroupableUrl(url: string | undefined): boolean {
  return !/^(chrome|edge|about|devtools|chrome-extension):/i.test(url ?? '');
}
