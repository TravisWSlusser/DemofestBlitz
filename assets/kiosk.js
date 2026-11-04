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
      "#kioskPrompt{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;" +
        "background:rgba(6,10,20,.88);backdrop-filter:blur(6px);font-family:VT323,monospace}" +
      "#kioskPrompt.show{display:flex}" +
      "#kioskPrompt .kp-card{position:relative;background:rgba(16,23,42,.96);border:1px solid #10CFC9;padding:34px 44px;text-align:center;" +
        "color:#dbe8f6;box-shadow:0 0 40px rgba(16,207,201,.3);max-width:92vw}" +
      "#kioskPrompt .kp-card::before{content:'';position:absolute;inset:0;pointer-events:none;" +
        "background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.1) 2px,rgba(0,0,0,.1) 4px)}" +
      "#kioskPrompt .kp-title{font-family:VT323,monospace;font-size:clamp(34px,4vw,54px);line-height:1;letter-spacing:.06em;color:#fff;margin-bottom:12px;text-shadow:0 0 18px rgba(16,207,201,.45)}" +
      "#kioskPrompt .kp-sub{font-family:'Share Tech Mono',monospace;font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;color:#10CFC9;margin-bottom:22px}" +
      "#kioskPrompt .kp-sub b{color:#FF2D9B;font-family:VT323,monospace;font-size:1.5rem;letter-spacing:0}" +
      "#kioskPrompt .kp-btn{font-family:'Share Tech Mono',monospace;font-weight:bold;font-size:.85rem;letter-spacing:.2em;text-transform:uppercase;" +
        "background:#10CFC9;color:#06222b;border:0;padding:13px 30px;cursor:pointer}" +
      "#kioskPrompt .kp-btn:hover{filter:brightness(1.15)}";
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
