// 最小假 DOM：讓 node 能跑 mountWaitGame 的介面層（沒有瀏覽器、沒有 jsdom、不連網）
// 只實作遊戲用到的 API；canvas 2D context 會記錄所有呼叫，供測試檢查。

const COLOR_OK = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|red|blue|white|black|transparent)$/i;

export function makeCtx(trace = false) {
  const calls = [], states = [];
  let fill = '#000000', stroke = '#000000';
  const norm = (v, cur) => (typeof v === 'string' && COLOR_OK.test(v.trim())) ? v.trim().toLowerCase() : cur;
  const ctx = {
    calls, texts: [], states,
    dash: [],
    get fillStyle() { return fill; }, set fillStyle(v) { fill = norm(v, fill); },
    get strokeStyle() { return stroke; }, set strokeStyle(v) { stroke = norm(v, stroke); },
    font: '', lineWidth: 1, lineCap: '', lineJoin: '', globalAlpha: 1, textAlign: '', textBaseline: '',
    measureText(t) {   // 近似真實字寬：全形字 = 字級，半形 = 0.55 倍字級
      const px = parseFloat((/([0-9]+(?:[.][0-9]+)?)px/.exec(this.font) || [0, 14])[1]);
      let w = 0; for (const ch of String(t)) w += (ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.55) * px;
      return { width: w };
    },
  };
  const names = ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'save', 'restore', 'translate', 'scale', 'setLineDash', 'fillText'];
  for (const n of names) {
    ctx[n] = (...a) => {
      for (const x of a) if (typeof x === 'number' && !Number.isFinite(x)) throw new Error(`ctx.${n} 收到非有限數值：${a}`);
      calls.push([n, ...a]);
      if (n === 'setLineDash') ctx.dash = a[0];
      if (trace) states.push({ fill, stroke, lw: ctx.lineWidth, font: ctx.font, ga: ctx.globalAlpha, ta: ctx.textAlign, tb: ctx.textBaseline, cap: ctx.lineCap, dash: ctx.dash });
      if (n === 'fillText') ctx.texts.push(String(a[0]));
    };
  }
  return ctx;
}

class FakeEl {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase(); this.doc = doc;
    this.children = []; this.parentNode = null; this.attrs = {}; this._l = {};
    this.className = ''; this.id = ''; this.hidden = false; this.textContent = ''; this.tabIndex = -1; this.type = '';
    this.width = 300; this.height = 150; this.clientWidth = 0; this.clientHeight = 0; this.disabled = false;
    const props = {};
    this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: (k) => props[k] || '', _props: props, touchAction: '', cursor: '', height: '' };
    this._ctx = null; this._mo = null;
  }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (this._mo) this._mo.cb([{ type: 'attributes', attributeName: k }]); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this._l[t] ||= []).push(f); }
  removeEventListener(t, f) { const a = this._l[t]; if (!a) return; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }
  listenerCount() { return Object.values(this._l).reduce((n, a) => n + a.length, 0); }
  dispatch(type, ev = {}) {
    const e = Object.assign({ type, target: this, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, ev);
    for (const f of [...(this._l[type] || [])]) f(e);
    return e;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  focus() { this.doc.activeElement = this; }
  setPointerCapture() { this.captured = true; }
  releasePointerCapture() { this.captured = false; }
  getContext(kind) { if (kind !== '2d' || this.doc.noCanvas) return null; return (this._ctx ||= makeCtx(!!this.doc.trace)); }
  find(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.find(pred, out); return out; }
  byClass(cls) { return this.find((e) => e.className.split(/\s+/).includes(cls)); }
  allDescendantsListeners() { return this.find(() => true).reduce((n, e) => n + e.listenerCount(), 0); }
}

/**
 * 安裝全域假環境。回傳 { env, uninstall }。
 * opts: { fieldW, fieldH, dpr, media:{query:boolean}, cssVars:{'--u2-ink':'#...'}, storage:'ok'|'throw'|'none', noCanvas, noObservers }
 */
export function installFakeDom(opts = {}) {
  const doc = new FakeEl('#document', null); doc.doc = doc;
  doc.documentElement = new FakeEl('html', doc);
  doc.head = new FakeEl('head', doc); doc.body = new FakeEl('body', doc);
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  doc.hidden = false; doc.activeElement = null; doc.noCanvas = !!opts.noCanvas;

  const origCreate = (tag) => {
    const e = new FakeEl(tag, doc);
    return e;
  };
  doc.createElement = (tag) => origCreate(tag);
  doc.getElementById = (id) => doc.documentElement.find((e) => e.id === id)[0] || null;
  doc.querySelector = (sel) => {
    if (sel.startsWith('.')) return doc.documentElement.byClass(sel.slice(1))[0] || null;
    return null;
  };

  const env = {
    doc, clock: { t: 1000 }, frames: new Map(), nextFrame: 1, mqs: [], ros: [], ios: [], mos: [], storageData: new Map(), storageLog: [],
    cssVars: opts.cssVars || {}, fieldW: opts.fieldW ?? 340, fieldH: opts.fieldH ?? 236,
  };

  // field 的尺寸（真瀏覽器由 flex 算出）
  const baseCreate = doc.createElement;
  doc.createElement = (tag) => {
    const e = baseCreate(tag);
    Object.defineProperty(e, 'clientWidth', { get() { return e.className === 'wg-field' ? env.fieldW : 0; }, set() {}, configurable: true });
    Object.defineProperty(e, 'clientHeight', { get() { return e.className === 'wg-field' ? env.fieldH : 0; }, set() {}, configurable: true });
    return e;
  };
  doc.addEventListener = FakeEl.prototype.addEventListener.bind(doc);

  const g = globalThis;
  const saved = {};
  const set = (k, v) => { saved[k] = Object.getOwnPropertyDescriptor(g, k); Object.defineProperty(g, k, { value: v, configurable: true, writable: true }); };

  set('window', g);
  set('document', doc);
  set('devicePixelRatio', opts.dpr ?? 2);
  set('performance', { now: () => env.clock.t });
  set('getComputedStyle', () => ({ getPropertyValue: (n) => env.cssVars[n] || '' }));
  set('matchMedia', (q) => {
    const mq = {
      media: q, matches: !!(opts.media && opts.media[q]), _l: [],
      addEventListener(t, f) { this._l.push(f); }, removeEventListener(t, f) { const i = this._l.indexOf(f); if (i >= 0) this._l.splice(i, 1); },
      fire(m) { this.matches = m; for (const f of [...this._l]) f({ matches: m, media: q }); },
    };
    env.mqs.push(mq); return mq;
  });
  set('requestAnimationFrame', (cb) => { const id = env.nextFrame++; env.frames.set(id, cb); return id; });
  set('cancelAnimationFrame', (id) => { env.frames.delete(id); });

  if (opts.storage !== 'none') {
    set('localStorage', {
      getItem(k) { if (opts.storage === 'throw') throw new Error('denied'); return env.storageData.has(k) ? env.storageData.get(k) : null; },
      setItem(k, v) { env.storageLog.push([k, v]); if (opts.storage === 'throw') throw new Error('denied'); env.storageData.set(k, v); },
    });
  } else { set('localStorage', undefined); }

  if (!opts.noObservers) {
    set('MutationObserver', class { constructor(cb) { this.cb = cb; env.mos.push(this); } observe(t) { this.target = t; t._mo = this; } disconnect() { if (this.target) this.target._mo = null; this.disconnected = true; } });
    set('ResizeObserver', class { constructor(cb) { this.cb = cb; env.ros.push(this); } observe(t) { this.target = t; this.cb([{ target: t }]); } disconnect() { this.disconnected = true; } });
    set('IntersectionObserver', class { constructor(cb) { this.cb = cb; env.ios.push(this); } observe(t) { this.target = t; } disconnect() { this.disconnected = true; } });
  } else {
    set('MutationObserver', undefined); set('ResizeObserver', undefined); set('IntersectionObserver', undefined);
  }

  /** 讓時間往前走 ms 毫秒，每 ~16.67ms 跑一次 rAF；回傳跑了幾幀 */
  env.pump = (ms, frameMs = 1000 / 60) => {
    let n = 0, left = ms;
    while (left > 1e-9) {
      const dt = Math.min(frameMs, left); left -= dt; env.clock.t += dt;
      const cbs = [...env.frames.entries()]; env.frames.clear();
      for (const [, cb] of cbs) { cb(env.clock.t); n++; }
    }
    return n;
  };
  env.pending = () => env.frames.size;
  env.tick = (ms) => { env.clock.t += ms; };

  const uninstall = () => {
    for (const k of Object.keys(saved)) {
      if (saved[k]) Object.defineProperty(g, k, saved[k]); else delete g[k];
    }
  };
  return { env, uninstall };
}

/** 掛一個容器到 body，回傳容器與常用元素 */
export function mountParts(env, container) {
  const root = container.byClass('wg-root')[0] || null;
  return {
    root,
    canvas: root ? root.byClass('wg-canvas')[0] : null,
    field: root ? root.byClass('wg-field')[0] : null,
    note: root ? root.byClass('wg-note')[0] : null,
    skip: root ? root.byClass('wg-skip')[0] : null,
    title: root ? root.byClass('wg-title')[0] : null,
    ctx: root ? root.byClass('wg-canvas')[0].getContext('2d') : null,
  };
}
