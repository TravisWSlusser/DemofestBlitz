/* worldmap.js — the REC Room territory map, ported for the booth.
   Four PNG silhouettes (copied from the GSE repo) as CSS masks, all four lit,
   a breathing grid, a radar sweep, and the particle-burst engine. Bursts land
   on a lat/lon instead of a territory centroid.

   THE PROJECTION. The dot map is a stylised graphic, not a real projection:
   the Americas and Asia sit close to an equirectangular grid, Europe and
   Africa are drawn several degrees south of it. So a point is placed by a
   linear baseline plus an inverse-distance-weighted correction read off
   ~55 landmarks measured on the actual PNGs. Error is a few pixels at panel
   size. Add a landmark to CONTROL to tighten a region.

   API: WorldMap.mount(el) → map;  map.burst({trigram, score, lat, lon, color?});
        map.point(lat, lon) → {x, y} in panel pixels. */
(function () {
  const IMG_ASPECT = 4798 / 2471;
  const BASE = { a: 0.472, b: 0.002633, c: 0.596, d: 0.006563 };   // x = a + b·lon ; y = c − d·lat
  // [lat, lon, xFrac, yFrac] — where that place actually is on the PNGs
  const CONTROL = [
    [65,-165,.0375,.2145],[47.6,-122.3,.127,.331],[37.8,-122.4,.149,.360],[34,-118.2,.158,.395],[36.2,-115.1,.166,.385],
    [32.7,-117.2,.164,.439],[22.9,-109.9,.183,.494],[19.4,-99.1,.210,.529],[9,-79.5,.261,.571],[25,-81,.273,.516],
    [29.7,-95.4,.221,.451],[30,-90,.236,.458],[40.7,-74,.295,.375],[44.6,-63.6,.324,.343],[41.9,-87.6,.249,.382],
    [39.7,-105,.183,.394],[45,-93.3,.226,.331],[50,-97,.216,.318],[51,-114,.157,.312],[59,-85,.267,.290],
    [59.8,-43.9,.356,.251],[72,-40,.377,.127],[65,-18.5,.429,.225],[51.5,-0.1,.465,.320],[38.7,-9.1,.447,.412],
    [59.9,10.7,.535,.206],[41.9,12.5,.507,.409],[55.8,37.6,.605,.285],[30,31.2,.590,.510],[37,10,.50,.445],
    [-33.9,18.4,.52,.80],[-1.3,36.8,.570,.649],[11,51,.597,.597],[-19,47,.593,.717],[25.2,55.3,.648,.491],
    [19.1,72.9,.665,.533],[8,77.5,.675,.593],[1.3,103.8,.737,.665],[0.5,114,.774,.675],[-31.9,115.9,.763,.785],
    [-33.9,151.2,.859,.796],[-12.4,130.8,.808,.709],[-42,146.5,.845,.889],[-36.9,174.8,.918,.846],[35.7,139.7,.842,.356],
    [39.9,116.4,.791,.331],[22.3,114.2,.771,.432],[51,157,.894,.320],[66,170,.964,.216],[78.5,18,.528,.081],
    [-55.9,-67.3,.292,.963],[-8,-35,.377,.664],[-22.9,-43.2,.357,.735],[-12,-77,.276,.698],[4.6,-74.1,.272,.592],
    [-34.6,-58.4,.299,.844],[-33.4,-70.7,.283,.84],[21.3,-157.9,.062,.45]
  ];
  const baseline = (lat, lon) => ({ x: BASE.a + BASE.b * lon, y: BASE.c - BASE.d * lat });
  const OFFSETS = CONTROL.map(([lat, lon, x, y]) => { const b = baseline(lat, lon); return { lat, lon, dx: x - b.x, dy: y - b.y }; });
  function fracPoint(lat, lon) {
    const b = baseline(lat, lon);
    const k = Math.cos(lat * Math.PI / 180) || 0.01;
    let wsum = 0, dx = 0, dy = 0;
    // nearest 8 landmarks, weighted 1/d²
    const near = OFFSETS.map(o => {
      let dl = (o.lon - lon); if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
      const d2 = (o.lat - lat) ** 2 + (dl * k) ** 2;
      return { o, d2 };
    }).sort((p, q) => p.d2 - q.d2).slice(0, 8);
    for (const { o, d2 } of near) { const w = 1 / (d2 + 4); wsum += w; dx += w * o.dx; dy += w * o.dy; }
    // fade the correction out when nothing is within ~25°, so open ocean stays on the baseline
    const nearest = near.length ? Math.sqrt(near[0].d2) : 999;
    const fade = Math.max(0, Math.min(1, (40 - nearest) / 15));
    return { x: b.x + fade * dx / wsum, y: b.y + fade * dy / wsum };
  }
  // territory colour by rough region, matching the REC Room legend
  const COLORS = { nam: '#9B59FF', latam: '#FF2D9B', emea: '#FF6B35', apac: '#10CFC9' };
  function territoryOf(lat, lon) {
    if (lon < -30) return lat >= 12 && !(lon > -90 && lat < 24 && lon < -58) ? 'nam' : 'latam';   // Caribbean counts as LATAM
    if (lon < 60 && !(lat > 50 && lon > 40)) return 'emea';
    return 'apac';
  }

  const CSS = `
  .wm{position:relative;width:100%;aspect-ratio:${IMG_ASPECT};background:#10172A;border:1px solid rgba(16,207,201,.25);border-radius:10px;overflow:hidden}
  .wm-grid{position:absolute;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(16,207,201,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(16,207,201,.07) 1px,transparent 1px);background-size:18px 18px;-webkit-mask-image:radial-gradient(ellipse 72% 72% at center,#000 50%,transparent 100%);mask-image:radial-gradient(ellipse 72% 72% at center,#000 50%,transparent 100%);animation:wmBreathe 4.5s ease-in-out infinite}
  @keyframes wmBreathe{0%,100%{opacity:.5}50%{opacity:1}}
  .wm-sweep{position:absolute;left:50%;top:50%;width:135%;aspect-ratio:1/1;translate:-50% -50%;border-radius:50%;pointer-events:none;z-index:1;background:conic-gradient(rgba(16,207,201,.09),rgba(16,207,201,0) 16%,transparent 100%);animation:wmSpin 7s linear infinite;mix-blend-mode:screen}
  @keyframes wmSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  .wm-layer{position:absolute;inset:0;z-index:2;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain;opacity:.9}
  .wm-fx{position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;image-rendering:pixelated}
  .wm-bubble{position:absolute;background:rgba(13,20,36,.86);padding:4px 10px;z-index:6;pointer-events:none;opacity:0;transform:translate(-50%,-120%);border:1px solid var(--glow,#10CFC9);box-shadow:0 0 6px rgba(16,207,201,.18);white-space:nowrap}
  .wm-bubble.on{opacity:1;animation:wmIn .22s steps(4,end) both}
  .wm-bubble.off{opacity:0;animation:wmOut .2s steps(4,end) both}
  @keyframes wmIn{from{opacity:0}to{opacity:1}} @keyframes wmOut{from{opacity:1}to{opacity:0}}
  .wm-bl{font-family:'Share Tech Mono',monospace;font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;line-height:1.4}
  .wm-bs{font-family:VT323,monospace;font-size:2rem;color:#fff;line-height:1}
  .wm-bp{font-family:'Share Tech Mono',monospace;font-size:.52rem;letter-spacing:.08em;color:#9fb6d8}
  .wm-pin{position:absolute;z-index:4;width:8px;height:8px;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 2px rgba(255,255,255,.25),0 0 10px 2px var(--glow,#10CFC9);background:var(--glow,#10CFC9);animation:wmPulse 1.6s ease-in-out infinite}
  @keyframes wmPulse{0%,100%{opacity:.5}50%{opacity:1}}
  `;

  function mount(el, opts) {
    opts = opts || {};
    const assets = opts.assets || 'assets/map/';
    if (!document.getElementById('wm-css')) { const s = document.createElement('style'); s.id = 'wm-css'; s.textContent = CSS; document.head.appendChild(s); }
    el.classList.add('wm');
    el.innerHTML = '<div class="wm-grid"></div>' +
      ['latam', 'emea', 'apac', 'nam'].map(k => `<div class="wm-layer" style="background:${COLORS[k]};-webkit-mask-image:url('${assets}${k.toUpperCase()}_map.png');mask-image:url('${assets}${k.toUpperCase()}_map.png')"></div>`).join('') +
      '<div class="wm-sweep"></div><canvas class="wm-fx"></canvas>' +
      '<div class="wm-bubble"><div class="wm-bl"></div><div class="wm-bs"></div><div class="wm-bp"></div></div>';
    const canvas = el.querySelector('.wm-fx'), ctx = canvas.getContext('2d');
    const bubble = el.querySelector('.wm-bubble'), bl = el.querySelector('.wm-bl'), bs = el.querySelector('.wm-bs'), bp = el.querySelector('.wm-bp');
    let particles = [], raf = null, pin = null;

    function size() { const r = el.getBoundingClientRect(); if (r.width && (canvas.width !== Math.round(r.width) || canvas.height !== Math.round(r.height))) { canvas.width = Math.round(r.width); canvas.height = Math.round(r.height); } }
    function point(lat, lon) {
      size();
      const W = canvas.width, H = canvas.height, f = fracPoint(lat, lon);
      let dw, dh, ox, oy;
      if (W / H > IMG_ASPECT) { dh = H; dw = H * IMG_ASPECT; ox = (W - dw) / 2; oy = 0; } else { dw = W; dh = W / IMG_ASPECT; ox = 0; oy = (H - dh) / 2; }
      return { x: ox + f.x * dw, y: oy + f.y * dh };
    }
    function shade(hex, amt) {
      const n = parseInt(hex.slice(1), 16); const j = () => Math.round((Math.random() - 0.5) * amt);
      const c = v => Math.max(0, Math.min(255, v + j()));
      return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
    }
    function loop() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.vx *= 0.97; p.life -= p.decay;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
        ctx.fillRect(p.x | 0, p.y | 0, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      raf = particles.length ? requestAnimationFrame(loop) : null;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    function fire(x, y, base, n) {
      for (let i = 0; i < (n || 18); i++) {
        const a = Math.random() * Math.PI * 2, sp = 0.25 + Math.random() * 0.9;
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 0.012, decay: 0.03 + Math.random() * 0.02, life: 1, color: shade(base, 26), size: 2 + (Math.random() * 2 | 0) });
      }
      kick();
    }
    function dissolve(base) {
      const br = bubble.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      if (!br.width) return;
      const x0 = br.left - cr.left, y0 = br.top - cr.top;
      for (let yy = 0; yy < br.height; yy += 6) for (let xx = 0; xx < br.width; xx += 6) {
        if (Math.random() < 0.4) continue;
        particles.push({ x: x0 + xx, y: y0 + yy, vx: (Math.random() - 0.5) * 0.5, vy: -0.15 - Math.random() * 0.5, grav: 0.006, decay: 0.022 + Math.random() * 0.02, life: 1, color: Math.random() < 0.25 ? '#dffdfb' : base, size: 3 });
      }
      kick();
    }
    let bubbleT = null;
    function burst(o) {
      const has = Number.isFinite(o.lat) && Number.isFinite(o.lon);
      const lat = has ? o.lat : 36.2, lon = has ? o.lon : -115.1;   // unknown → the booth itself (Las Vegas)
      const color = o.color || COLORS[territoryOf(lat, lon)];
      const pt = point(lat, lon);
      clearTimeout(bubbleT);
      bubble.classList.remove('off');
      bubble.style.left = pt.x + 'px'; bubble.style.top = (pt.y - 6) + 'px'; bubble.style.setProperty('--glow', color);
      bl.textContent = (o.trigram || '???') + ' SCORED'; bl.style.color = color;
      bs.textContent = '+' + Number(o.score || 0).toLocaleString();
      bp.textContent = o.place || '';
      bubble.classList.add('on');
      fire(pt.x, pt.y, color, o.big ? 40 : 18);
      bubbleT = setTimeout(() => { dissolve(color); bubble.classList.remove('on'); bubble.classList.add('off'); }, 2600);
    }
    function setPin(lat, lon, color) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { if (pin) pin.remove(); pin = null; return; }
      if (!pin) { pin = document.createElement('div'); pin.className = 'wm-pin'; el.appendChild(pin); }
      const pt = point(lat, lon);
      pin.style.left = pt.x + 'px'; pin.style.top = pt.y + 'px'; pin.style.setProperty('--glow', color || COLORS[territoryOf(lat, lon)]);
    }
    window.addEventListener('resize', () => { size(); if (pin && pin._ll) setPin(pin._ll[0], pin._ll[1]); });
    size();
    return { point, burst, setPin: (lat, lon, c) => { setPin(lat, lon, c); if (pin) pin._ll = [lat, lon]; }, COLORS, territoryOf };
  }
  window.WorldMap = { mount, COLORS, territoryOf, fracPoint };
})();
