/**
 * uf-ruler.js — 嫌惡設施頁的「距離尺」（只有 /tools/undesirable-facilities/ 用）
 *
 * 一條 0 到查詢範圍（300／500／1000 公尺）的水平刻度尺，每處設施是尺上的一個點：
 *   - 左右位置＝直線距離（精確，不分箱）；距離太近擠在一起的點往上疊一層（貪婪分層，最多 MAX_ROWS 層）
 *   - 顏色＝類別（--cl 淺色、--cd 深色，跟地圖同一組）
 *   - 滑過／點一下：尺上方浮出名稱與距離；點一下同時通知頁面（地圖飛過去、清單標亮）
 *   - 鍵盤：整條尺是一個 Tab 停點，左右方向鍵在點之間移動、Enter 選取（完整清單在尺下面，這裡不重複給上百個 Tab 停點）
 *   - 出場：一道光從 0 掃到最遠，點依距離依序浮現（prefers-reduced-motion 時直接全部顯示，CSS 處理）
 *
 * 用法：
 *   const r = createRuler(el, { onPick(i) {} });
 *   r.render({ R: 300, items: [{ i, d, g, name, cat, style }], anim: true });
 *   r.select(i)   // 標亮一個點並顯示名稱（-1 取消）
 *   r.ping(i)     // 地圖上的雷達光束掃到它時閃一下
 */

const MAX_ROWS = 8;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function mtxt(d) {
  if (d < 1000) return "約 " + Math.max(10, Math.round(d / 10) * 10) + " 公尺";
  return "約 " + (d / 1000).toFixed(1) + " 公里";
}
// 主刻度：300／500 公尺每 100 公尺一格；1 公里標出三個查詢圈（300、500、1000）
function ticks(R) {
  const major = R <= 500 ? [0, 100, 200, 300, 400, 500].filter(v => v <= R) : [0, 300, 500, 1000];
  const minor = [];
  const step = R <= 500 ? 50 : 100;
  for (let v = step; v < R; v += step) if (major.indexOf(v) < 0) minor.push(v);
  return { major, minor };
}

export function createRuler(root, o) {
  const opts = o || {};
  const st = { R: 300, items: [], byI: {}, sel: -1, focus: -1, w: 0, s: 14, rows: 1 };
  root.classList.add("uf-ruler");
  root.setAttribute("role", "group");
  root.tabIndex = 0;
  root.innerHTML =
    '<div class="uf-r-plot"><div class="uf-r-scan" aria-hidden="true"></div><div class="uf-r-dots"></div>' +
    '<div class="uf-r-tip" aria-hidden="true" hidden></div></div><div class="uf-r-axis" aria-hidden="true"></div>' +
    '<p class="uf-sr" aria-live="polite"></p>';
  const plot = root.children[0];
  const dotsEl = plot.children[1];
  const tip = plot.children[2];
  const axis = root.children[1];
  const live = root.children[2];

  function layout() {
    const w = dotsEl.clientWidth || plot.clientWidth || 300;
    st.w = w;
    const n = st.items.length;
    const s = n <= 30 ? 14 : n <= 90 ? 12 : 10;
    st.s = s;
    const gap = s + 2;
    const rowH = s + 4;
    const last = [];
    const els = dotsEl.children;
    st.items.forEach((x, k) => {
      const px = (Math.min(x.d, st.R) / st.R) * w;
      let row = -1;
      for (let r = 0; r < last.length; r++) if (px - last[r] >= gap) { row = r; break; }
      if (row < 0) {
        if (last.length < MAX_ROWS) { row = last.length; last.push(-1e9); }
        else {
          // 層數滿了：放到最「空」的那一層（重疊一點，總比把尺撐得很高好）
          row = 0;
          for (let r = 1; r < last.length; r++) if (last[r] < last[row]) row = r;
        }
      }
      last[row] = px;
      x.row = row;
      x.px = px;
      const el = els[k];
      if (el) el.style.bottom = row * rowH + "px";
    });
    st.rows = Math.max(1, last.length);
    // 刻度字太擠（窄螢幕的「400」「500 公尺」）：從最後一個往前，擋到的就先藏起來
    const labs = axis.querySelectorAll(".uf-r-tk b");
    for (let k = 0; k < labs.length; k++) labs[k].style.visibility = "";
    if (labs.length > 2 && labs[labs.length - 1].offsetWidth) {
      const lastL = labs[labs.length - 1].getBoundingClientRect().left;
      for (let k = labs.length - 2; k >= 1; k--) {
        if (labs[k].getBoundingClientRect().right > lastL - 6) labs[k].style.visibility = "hidden";
        else break;
      }
    }
    root.style.setProperty("--uf-rs", s + "px");
    dotsEl.style.height = Math.max(1, last.length) * rowH + "px";
    if (st.sel >= 0) showTip(st.sel);
    else hideTip();
  }

  function renderAxis() {
    const t = ticks(st.R);
    const h = [];
    t.minor.forEach(v => h.push('<i class="uf-r-mt" style="left:' + (v / st.R) * 100 + '%"></i>'));
    t.major.forEach((v, k) => {
      const edge = k === 0 ? " is-first" : v === st.R ? " is-last" : "";
      const lab = v === st.R ? (v >= 1000 ? v / 1000 + " 公里" : v + " 公尺") : String(v);
      h.push('<span class="uf-r-tk' + edge + '" style="left:' + (v / st.R) * 100 + '%"><i></i><b>' + lab + "</b></span>");
    });
    axis.innerHTML = '<span class="uf-r-line"></span>' + h.join("");
  }

  function render(d) {
    st.R = d.R || 300;
    st.items = (d.items || []).slice();
    st.byI = {};
    st.sel = -1;
    st.focus = -1;
    root.classList.toggle("is-anim", !!d.anim);
    root.setAttribute("aria-label", "距離尺：0 到 " + (st.R >= 1000 ? st.R / 1000 + " 公里" : st.R + " 公尺") + "，共 " + st.items.length + " 處；左右方向鍵逐一查看");
    dotsEl.innerHTML = st.items
      .map((x, k) => {
        st.byI[x.i] = k;
        const p = Math.min(x.d, st.R) / st.R;
        return (
          '<button type="button" tabindex="-1" class="uf-r-dot" data-i="' + x.i + '" style="' + x.style + ";left:" + (p * 100).toFixed(3) +
          "%;--p:" + p.toFixed(3) + '" aria-label="' + esc(x.name + "，" + x.cat + "，" + mtxt(x.d)) + '"></button>'
        );
      })
      .join("");
    // 重新觸發掃描光的動畫
    const scan = plot.children[0];
    scan.style.animation = "none";
    void scan.offsetWidth;
    scan.style.animation = "";
    renderAxis();
    layout();
  }

  function dotEl(i) {
    const k = st.byI[i];
    return k == null ? null : dotsEl.children[k];
  }
  // 名稱標籤：沒選任何點時固定標在最近的那一處（「最近：…」），滑過或選了別的點就換成那一處
  function showTip(i, near) {
    const k = st.byI[i];
    const x = k == null ? null : st.items[k];
    if (!x) { hideTip(); return; }
    tip.innerHTML = "<b>" + (near ? "最近：" : "") + esc(x.name) + "</b><span>" + esc(x.cat) + "・" + mtxt(x.d) + "</span>";
    tip.classList.toggle("is-near", !!near);
    tip.hidden = false;
    const tw = tip.offsetWidth || 120;
    const w = st.w || dotsEl.clientWidth || 300;
    const left = Math.max(tw / 2 - 8, Math.min(w - tw / 2 + 8, x.px));
    // 標籤一律浮在所有點的上方（不蓋住疊在上層的點），用一條細線指回那個點
    const rowH = st.s + 4;
    const top = (st.rows || 1) * rowH + 6;
    tip.style.left = left + "px";
    tip.style.bottom = top + "px";
    tip.style.setProperty("--ax", (x.px - left + tw / 2).toFixed(1) + "px");
    tip.style.setProperty("--drop", Math.max(0, top - ((x.row || 0) * rowH + st.s)).toFixed(1) + "px");
  }
  function hideTip() {
    if (st.items.length) showTip(st.items[0].i, true);
    else tip.hidden = true;
  }
  function select(i, quiet) {
    const old = dotEl(st.sel);
    if (old) old.classList.remove("is-sel");
    st.sel = i == null ? -1 : i;
    const el = dotEl(st.sel);
    if (!el) { st.sel = -1; hideTip(); return; }
    el.classList.add("is-sel");
    st.focus = st.byI[st.sel];
    showTip(st.sel);
    if (!quiet) {
      const x = st.items[st.byI[st.sel]];
      live.textContent = x ? x.name + "，" + x.cat + "，" + mtxt(x.d) : "";
    }
  }
  function ping(i) {
    const el = dotEl(i);
    if (!el) return;
    el.classList.remove("is-ping");
    void el.offsetWidth;
    el.classList.add("is-ping");
  }

  dotsEl.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest(".uf-r-dot");
    if (!b) return;
    const i = +b.getAttribute("data-i");
    select(i);
    if (opts.onPick) opts.onPick(i);
  });
  dotsEl.addEventListener("mouseover", e => {
    const b = e.target.closest && e.target.closest(".uf-r-dot");
    if (b) showTip(+b.getAttribute("data-i"));
  });
  dotsEl.addEventListener("mouseleave", () => {
    if (st.sel >= 0) showTip(st.sel);
    else hideTip();
  });
  root.addEventListener("keydown", e => {
    const n = st.items.length;
    if (!n) return;
    let k = st.focus;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") k = k < 0 ? 0 : Math.min(n - 1, k + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") k = k < 0 ? 0 : Math.max(0, k - 1);
    else if (e.key === "Home") k = 0;
    else if (e.key === "End") k = n - 1;
    else if ((e.key === "Enter" || e.key === " ") && st.focus >= 0) {
      e.preventDefault();
      if (opts.onPick) opts.onPick(st.items[st.focus].i);
      return;
    } else return;
    e.preventDefault();
    select(st.items[k].i);
  });

  let rw = 0;
  if ("ResizeObserver" in window) {
    new ResizeObserver(es => {
      const w = Math.round(es[es.length - 1].contentRect.width);
      if (w && w !== rw) { rw = w; if (st.items.length) layout(); }
    }).observe(dotsEl);
  }

  return { render, select, ping, layout };
}
