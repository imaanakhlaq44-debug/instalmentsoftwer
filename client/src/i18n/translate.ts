import { ROMAN_URDU, ROMAN_URDU_PATTERNS } from './romanUrdu.js';
import { URDU, URDU_ONLY, URDU_PATTERNS } from './urdu.js';

type Patterns = Array<[RegExp, string]>;

const URDU_ALL: Record<string, string> = { ...URDU_ONLY, ...URDU };

/** Left-to-right mark: invisible, and makes what it brackets read left to right. */
const LRM = '‎';
/** First-strong isolate and its close, around a value dropped into an Urdu line. */
const FSI = '⁨';
const PDI = '⁩';
/** Hebrew and Arabic blocks, including the presentation forms: text that is already right-to-left. */
const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
/** The invisible direction marks this file adds, removed again when text is copied. */
export const BIDI_MARKS = /[‎⁦-⁩]/g;

function lookup(
  key: string,
  exact: Record<string, string>,
  patterns: Patterns,
  isolate: boolean
): string | undefined {
  // Object.hasOwn-style guard: a key such as "constructor" must not find Object's own.
  if (Object.prototype.hasOwnProperty.call(exact, key)) return exact[key];
  for (const [re, rep] of patterns) {
    if (!re.test(key)) continue;
    if (!isolate) return key.replace(re, rep);
    // A name or model dropped into a right-to-left line keeps its own order.
    return key.replace(re, (...args) =>
      rep.replace(/\$(\d)/g, (_m, n) => `${FSI}${args[Number(n)] ?? ''}${PDI}`)
    );
  }
  return undefined;
}

function withSpacing(text: string, out: string): string {
  const lead = text.match(/^\s*/)?.[0] ?? '';
  const trail = text.match(/\s*$/)?.[0] ?? '';
  return lead + out + trail;
}

/**
 * English to Roman Urdu for one piece of rendered text.
 *
 * Surrounding whitespace is kept, so "Paid " beside a number still reads
 * right. Text with no entry comes back unchanged.
 */
export function toRomanUrdu(text: string): string {
  const key = text.replace(/\s+/g, ' ').trim();
  if (!key || !/[A-Za-z]/.test(key)) return text;
  const out = lookup(key, ROMAN_URDU, ROMAN_URDU_PATTERNS, false);
  if (out === undefined || out === key) return text;
  return withSpacing(text, out);
}

/**
 * English to Urdu for one piece of rendered text.
 *
 * A line with no Urdu entry stays in English, and anything left in Latin
 * letters or digits (an amount, an IMEI, a CNIC, a phone number, a date, a
 * customer's name) is bracketed with left-to-right marks, so a right-to-left
 * page cannot reorder "+92 300 1234567" or move the bracket of "(8/128)".
 */
export function toUrdu(text: string): string {
  const key = text.replace(/\s+/g, ' ').trim();
  if (!key || RTL_CHARS.test(key)) return text;
  if (/[A-Za-z]/.test(key)) {
    const out = lookup(key, URDU_ALL, URDU_PATTERNS, true);
    if (out !== undefined && out !== key) return withSpacing(text, out);
  }
  // A lone sign belongs to the figure beside it: "#" then "3", "95" then "%".
  if (!/[A-Za-z0-9]/.test(key) && !/^[#%+\-−×]+$/.test(key)) return text;
  return withSpacing(text, LRM + text.trim() + LRM);
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

  constructor(private readonly translate: (text: string) => string = toRomanUrdu) {}

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
    const translated = this.translate(current);
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
    const translated = this.translate(current);
    if (translated === current) return;
    const original = this.originalAttr.get(el) ?? new Map<string, string>();
    original.set(name, current);
    written.set(name, translated);
    this.originalAttr.set(el, original);
    this.writtenAttr.set(el, written);
    el.setAttribute(name, translated);
  }
}
