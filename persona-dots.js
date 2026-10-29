/*!
 * Persona Dots player v2
 * Renders the baked persona point clouds and morphs between them. No dependencies.
 *
 * Usage:
 *   <div class="persona-dots" data-src="https://…/personas.bin.gz"></div>
 *   <script src="https://…/persona-dots.min.js" defer><\/script>
 *
 * Optional attributes on the element (defaults come from the exported file):
 *   data-color="#9152ff"  data-hold="4"  data-transition="2.5"  data-drift="18"  data-follow="true"
 *   data-start="0"  (index of the first model)
 *
 * The element is sized by your layout (e.g. width:100%; aspect-ratio:1). The canvas fills it and
 * everything scales with its size. The background is transparent: style the element itself.
 * JS API: PersonaDots.mount(el, {src | data: ArrayBuffer, color, hold, transition, drift, follow, start}) → {destroy()}
 *
 * Syncing text (v2):
 *   <div data-persona-sync>                      ← optional value: a selector for the visual, e.g. "#hero-dots"
 *     <div data-persona-item>quote for model 0</div>
 *     <div data-persona-item>quote for model 1</div> …
 *   </div>
 *   Items are matched to models by order. The current one gets the class "is-active"; the rest get aria-hidden.
 *   Events on the visual (they bubble): "persona:leave" {from, to} as the dots start moving,
 *   "persona:change" {index, label} as the new figure settles (and once on load).
 */
(function () {
  'use strict';

  // ---- file format -------------------------------------------------------------------------
  // gzip( 'PDOT' | u32 version | u32 jsonLength | json header | binary sections ), little-endian.
  async function gunzip(buf) {
    const u = new Uint8Array(buf);
    if (u[0] !== 0x1f || u[1] !== 0x8b) return buf; // already decompressed (e.g. by the server)
    return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  function parse(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x544f4450) throw new Error('PersonaDots: not a personas file');
    const jl = dv.getUint32(8, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jl))), base = 12 + jl;
    const models = H.models.map(m => {
      const p = new Int16Array(buf, base + m.pos, m.n * 3), s = new Uint8Array(buf, base + m.size, m.n);
      const pos = new Float32Array(m.n * 3), size = new Float32Array(m.n);
      for (let i = 0; i < pos.length; i++) pos[i] = p[i] * H.posScale;
      for (let i = 0; i < m.n; i++) size[i] = s[i] * H.sizeScale;
      return { label: m.label, n: m.n, pos, size, vt: new Uint8Array(buf, base + m.vt, m.n * H.ny) };
    });
    const pairs = {};
    H.pairs.forEach(q => {
      pairs[q.a + '>' + q.b] = { n: q.n, ia: new Uint16Array(buf, base + q.ia, q.n), ib: new Uint16Array(buf, base + q.ib, q.n), fl: new Uint8Array(buf, base + q.flags, q.n) };
    });
    return { H, models, pairs };
  }
  const cache = {};
  function load(src) {
    return cache[src] || (cache[src] = fetch(src)
      .then(r => { if (!r.ok) throw new Error('PersonaDots: ' + r.status + ' ' + src); return r.arrayBuffer(); })
      .then(gunzip).then(parse));
  }

  // ---- helpers -----------------------------------------------------------------------------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const hash = i => { let t = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); t ^= t >>> 13; t = Math.imul(t, 0xc2b2ae35); t ^= t >>> 16; return (t >>> 0) / 4294967296; };
  const rgb = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const F = 1 / Math.tan(12 * Math.PI / 180); // 24° vertical field of view; camera at z = 2.4 looking at the origin
  const VS = 'attribute vec2 a_pos;attribute float a_size;uniform float u_px;varying float v_aa;varying float v_r;' +
    'void main(){gl_Position=vec4(a_pos.x*2.0-1.0,1.0-a_pos.y*2.0,0.0,1.0);float s=max(0.6,a_size*u_px);gl_PointSize=s+1.0;v_r=0.5*s/(s+1.0);v_aa=0.5/(s+1.0);}';
  const FS = 'precision mediump float;uniform vec3 u_col;varying float v_aa;varying float v_r;' +
    'void main(){float d=length(gl_PointCoord-0.5);if(d>0.5)discard;float a=smoothstep(v_r+v_aa,v_r-v_aa,d);gl_FragColor=vec4(u_col*a,a);}';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mx = 0, my = 0, listening = false;
  function listen() {
    if (listening) return; listening = true;
    addEventListener('pointermove', e => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; }, { passive: true });
  }

  // ---- one instance ------------------------------------------------------------------------
  function mount(el, opts = {}) {
    const ds = el.dataset, num = (a, b) => +(a ?? b ?? NaN);
    const o = {
      src: opts.src || ds.src, data: opts.data, color: opts.color || ds.color,
      hold: num(opts.hold, ds.hold), trans: num(opts.transition, ds.transition), drift: num(opts.drift, ds.drift),
      follow: opts.follow ?? (ds.follow != null ? ds.follow !== 'false' : undefined), start: num(opts.start, ds.start) || 0
    };
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
    el.appendChild(cv);
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return { destroy() { cv.remove(); } };
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    const lp = gl.getAttribLocation(prog, 'a_pos'), ls = gl.getAttribLocation(prog, 'a_size');
    gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(ls); gl.vertexAttribPointer(ls, 1, gl.FLOAT, false, 12, 8);
    const uPx = gl.getUniformLocation(prog, 'u_px'), uCol = gl.getUniformLocation(prog, 'u_col');

    let D = null, buf = null, R = null, cur = 0, next = 1, tl = 0, left = false, arrived = false, clock = 0, cx = 0, cy = 0, last = null, raf = 0, onscreen = false, dead = false;
    const size = () => {
      const r = Math.min(2, devicePixelRatio || 1), w = Math.max(2, Math.round(el.clientWidth * r)), h = Math.max(2, Math.round(el.clientHeight * r));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    };
    const ro = new ResizeObserver(() => { size(); if (D && !raf) frame(performance.now()); }); ro.observe(el);
    const io = new IntersectionObserver(es => { onscreen = es[0].isIntersecting; if (onscreen) start(); }, { rootMargin: '100px' }); io.observe(el);
    const vis = () => start();
    document.addEventListener('visibilitychange', vis);
    // (re)start after a pause; the time gap while paused is skipped
    function start() { if (D && !raf && !dead && onscreen && !document.hidden && !reduce) { last = null; raf = requestAnimationFrame(frame); } }

    function emit(name, detail) { el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true })); }

    function draw(count) {
      // the figure is framed in a square: on a non-square element it stays centred, sized by the shorter side
      const w = cv.width, h = cv.height, side = Math.min(w, h);
      gl.viewport((w - side) / 2, (h - side) / 2, side, side);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!count) return;
      const c = rgb(o.color); gl.uniform3f(uCol, c[0], c[1], c[2]);
      gl.uniform1f(uPx, side / 600); // dot sizes are in 1/600ths of the square's width
      gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, count * 3), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, count);
    }

    function frame(now) {
      raf = 0; now /= 1000;
      const dt = last === null ? 0 : Math.min(0.1, now - last); last = now;
      const H = D.H, M = D.models, NY = H.ny;
      // timeline: hold each model, then morph to the next
      let T = 0;
      if (!reduce && M.length > 1) {
        clock += dt; tl += dt;
        T = tl < o.hold ? 0 : clamp((tl - o.hold) / o.trans);
        // text cues: the old line leaves as the dots start moving, the new one arrives as the figure settles
        if (T > 0 && !left) { left = true; emit('persona:leave', { from: cur, to: next }); }
        if (T >= 0.75 && !arrived) { arrived = true; emit('persona:change', { index: next, label: M[next].label }); }
        if (tl >= o.hold + o.trans) { tl = 0; T = 0; cur = next; next = (cur + 1) % M.length; left = arrived = false; }
      }
      const f = o.follow && !reduce ? 1 : 0, e = 1 - Math.pow(0.88, dt * 24);
      cx += (mx * f - cx) * e; cy += (my * f - cy) * e;
      const ry = (reduce ? 0 : Math.sin(clock * 0.35) * o.drift * Math.PI / 180) + cx * 0.28, rx = cy * 0.08;
      const sY = Math.sin(ry), cY = Math.cos(ry), sX = Math.sin(rx), cX = Math.cos(rx);
      // visibility is a lookup into the per-angle table baked for each dot
      const fy = clamp((ry * 180 / Math.PI - H.yawMin) / (H.yawMax - H.yawMin)) * (NY - 1), y0 = Math.min(NY - 2, Math.floor(fy)), yf = fy - y0;
      const A = M[cur], B = M[next], P = D.pairs[cur + '>' + next];
      const AL = A.pos, BL = B.pos, AV = A.vt, BV = B.vt, AS = A.size, BS = B.size;
      let cnt = 0;
      for (let i = 0; i < P.n; i++) {
        const a = P.ia[i], b = P.ib[i], fl = P.fl[i], a3 = a * 3, b3 = b * 3, ri = i * 4;
        // staggered top-down, eased
        let t = 0; if (T > 0) { const d = 0.25 * clamp(0.5 - AL[a3 + 1]) + 0.15 * R[ri]; t = ease(clamp((T - d) / 0.6)); }
        let sA = 0, sB = 0;
        if (t < 1 && !(fl & 1)) { const q = a * NY + y0; sA = AS[a] * (AV[q] + (AV[q + 1] - AV[q]) * yf) / 255; }
        if (t > 0 && !(fl & 2)) { const q = b * NY + y0; sB = BS[b] * (BV[q] + (BV[q + 1] - BV[q]) * yf) / 255; }
        const s = sA + (sB - sA) * t; if (s < 0.3) continue;
        let x = AL[a3] + (BL[b3] - AL[a3]) * t, y = AL[a3 + 1] + (BL[b3 + 1] - AL[a3 + 1]) * t, z = AL[a3 + 2] + (BL[b3 + 2] - AL[a3 + 2]) * t;
        if (t > 0 && t < 1) { const arc = Math.sin(Math.PI * t) * (0.02 + 0.06 * R[ri + 1]); x += arc * (R[ri + 2] - 0.5) * 1.2; y += arc * (R[ri + 3] - 0.5) * 0.6; z += arc; }
        // rotate (yaw, then pitch), move into camera space, project
        const x1 = cY * x + sY * z, z1 = -sY * x + cY * z;
        const y2 = cX * y - sX * z1, z2 = sX * y + cX * z1;
        const dz = 2.4 - z2, px = F * x1 / dz, py = F * (y2 - 0.01) / dz;
        const k = cnt * 3; buf[k] = 0.05 + 0.9 * (px * 0.5 + 0.5); buf[k + 1] = 0.1 + 0.9 * (0.5 - py * 0.5); buf[k + 2] = s; cnt++;
      }
      draw(cnt);
      if (!dead && onscreen && !document.hidden && !reduce) raf = requestAnimationFrame(frame);
    }

    (o.data ? Promise.resolve(o.data).then(gunzip).then(parse) : load(o.src)).then(d => {
      if (dead) return;
      D = d; const df = d.H.defaults;
      o.color = o.color || df.color;
      if (isNaN(o.hold)) o.hold = df.hold; if (isNaN(o.trans)) o.trans = df.trans; if (isNaN(o.drift)) o.drift = df.drift;
      if (o.follow == null) o.follow = df.follow;
      let maxN = 0; for (const k in d.pairs) maxN = Math.max(maxN, d.pairs[k].n);
      buf = new Float32Array(maxN * 3); R = new Float32Array(maxN * 4); for (let i = 0; i < R.length; i++) R[i] = hash(i + 1);
      const L = d.models.length; cur = (((o.start | 0) % L) + L) % L; next = (cur + 1) % L;
      if (o.follow) listen();
      emit('persona:change', { index: cur, label: d.models[cur].label });
      size(); frame(performance.now());
    }).catch(err => console.error(err));

    return { destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis); cv.remove(); } };
  }

  // ---- text sync ---------------------------------------------------------------------------
  function sync(box) {
    if (box.__pds) return; box.__pds = true;
    const target = box.dataset.personaSync ? document.querySelector(box.dataset.personaSync) : document.querySelector('.persona-dots,[data-persona-dots]');
    if (!target) return;
    const items = () => box.querySelectorAll('[data-persona-item]');
    const show = i => { const L = items(); L.forEach((it, k) => { const on = i != null && k === i % L.length; it.classList.toggle('is-active', on); it.setAttribute('aria-hidden', on ? 'false' : 'true'); }); };
    show(+(target.dataset.start || 0) || 0); // visible straight away, before the data has loaded
    target.addEventListener('persona:leave', () => show(null));
    target.addEventListener('persona:change', e => show(e.detail.index));
  }

  function auto() {
    document.querySelectorAll('[data-persona-sync]').forEach(sync);
    document.querySelectorAll('.persona-dots[data-src],[data-persona-dots][data-src]').forEach(el => { if (!el.__pd) el.__pd = mount(el); });
  }
  window.PersonaDots = { mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
