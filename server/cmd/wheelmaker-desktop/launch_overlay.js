// Desktop launch overlay, injected by the host at document-start on WheelMaker
// app pages (https). Plays the brand assemble + shine animation over the page
// while the app bundle loads, then fades out once the app mounts content into
// #root. The same visual language as the web launch layer: same mark, same
// sweep, so the handoff reads as one continuous animation.
(() => {
  try {
  if (window !== window.top || location.protocol !== 'https:') return;

  var OVERLAY_ID = 'wm-launch-overlay';
  var MIN_VISIBLE_MS = 780; // let the assemble intro finish before any handoff
  var FORCE_DISMISS_MS = 15000;
  var FADE_MS = 260;
  var startedAt = Date.now();
  var runAt = 0;

  var CSS = '#wm-launch-overlay{position:fixed;inset:0;z-index:2147483000;background:#0b1220;display:flex;align-items:center;justify-content:center;transition:opacity ' + FADE_MS + 'ms cubic-bezier(0.16,1,0.3,1);}' +
    '#wm-launch-overlay.out{opacity:0;pointer-events:none;}' +
    '#wm-launch-overlay .wmlo-mark{position:relative;display:flex;align-items:center;justify-content:center;}' +
    '#wm-launch-overlay .wmlo-logo{position:relative;display:block;}' +
    '#wm-launch-overlay .wmlo-glow{position:absolute;left:50%;top:50%;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(46,164,250,0.26),rgba(46,164,250,0) 65%);transform:translate(-50%,-50%);opacity:0.6;}' +
    // Animations only arm under .wmlo-run (applied on the first painted frame):
    // while the page is busy loading, the assembled mark stays statically
    // visible instead of sitting at the intro's opacity-0 from-state.
    '#wm-launch-overlay.wmlo-run .wmlo-glow{animation:wmlo-glow 900ms ease-out 550ms backwards;}' +
    '#wm-launch-overlay.wmlo-run .wmlo-piece-l{animation:wmlo-in-l 520ms cubic-bezier(0.34,1.4,0.64,1) 0ms backwards;}' +
    '#wm-launch-overlay.wmlo-run .wmlo-piece-r{animation:wmlo-in-r 520ms cubic-bezier(0.34,1.4,0.64,1) 90ms backwards;}' +
    '#wm-launch-overlay.wmlo-run .wmlo-piece-s{animation:wmlo-in-s 520ms cubic-bezier(0.34,1.4,0.64,1) 170ms backwards;}' +
    '@keyframes wmlo-in-l{from{opacity:0;transform:translateX(-170px);}}' +
    '@keyframes wmlo-in-r{from{opacity:0;transform:translateX(170px);}}' +
    '@keyframes wmlo-in-s{from{opacity:0;transform:translate(-95px,88px);}}' +
    '@keyframes wmlo-glow{from{opacity:0;}45%{opacity:1;}to{opacity:0.6;}}' +
    '#wm-launch-overlay .wmlo-shine{transform:translateX(-940px);}' +
    '#wm-launch-overlay.wmlo-run .wmlo-shine{animation:wmlo-sweep 2.1s cubic-bezier(0.4,0,0.2,1) 780ms infinite;}' +
    '@keyframes wmlo-sweep{0%{transform:translateX(-940px);}55%{transform:translateX(940px);}100%{transform:translateX(940px);}}' +
    '@media (prefers-reduced-motion: reduce){#wm-launch-overlay.wmlo-run .wmlo-piece-l,#wm-launch-overlay.wmlo-run .wmlo-piece-r,#wm-launch-overlay.wmlo-run .wmlo-piece-s,#wm-launch-overlay.wmlo-run .wmlo-glow,#wm-launch-overlay.wmlo-run .wmlo-shine{animation:none;}}';

  var LOGO =
    '<svg class="wmlo-logo" viewBox="160 292 927 600" width="96" height="62" aria-hidden="true">' +
    '<defs>' +
    '<linearGradient id="wmlo-gB" x1="557" y1="319" x2="197" y2="714" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#1380f1"/><stop offset="0.15" stop-color="#1c94f8"/><stop offset="0.33" stop-color="#1eb0fa"/><stop offset="0.5" stop-color="#23cffb"/><stop offset="0.65" stop-color="#2deafc"/><stop offset="0.85" stop-color="#32f0fd"/><stop offset="1" stop-color="#36f2fd"/>' +
    '</linearGradient>' +
    '<linearGradient id="wmlo-gO" x1="690" y1="865" x2="1000" y2="470" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#fb6402"/><stop offset="0.15" stop-color="#fc7802"/><stop offset="0.33" stop-color="#fd9c02"/><stop offset="0.5" stop-color="#fda801"/><stop offset="0.65" stop-color="#fdc001"/><stop offset="0.85" stop-color="#fdc801"/><stop offset="1" stop-color="#fed608"/>' +
    '</linearGradient>' +
    '<linearGradient id="wmlo-gW" x1="850" y1="320" x2="380" y2="860" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#f3fafe"/><stop offset="0.38" stop-color="#dbf0fc"/><stop offset="1" stop-color="#f0f9fe"/>' +
    '</linearGradient>' +
    '<linearGradient id="wmlo-sg" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>' +
    '</linearGradient>' +
    '<mask id="wmlo-mask" maskUnits="userSpaceOnUse" x="100" y="240" width="1080" height="720">' +
    '<path d="M427 822 L362 822 L197.3 633.2 Q170 593 196.9 550.3 L383 334 Q400 316 429 316 L554 316 Q570 316 564 344 L355 593 L461 714 L370 822 Z" fill="#ffffff"/>' +
    '<path d="M820 362 L885 362 L1049.7 550.8 Q1077 591 1050.1 633.7 L864 850 Q847 868 818 868 L693 868 Q677 868 683 840 L892 591 L786 470 L877 362 Z" fill="#ffffff"/>' +
    '<path d="M809 316 L923 316 L688 580 L436 868 L326 868 Z" fill="#ffffff"/>' +
    '</mask>' +
    '</defs>' +
    '<g class="wmlo-piece-l"><path d="M427 822 L362 822 L197.3 633.2 Q170 593 196.9 550.3 L383 334 Q400 316 429 316 L554 316 Q570 316 564 344 L355 593 L461 714 L370 822 Z" fill="url(#wmlo-gB)"/></g>' +
    '<g class="wmlo-piece-r"><path d="M820 362 L885 362 L1049.7 550.8 Q1077 591 1050.1 633.7 L864 850 Q847 868 818 868 L693 868 Q677 868 683 840 L892 591 L786 470 L877 362 Z" fill="url(#wmlo-gO)"/></g>' +
    '<g class="wmlo-piece-s"><path d="M809 316 L923 316 L688 580 L436 868 L326 868 Z" fill="url(#wmlo-gW)"/></g>' +
    '<g mask="url(#wmlo-mask)"><g class="wmlo-shine">' +
    '<rect x="513" y="42" width="220" height="1100" fill="url(#wmlo-sg)" transform="rotate(47.2 623 592)"/>' +
    '</g></g>' +
    '</svg>';

  function dismiss(overlay) {
    if (overlay.dataset.done) return;
    overlay.dataset.done = '1';
    var wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - (runAt || startedAt)));
    setTimeout(function () {
      overlay.classList.add('out');
      setTimeout(function () { overlay.remove(); }, FADE_MS + 60);
    }, wait);
  }

  function whenElement(selector, ready) {
    var found = document.querySelector(selector);
    if (found) return ready(found);
    var obs = new MutationObserver(function () {
      var el = document.querySelector(selector);
      if (el) {
        obs.disconnect();
        ready(el);
      }
    });
    // At document-start the root element may not exist yet; the document
    // itself is always a valid observation target.
    obs.observe(document.documentElement || document, {childList: true, subtree: true});
  }

  function inject() {
    if (document.getElementById(OVERLAY_ID)) return;
    // A reload driven by a service-worker update is not a fresh launch; the
    // app keeps its own launch layer for those, so only overlay once per tab.
    try {
      if (window.sessionStorage && sessionStorage.getItem('wm-launch-shown')) return;
      sessionStorage.setItem('wm-launch-shown', '1');
    } catch (e) {}
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = '<style>' + CSS + '</style><div class="wmlo-mark"><div class="wmlo-glow"></div>' + LOGO + '</div>';
    document.body.appendChild(overlay);
    // Arm the animations on the first painted frame; if rAF is starved by the
    // app bundle, fall back to a plain timer so the logo still comes alive.
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () {
        if (!runAt) {
          runAt = Date.now();
          overlay.classList.add('wmlo-run');
        }
      });
    }
    setTimeout(function () {
      if (!runAt) {
        runAt = Date.now();
        overlay.classList.add('wmlo-run');
      }
    }, 500);
    whenElement('#root', function (root) {
      if (root.childElementCount > 0) return dismiss(overlay);
      var obs = new MutationObserver(function () {
        if (root.childElementCount > 0) {
          obs.disconnect();
          dismiss(overlay);
        }
      });
      obs.observe(root, {childList: true});
    });
    setTimeout(function () { dismiss(overlay); }, FORCE_DISMISS_MS);
  }

  whenElement('body', inject);
  } catch (e) {
    // The overlay must never take down the host bridge init that shares this
    // document-start script.
  }
})();
