/**
 * uf-sweep.js — 地圖上的「雷達掃描」光束（只有 /tools/undesirable-facilities/ 用）
 *
 * 一張 2D canvas 疊在 MapLibre 地圖畫布上面、圖釘下面（插在 .cine-map-grade 後面；Marker 之後才加進來會在它上面），
 * pointer-events: none，不擋地圖操作。
 *
 * 每一格用 map.project() 把「地面上的扇形」投影到螢幕：地圖斜視（pitch）或旋轉時，光束一樣貼在地面上、
 * 跟 MapLibre 畫的 300／500／1000 公尺範圍圈對齊，光束掃過的方位角＝設施亮起的方位角（頁面用 onAngle 對時）。
 *   - 前緣一條亮線＋尾巴 16 片漸淡的扇形（琥珀／赤陶色；深色模式 CSS 用 mix-blend-mode: screen，像夜裡的暖燈）
 *   - 轉一圈（等角速度）後淡出；分頁切到背景時 requestAnimationFrame 停下，回來時時間已經超過 → 直接收尾
 *   - DPR 上限 2
 *
 * 用法：
 *   const sw = createSweep(map, { isDark: () => bool, isVisible: () => bool });
 *   sw.play({ center: [lng, lat], radius: 300, start: 方位角, dur: 2800, onAngle(deg, t), onDone() });
 *   sw.stop(finish)   // finish=true → 先叫 onAngle(360) 再 onDone（把還沒亮的點一次補完）
 */

const TRAIL = 84; // 尾巴的角度
const SLICES = 16;
const M_PER_DEG = 111320;

function dest(c, r, deg) {
  const a = (deg * Math.PI) / 180;
  const lat = c[1] + (r * Math.cos(a)) / M_PER_DEG;
  const lng = c[0] + (r * Math.sin(a)) / (M_PER_DEG * Math.cos((c[1] * Math.PI) / 180));
  return [lng, lat];
}

export function createSweep(map, o) {
  const opts = o || {};
  const mc = map.getCanvas();
  const box = mc.parentNode;
  const cv = document.createElement("canvas");
  cv.className = "uf-sweep";
  cv.setAttribute("aria-hidden", "true");
  let after = mc.nextSibling;
  if (after && after.classList && after.classList.contains("cine-map-grade")) after = after.nextSibling;
  box.insertBefore(cv, after);
  const ctx = cv.getContext("2d");
  let W = 0, H = 0, dpr = 1;

  function size() {
    const w = mc.clientWidth, h = mc.clientHeight;
    const r = Math.min(2, window.devicePixelRatio || 1);
    if (w === W && h === H && r === dpr) return;
    W = w; H = h; dpr = r;
    cv.width = Math.max(1, Math.round(w * r));
    cv.height = Math.max(1, Math.round(h * r));
    cv.style.width = w + "px";
    cv.style.height = h + "px";
  }
  map.on("resize", size);
  size();

  let run = null;
  let raf = 0;

  function proj(ll) {
    const p = map.project(ll);
    return [p.x * dpr, p.y * dpr];
  }
  function clear() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
  }

  // 畫一格：lead＝前緣的方位角，fade＝整體透明度（收尾淡出用）
  function draw(lead, fade) {
    clear();
    if (!run || fade <= 0) return;
    const dark = !!(opts.isDark && opts.isDark());
    const c = run.center, R = run.radius;
    const o0 = proj(c);
    const A = (dark ? 0.3 : 0.34) * fade;
    const span = Math.min(TRAIL, lead - run.start + 0.001); // 剛起步時尾巴還沒長出來
    // 尾巴：整片扇形（地面上精確投影）一次填滿，用錐形漸層做「越往後越淡」——沒有一片片的接縫。
    // 錐形漸層的角度用螢幕上的角度（斜視時跟地面角度不完全等比，但只影響明暗分布，扇形邊界是精確的）
    if (ctx.createConicGradient && span > 1) {
      const t0 = proj(dest(c, R, lead - span));
      const aT = Math.atan2(t0[1] - o0[1], t0[0] - o0[0]);
      const l0 = proj(dest(c, R, lead));
      const aL = Math.atan2(l0[1] - o0[1], l0[0] - o0[0]);
      let d = aL - aT;
      while (d <= 0) d += Math.PI * 2;
      const f = Math.min(0.999, d / (Math.PI * 2));
      const cg = ctx.createConicGradient(aT, o0[0], o0[1]);
      const rgb = dark ? "255,186,108" : "206,122,52";
      for (let q = 0; q <= 6; q++) {
        const u = q / 6;
        cg.addColorStop(u * f, "rgba(" + rgb + "," + (A * Math.pow(u, 1.7)).toFixed(3) + ")");
      }
      cg.addColorStop(Math.min(1, f + 0.0005), "rgba(" + rgb + ",0)");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(o0[0], o0[1]);
      const n = Math.max(4, Math.ceil(span / 4));
      for (let q = 0; q <= n; q++) {
        const p = proj(dest(c, R, lead - span + (span * q) / n));
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      drawSlices(c, R, o0, lead, span, A, dark);
    }
    edge(c, R, o0, lead, fade, dark);
  }
  // 舊瀏覽器（沒有 createConicGradient）：16 片漸淡的扇形
  function drawSlices(c, R, o0, lead, span, A, dark) {
    const step = span / SLICES;
    for (let j = 0; j < SLICES; j++) {
      const a1 = lead - j * step, a0 = a1 - step - 0.6;
      if (a1 - run.start < 0) break;
      const k = 1 - j / SLICES;
      const alpha = A * Math.pow(k, 1.7);
      if (alpha < 0.004) continue;
      ctx.fillStyle = dark ? "rgba(255,186,108," + alpha.toFixed(3) + ")" : "rgba(206,122,52," + alpha.toFixed(3) + ")";
      ctx.beginPath();
      ctx.moveTo(o0[0], o0[1]);
      const n = 3;
      for (let q = 0; q <= n; q++) {
        const p = proj(dest(c, R, a0 + ((a1 - a0) * q) / n));
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  // 前緣亮線＋外圈上的一顆亮點
  function edge(c, R, o0, lead, fade, dark) {
    const e = proj(dest(c, R, lead));
    ctx.lineCap = "round";
    ctx.shadowColor = dark ? "rgba(255,200,130," + (0.9 * fade).toFixed(3) + ")" : "rgba(255,176,92," + (0.85 * fade).toFixed(3) + ")";
    ctx.shadowBlur = 14 * dpr;
    const g = ctx.createLinearGradient(o0[0], o0[1], e[0], e[1]);
    g.addColorStop(0, dark ? "rgba(255,226,176,0)" : "rgba(168,86,34,0)");
    g.addColorStop(0.25, dark ? "rgba(255,226,176," + (0.55 * fade).toFixed(3) + ")" : "rgba(168,86,34," + (0.55 * fade).toFixed(3) + ")");
    g.addColorStop(1, dark ? "rgba(255,238,205," + (0.95 * fade).toFixed(3) + ")" : "rgba(176,92,38," + (0.95 * fade).toFixed(3) + ")");
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(o0[0], o0[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.stroke();
    ctx.fillStyle = dark ? "rgba(255,240,210," + fade.toFixed(3) + ")" : "rgba(255,214,150," + fade.toFixed(3) + ")";
    ctx.beginPath();
    ctx.arc(e[0], e[1], 3.2 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function frame(t) {
    raf = 0;
    const r = run;
    if (!r) return;
    if (!r.t0) r.t0 = t;
    // 地圖捲出畫面：不用再演，直接收尾（該亮的點一次亮完）
    if (opts.isVisible && !opts.isVisible()) { finish(t); return; }
    size();
    const e = t - r.t0;
    const p = Math.min(1, e / r.dur);
    const deg = p * 360;
    if (r.onAngle) r.onAngle(deg, t);
    if (p < 1) {
      draw(r.start + deg, Math.min(1, e / 180));
    } else {
      const f = 1 - (e - r.dur) / 520;
      if (f <= 0) { finish(t); return; }
      draw(r.start + 360, f);
    }
    raf = requestAnimationFrame(frame);
  }

  function finish(t) {
    const r = run;
    run = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clear();
    if (r) {
      if (r.onAngle) r.onAngle(360, t || performance.now());
      if (r.onDone) r.onDone();
    }
  }

  function play(p) {
    if (run) finish();
    run = {
      center: p.center,
      radius: p.radius,
      start: p.start || 0,
      dur: p.dur || 2800,
      onAngle: p.onAngle,
      onDone: p.onDone,
      t0: 0,
    };
    raf = requestAnimationFrame(frame);
  }

  // 使用者拖地圖時也要跟著重畫（光束貼地）；rAF 本來就每格在畫，這裡只處理「剛好沒有下一格」的情況
  function stop(fin) {
    if (!run) return;
    if (fin) finish();
    else {
      run = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clear();
    }
  }

  return { play, stop, busy: () => !!run };
}
