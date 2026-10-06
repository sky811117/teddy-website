// 最小假 DOM：用建置好的 dist/find/index.html（parse5 解析）當標記，讓 Node 能跑 find-app.js 的整段流程。
// 這不能取代「用真瀏覽器看畫面」，但能抓到執行期錯誤、id／選擇器對不上、狀態機走偏、事件格式不合規格等問題。
// 只實作腳本用到的 API；沒有版面、沒有 CSS、沒有真的網路。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_helpers.mjs";

export async function loadParse5() {
  const pnpm = path.join(ROOT, "node_modules", ".pnpm");
  let dir = null;
  try {
    dir = fs.readdirSync(pnpm).find(d => /^parse5@7/.test(d));
  } catch { /* node_modules 不在 */ }
  if (!dir) return null;
  const entry = path.join(pnpm, dir, "node_modules", "parse5", "dist", "index.js");
  if (!fs.existsSync(entry)) return null;
  return import(pathToFileURL(entry).href);
}

/* ---------- 節點 ---------- */
class FNode {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    return n;
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; } return n; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] || null; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}
class FText extends FNode {
  constructor(doc, text) { super(doc); this.nodeType = 3; this.data = text; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

const BOOL_ATTRS = new Set(["hidden", "checked", "disabled", "open", "readonly", "required", "multiple"]);

class FElement extends FNode {
  constructor(doc, tag, ns) {
    super(doc);
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.namespaceURI = ns || null;
    this._attrs = new Map();
    this._listeners = {};
    this.style = {};
    this._value = null;
    this._checked = null;
    const el = this;
    this.classList = {
      add: (...c) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); c.forEach(x => s.add(x)); el.className = [...s].join(" "); },
      remove: (...c) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); c.forEach(x => s.delete(x)); el.className = [...s].join(" "); },
      contains: c => el.className.split(/\s+/).includes(c),
      toggle: c => { if (el.classList.contains(c)) { el.classList.remove(c); return false; } el.classList.add(c); return true; },
    };
  }
  get className() { return this._attrs.get("class") || ""; }
  set className(v) { this._attrs.set("class", String(v)); }
  get id() { return this._attrs.get("id") || ""; }
  set id(v) { this._attrs.set("id", String(v)); }
  get hidden() { return this._attrs.has("hidden"); }
  set hidden(v) { if (v) this._attrs.set("hidden", ""); else this._attrs.delete("hidden"); }
  get disabled() { return this._attrs.has("disabled"); }
  set disabled(v) { if (v) this._attrs.set("disabled", ""); else this._attrs.delete("disabled"); }
  get open() { return this._attrs.has("open"); }
  set open(v) { if (v) this._attrs.set("open", ""); else this._attrs.delete("open"); }
  get tabIndex() { return Number(this._attrs.get("tabindex") ?? -1); }
  set tabIndex(v) { this._attrs.set("tabindex", String(v)); }
  get type() { return this._attrs.get("type") || (this.localName === "input" ? "text" : ""); }
  set type(v) { this._attrs.set("type", String(v)); }
  get name() { return this._attrs.get("name") || ""; }
  get href() { return this._attrs.get("href") || ""; }
  get checked() { return this._checked === null ? this._attrs.has("checked") : this._checked; }
  set checked(v) {
    this._checked = !!v;
    // 單選：同一個表單（或整份文件）裡同名的其他單選會被取消
    if (v && this.localName === "input" && this.type === "radio" && this.name) {
      const scope = this.closest("form") || this.ownerDocument;
      queryAll(scope, `input[name="${this.name}"]`, false).forEach(o => { if (o !== this && o.type === "radio") o._checked = false; });
    }
  }
  get value() {
    if (this._value !== null) return this._value;
    if (this.localName === "textarea") return this.textContent;
    return this._attrs.get("value") ?? "";
  }
  set value(v) { this._value = String(v); }
  get textContent() { return this.childNodes.map(c => c.textContent).join(""); }
  set textContent(v) { this.childNodes.forEach(c => { c.parentNode = null; }); this.childNodes = []; if (v !== "" && v != null) this.appendChild(new FText(this.ownerDocument, String(v))); }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { this.textContent = v; }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) { this._attrs.set(n, BOOL_ATTRS.has(n) && v === "" ? "" : String(v)); if (n === "value") this._value = null; }
  removeAttribute(n) { this._attrs.delete(n); if (n === "checked") this._checked = null; }
  hasAttribute(n) { return this._attrs.has(n); }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter(f => f !== fn); }
  dispatchEvent(ev) {
    ev.target ||= this;
    for (let n = this; n; n = n.parentNode || (n === this.ownerDocument.documentElement ? this.ownerDocument : null)) {
      ev.currentTarget = n;
      for (const fn of [...((n._listeners && n._listeners[ev.type]) || [])]) fn.call(n, ev);
      if (ev._stop) break;
    }
    return !ev.defaultPrevented;
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() {}
  select() {}
  scrollIntoView() {}
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  matches(sel) { return matches(this, sel); }
  querySelector(sel) { return queryAll(this, sel, true)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel, false); }
  get elements() { return queryAll(this, "input,button,textarea,select", false); }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
}

/* ---------- 選擇器（只做腳本用到的：型別、#id、.class、[attr]、[attr=v]、:checked、複合、後代、逗號） ---------- */
function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [], checked: false, notHidden: false };
  const re = /^(?:([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:(checked))/;
  let rest = s;
  while (rest) {
    const m = re.exec(rest);
    if (!m) throw new Error("假 DOM 不支援的選擇器：" + s);
    if (m[1]) c.tag = m[1].toLowerCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push([m[4], m[5] ?? m[6] ?? m[7] ?? null]);
    else if (m[8]) c.checked = true;
    rest = rest.slice(m[0].length);
  }
  return c;
}
function compoundMatch(el, c) {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cl of c.classes) if (!el.className.split(/\s+/).includes(cl)) return false;
  for (const [k, v] of c.attrs) {
    if (!el.hasAttribute(k)) return false;
    if (v !== null && el.getAttribute(k) !== v) return false;
  }
  if (c.checked && !el.checked) return false;
  return true;
}
function splitTop(sel, sep) {
  const out = [];
  let cur = "", depth = 0, q = null;
  for (const ch of sel) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
function matches(el, sel) {
  return splitTop(sel, ",").some(part => {
    const chain = splitTop(part.replace(/\s+/g, " "), " ").map(parseCompound);
    if (!compoundMatch(el, chain[chain.length - 1])) return false;
    let n = el.parentNode;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (n && !(n.nodeType === 1 && compoundMatch(n, chain[i]))) n = n.parentNode;
      if (!n) return false;
      n = n.parentNode;
    }
    return true;
  });
}
function queryAll(root, sel, first) {
  const out = [];
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (matches(c, sel)) { out.push(c); if (first) return true; }
      if (walk(c) && first) return true;
    }
    return false;
  })(root);
  return out;
}

/* ---------- 文件、視窗 ---------- */
export function makeEnv({ html, parse5, fetchImpl, clock, search = "", hash = "", sessionData = {}, localData = {}, innerWidth = 390, reduceMotion = false }) {
  const doc = new FNode(null);
  doc.ownerDocument = doc;
  doc.nodeType = 9;
  doc._listeners = {};
  doc.addEventListener = (t, fn) => { (doc._listeners[t] ||= []).push(fn); };
  doc.removeEventListener = () => {};
  doc.hidden = false;
  doc.readyState = "complete";
  doc.title = "找房小幫手";
  doc.activeElement = null;
  doc.createElement = t => new FElement(doc, t);
  doc.createElementNS = (ns, t) => new FElement(doc, t, ns);
  doc.createTextNode = t => new FText(doc, t);
  doc.getElementById = id => queryAll(doc, "#" + id, true)[0] || null;
  doc.querySelector = s => queryAll(doc, s, true)[0] || null;
  doc.querySelectorAll = s => queryAll(doc, s, false);
  doc.execCommand = () => true;
  doc.dispatchEvent = ev => { ev.target ||= doc; for (const fn of [...(doc._listeners[ev.type] || [])]) fn.call(doc, ev); };

  const build = (p, parent) => {
    for (const c of p.childNodes || []) {
      if (c.nodeName === "#text") parent.appendChild(new FText(doc, c.value));
      else if (c.nodeName === "#comment" || c.nodeName === "#documentType") continue;
      else {
        const el = new FElement(doc, c.tagName || c.nodeName, c.namespaceURI);
        for (const a of c.attrs || []) el._attrs.set(a.name, a.value);
        parent.appendChild(el);
        if (c.nodeName === "script" || c.nodeName === "style") continue;
        build(c.content && c.nodeName === "template" ? c.content : c, el);
      }
    }
  };
  build(parse5.parse(html), doc);
  doc.documentElement = doc.childNodes.find(n => n.nodeType === 1 && n.localName === "html");
  doc.head = queryAll(doc, "head", true)[0];
  doc.body = queryAll(doc, "body", true)[0];
  doc.documentElement.setAttribute("data-theme", "light");

  const mkStore = init => {
    const m = new Map(Object.entries(init));
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
  };
  const beacons = [];
  const win = {
    document: doc,
    innerWidth,
    performance: { now: () => clock.now - clock.start },
    Date: { now: () => clock.now },
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: id => clock.clear(id),
    setInterval: (fn, ms) => clock.setInterval(fn, ms),
    clearInterval: id => clock.clear(id),
    fetch: (url, init) => fetchImpl(url, init),
    navigator: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; }, clipboard: { writeText: async t => { win.__copied = t; } } },
    location: { search, hash, pathname: "/find/" },
    history: { replaceState: (a, b, url) => { win.location.hash = ""; win.__replaced = url; } },
    sessionStorage: mkStore(sessionData),
    localStorage: mkStore(localData),
    matchMedia: q => ({ matches: reduceMotion && /reduce/.test(q), addEventListener() {}, removeEventListener() {} }),
    crypto,
    btoa, atob, TextEncoder, TextDecoder, Blob, URLSearchParams, JSON, Math, Promise, Array, Object, Number, String, Date, Uint8Array,
    encodeURIComponent, decodeURIComponent, parseInt, console,
    addEventListener: (t, fn) => { (win._l[t] ||= []).push(fn); },
    _l: {},
    __beacons: beacons,
  };
  win.window = win;
  win.globalThis = win;
  win.Date = { now: () => clock.now };
  return { doc, win };
}

export function makeClock(start = 1790000000000) {
  const c = { now: start, start, _id: 0, _t: [] };
  c.setTimeout = (fn, ms) => { const id = ++c._id; c._t.push({ id, at: c.now + (ms || 0), fn, every: 0 }); return id; };
  c.setInterval = (fn, ms) => { const id = ++c._id; c._t.push({ id, at: c.now + ms, fn, every: ms }); return id; };
  c.clear = id => { c._t = c._t.filter(t => t.id !== id); };
  /** 前進 ms 毫秒，依時間順序執行到期的計時器（每個回呼之間讓出事件迴圈，讓 Promise 鏈跑完） */
  c.advance = async ms => {
    const end = c.now + ms;
    for (;;) {
      c._t.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = c._t[0];
      if (!t || t.at > end) break;
      c.now = Math.max(c.now, t.at);
      if (t.every) t.at += t.every; else c._t.shift();
      t.fn();
      await flush();
    }
    c.now = end;
    await flush();
  };
  return c;
}
export const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

export function ev(type, extra = {}) { return { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, ...extra }; }
export function click(el) { return el.dispatchEvent(ev("click", { target: el })); }
export function submit(form) { return form.dispatchEvent(ev("submit", { target: form })); }
export function type(el, text) { el.value = text; el.dispatchEvent(ev("input", { target: el })); }
export function change(el) { return el.dispatchEvent(ev("change", { target: el })); }
export function setChecked(el, v) { el.checked = v; change(el); }
export const requireFromRoot = createRequire(path.join(ROOT, "package.json"));
