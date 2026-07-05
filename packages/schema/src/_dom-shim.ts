// JSDOM-based DOM polyfill for headless Milkdown in Node.
// Imported as the very first thing in any module that touches Milkdown.
import { JSDOM } from 'jsdom';

const installed = (globalThis as unknown as { __bopplDomInstalled?: boolean }).__bopplDomInstalled;
if (!installed) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const g = globalThis as unknown as Record<string, unknown>;
  // Node 22 makes `navigator` a non-writable getter; only assign DOM-specific
  // bindings Milkdown actually reads.
  const safeAssign = (key: string, value: unknown): void => {
    try {
      g[key] = value;
    } catch {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    }
  };
  safeAssign('window', dom.window);
  safeAssign('document', dom.window.document);
  safeAssign('HTMLElement', dom.window.HTMLElement);
  safeAssign('Node', dom.window.Node);
  safeAssign('Element', dom.window.Element);
  safeAssign('DocumentFragment', dom.window.DocumentFragment);
  safeAssign('MutationObserver', dom.window.MutationObserver);
  safeAssign('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  // Milkdown's ctx Timer uses bare addEventListener / dispatchEvent / CustomEvent
  safeAssign('addEventListener', dom.window.addEventListener.bind(dom.window));
  safeAssign('removeEventListener', dom.window.removeEventListener.bind(dom.window));
  safeAssign('dispatchEvent', dom.window.dispatchEvent.bind(dom.window));
  safeAssign('CustomEvent', dom.window.CustomEvent);
  safeAssign('Event', dom.window.Event);
  safeAssign('EventTarget', dom.window.EventTarget);
  g.__bopplDomInstalled = true;
}
