import { ROMAN_URDU, ROMAN_URDU_PATTERNS } from './romanUrdu.js';

/**
 * English to Roman Urdu for one piece of rendered text.
 *
 * Surrounding whitespace is kept, so "Paid " beside a number still reads
 * right. Text with no entry comes back unchanged.
 */
export function toRomanUrdu(text: string): string {
  const key = text.replace(/\s+/g, ' ').trim();
  if (!key || !/[A-Za-z]/.test(key)) return text;

  let out = ROMAN_URDU[key];
  if (out === undefined) {
    for (const [re, rep] of ROMAN_URDU_PATTERNS) {
      if (re.test(key)) {
        out = key.replace(re, rep);
        break;
      }
    }
  }
  if (out === undefined || out === key) return text;

  const lead = text.match(/^\s*/)?.[0] ?? '';
  const trail = text.match(/\s*$/)?.[0] ?? '';
  return lead + out + trail;
}

const ATTRS = ['placeholder', 'title', 'aria-label'] as const;

/** Never touched: what people type, code, and anything marked to stay as written (the signed agreement). */
const SKIP = 'script, style, textarea, input, code, pre, [contenteditable="true"], [data-i18n-skip]';

/**
 * Translates the live page in place, and keeps translating what React renders
 * next, until stopped. React keeps its own copy of what it rendered, so it
 * simply overwrites a translated node on the next update; the observer sees
 * that and translates it again.
 */
export class PageTranslator {
  private observer?: MutationObserver;
  /** What each node said in English, and what we last wrote into it. */
  private originalText = new WeakMap<Text, string>();
  private writtenText = new WeakMap<Text, string>();
  private originalAttr = new WeakMap<Element, Map<string, string>>();
  private writtenAttr = new WeakMap<Element, Map<string, string>>();
  private root?: HTMLElement;

  start(root: HTMLElement = document.body): void {
    this.root = root;
    this.walk(root);
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') this.text(r.target as Text);
        else if (r.type === 'attributes') this.attr(r.target as Element, r.attributeName!);
        else r.addedNodes.forEach((n) => this.walk(n));
      }
    });
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRS],
    });
  }

  /** Stops, and puts the English back wherever our translation is still showing. */
  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    if (!this.root) return;
    // Whatever still shows our translation goes back to its English. A node
    // React has since rewritten is already English and is left alone.
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node: Node | null = this.root;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node as Text;
        if (this.writtenText.get(t) === t.nodeValue) t.nodeValue = this.originalText.get(t) ?? t.nodeValue;
      } else {
        const el = node as Element;
        const written = this.writtenAttr.get(el);
        const original = this.originalAttr.get(el);
        written?.forEach((value, name) => {
          if (el.getAttribute(name) === value && original?.has(name)) el.setAttribute(name, original.get(name)!);
        });
      }
      node = walker.nextNode();
    }
  }

  private skipped(node: Node): boolean {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return !el || el.closest(SKIP) !== null;
  }

  /**
   * An input's hint (placeholder, title) is translated; what is typed into it
   * never is, because only attributes are ever touched on the field itself.
   */
  private attrSkipped(el: Element): boolean {
    if (el.matches('input, textarea')) {
      return el.closest('[data-i18n-skip]') !== null || (el.parentElement?.closest(SKIP) ?? null) !== null;
    }
    return this.skipped(el);
  }

  private walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.text(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    for (const name of ATTRS) if (el.hasAttribute(name)) this.attr(el, name);
    if (this.skipped(el)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n: Node | null = walker.nextNode();
    while (n) {
      if (n.nodeType === Node.TEXT_NODE) this.text(n as Text);
      else for (const name of ATTRS) if ((n as Element).hasAttribute(name)) this.attr(n as Element, name);
      n = walker.nextNode();
    }
  }

  private text(node: Text): void {
    const current = node.nodeValue ?? '';
    if (this.writtenText.get(node) === current) return; // our own write
    if (this.skipped(node)) return;
    const translated = toRomanUrdu(current);
    if (translated === current) return;
    this.originalText.set(node, current);
    this.writtenText.set(node, translated);
    node.nodeValue = translated;
  }

  private attr(el: Element, name: string): void {
    const current = el.getAttribute(name);
    if (current === null) return;
    const written = this.writtenAttr.get(el) ?? new Map<string, string>();
    if (written.get(name) === current) return;
    if (this.attrSkipped(el)) return;
    const translated = toRomanUrdu(current);
    if (translated === current) return;
    const original = this.originalAttr.get(el) ?? new Map<string, string>();
    original.set(name, current);
    written.set(name, translated);
    this.originalAttr.set(el, original);
    this.writtenAttr.set(el, written);
    el.setAttribute(name, translated);
  }
}
