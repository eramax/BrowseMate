// ربط Flowdown (عارض markdown متدفق O(1)) — لوحدة واحدة لتسهيل الاستبدال لاحقاً
import { mount } from '@localix-ai/flowdown/dom';
import highlight from '@localix-ai/flowdown/highlight';
import '@localix-ai/flowdown/styles.css';

export type FlowView = ReturnType<typeof mount>;

export function attach(el: HTMLElement): FlowView {
  return mount(el, { highlight });
}
