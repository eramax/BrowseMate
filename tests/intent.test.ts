import { describe, it, expect } from 'vitest';
import { isGroupableUrl, isTabGroupingRequest } from '../src/background/intent';

describe('isTabGroupingRequest', () => {
  it('detects Arabic and English tab-grouping requests', () => {
    expect(isTabGroupingRequest('جمّع تبويباتي في مجموعات حسب الموضوع')).toBe(true);
    expect(isTabGroupingRequest('نظّم التبويبات حسب الموقع')).toBe(true);
    expect(isTabGroupingRequest('رتب التبويبات')).toBe(true);
    expect(isTabGroupingRequest('group my tabs by topic')).toBe(true);
  });
  it('does not trigger on unrelated requests', () => {
    expect(isTabGroupingRequest('لخّص هذه الصفحة')).toBe(false);
    expect(isTabGroupingRequest('ابحث عن سعر OnePlus 16')).toBe(false);
    expect(isTabGroupingRequest('اجمع أسعار المنتجات')).toBe(false);
  });
});

describe('isGroupableUrl', () => {
  it('allows normal web pages', () => {
    expect(isGroupableUrl('https://example.com')).toBe(true);
    expect(isGroupableUrl('http://localhost:3000')).toBe(true);
    expect(isGroupableUrl('file:///tmp/x.html')).toBe(true);
  });
  it('rejects browser-internal pages', () => {
    expect(isGroupableUrl('chrome://extensions')).toBe(false);
    expect(isGroupableUrl('chrome-extension://abc/preview.html')).toBe(false);
    expect(isGroupableUrl('about:blank')).toBe(false);
    expect(isGroupableUrl('devtools://devtools')).toBe(false);
    expect(isGroupableUrl('edge://settings')).toBe(false);
  });
});
