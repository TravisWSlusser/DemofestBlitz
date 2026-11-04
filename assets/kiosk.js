/* kiosk.js — the booth idle watchdog.
   After `idleMs` with no input, shows "Still playing?" with a `promptMs`
   countdown. Any input anywhere (including inside a same-origin iframe
   registered with Kiosk.watch) dismisses it. If the countdown runs out,
   `onTimeout` fires — by default, back to the home page.

   Both numbers are the two constants at the top of the page that calls
   Kiosk.start(); tune them there, not here. */
(function () {
  const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'click'];
  let idleMs = 20000, promptMs = 10000, onTimeout = () => { location.href = 'index.html'; };
  let idleTimer = null, countTimer = null, remaining = 0, overlay = null, numEl = null, armed = false;

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'kioskPrompt';
    overlay.innerHTML =
      '<div class="kp-card" role="alertdialog" aria-live="assertive">' +
        '<div class="kp-title">Still playing?</div>' +
        '<div class="kp-sub">Heading back to the start screen in <b id="kpNum">10</b>s</div>' +
        '<button type="button" class="kp-btn" id="kpYes">Yes, I’m still here</button>' +
      '</div>';
    document.body.appendChild(overlay);
    numEl = overlay.querySelector('#kpNum');
    overlay.querySelector('#kpYes').addEventListener('click', activity);
    const css = document.createElement('style');
    css.textContent =
      '#kioskPrompt{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;' +
        'background:rgba(6,16,28,.82);backdrop-filter:blur(6px);font-family:Inter,system-ui,sans-serif}' +
      '#kioskPrompt.show{display:flex}' +
      '#kioskPrompt .kp-card{background:#0E2742;border:2px solid #10CFC9;border-radius:14px;padding:34px 40px;text-align:center;' +
        'color:#E7EBEF;box-shadow:0 20px 60px rgba(0,0,0,.6);max-width:92vw}' +
      '#kioskPrompt .kp-title{font-family:"Press Start 2P",monospace;font-size:clamp(18px,3vw,30px);color:#10CFC9;margin-bottom:16px;line-height:1.4}' +
      '#kioskPrompt .kp-sub{font-size:1.1rem;color:#9AA6B2;margin-bottom:22px}' +
      '#kioskPrompt .kp-sub b{color:#FF2D9B;font-size:1.4rem}' +
      '#kioskPrompt .kp-btn{font:700 1.05rem Inter,system-ui,sans-serif;background:#10CFC9;color:#06101C;border:0;border-radius:10px;' +
        'padding:14px 28px;cursor:pointer}' +
      '#kioskPrompt .kp-btn:hover{filter:brightness(1.1)}';
    document.head.appendChild(css);
  }

  function showPrompt() {
    if (!overlay) buildOverlay();
    remaining = Math.ceil(promptMs / 1000);
    numEl.textContent = remaining;
    overlay.classList.add('show');
    clearInterval(countTimer);
    countTimer = setInterval(() => {
      remaining -= 1;
      numEl.textContent = Math.max(0, remaining);
      if (remaining <= 0) { clearInterval(countTimer); stop(); onTimeout(); }
    }, 1000);
  }
  function hidePrompt() {
    clearInterval(countTimer);
    if (overlay) overlay.classList.remove('show');
  }
  function arm() {
    clearTimeout(idleTimer);
    if (!armed) return;
    idleTimer = setTimeout(showPrompt, idleMs);
  }
  function activity() { hidePrompt(); arm(); }

  function listen(target) {
    EVENTS.forEach(ev => { try { target.addEventListener(ev, activity, { passive: true, capture: true }); } catch (e) {} });
  }

  function start(opts) {
    opts = opts || {};
    if (opts.idleMs) idleMs = opts.idleMs;
    if (opts.promptMs) promptMs = opts.promptMs;
    if (opts.onTimeout) onTimeout = opts.onTimeout;
    armed = true;
    listen(document);
    arm();
  }
  function stop() { armed = false; clearTimeout(idleTimer); hidePrompt(); }
  /* Register a same-origin iframe so play inside it counts as activity.
     Call after the frame's `load` event; safe to call again on every load. */
  function watch(iframe) {
    try {
      const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (doc) listen(doc);
    } catch (e) { /* cross-origin: nothing to attach to */ }
  }

  window.Kiosk = { start, stop, watch, poke: activity };
})();
