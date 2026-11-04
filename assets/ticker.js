/* ticker.js — the Demofest score ticker.
   One slim strip: the room high score on the left, then the most recent runs
   scrolling by (newest first), looping forever. Feeds from getScores every
   REFRESH ms; the strip is only rebuilt when the set of runs changes, so the
   scroll never stutters on a refresh. Usage: Ticker.mount(el, { api }). */
(function (global) {
  'use strict';
  const SPEED_PX_S = 70;          // scroll speed
  const REFRESH_MS = 15000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const firstName = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0] || ''; };
  const ago = at => {
    const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };

  function mount(el, opts) {
    const api = (opts && opts.api) || '/api/blitz/';
    el.classList.add('ticker');
    el.innerHTML = '<div class="tk-lead"><span class="tk-k">High score</span><b class="tk-high">—</b></div>' +
                   '<div class="tk-win"><div class="tk-track"></div></div>';
    const high = el.querySelector('.tk-high'), win = el.querySelector('.tk-win'), track = el.querySelector('.tk-track');
    let key = '', runs = [], roomHigh = 0, timer = null;

    function item(r) {
      const top = roomHigh && r.score === roomHigh;
      return '<span class="tk-item' + (top ? ' top' : '') + '" data-at="' + esc(r.at) + '">' +
             (top ? '<span class="tk-star">★</span>' : '') +
             '<span class="tk-tri">' + esc(r.trigram) + '</span>' +
             '<span class="tk-nm">' + esc(firstName(r.name)) + '</span>' +
             '<span class="tk-sc">' + (Number(r.score) || 0).toLocaleString() + '</span>' +
             '<span class="tk-ago">' + ago(r.at) + '</span></span>';
    }
    function build() {
      const w = win.clientWidth || 800;
      let group = runs.length ? runs.map(item).join('') : '<span class="tk-item empty">No runs yet · be the first on the board</span>';
      // enough copies that one group is at least as wide as the window, then double it for a seamless loop
      track.style.animation = 'none';
      track.innerHTML = '<span class="tk-group">' + group + '</span>';
      const g = track.firstChild; let gw = g.offsetWidth || 1;
      let copies = 1;
      while (gw * copies < w && copies < 12) copies++;
      const groupHtml = Array(copies).fill(g.outerHTML).join('');
      track.innerHTML = groupHtml + groupHtml;
      const half = track.scrollWidth / 2;
      track.style.animation = '';                  // back to the stylesheet animation…
      track.style.animationDuration = Math.max(8, half / SPEED_PX_S) + 's';   // …at a constant speed whatever the width
    }
    function tickAgo() { track.querySelectorAll('.tk-item[data-at]').forEach(n => { const a = n.querySelector('.tk-ago'); if (a) a.textContent = ago(n.getAttribute('data-at')); }); }
    async function refresh() {
      try {
        const r = await fetch(api + 'getScores');
        if (!r.ok) throw new Error(r.status);
        const d = await r.json();
        roomHigh = Number(d.high) || 0;
        high.textContent = roomHigh ? roomHigh.toLocaleString() : '—';
        const list = Array.isArray(d.recent) ? d.recent : [];
        const k = roomHigh + '|' + list.map(x => x.id).join(',');
        if (k !== key) { key = k; runs = list; build(); } else tickAgo();
      } catch (_) { /* keep the last good strip */ }
    }
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
    let rs = null; window.addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(build, 250); });
    return { refresh, stop: () => clearInterval(timer) };
  }
  global.Ticker = { mount };
})(window);
