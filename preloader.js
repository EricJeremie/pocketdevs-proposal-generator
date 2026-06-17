/* ============================================================
   PocketDevs — site-wide preloader
   Shows on every page load. Enforces a minimum 2-second display
   so the branded animation always plays, even on fast connections.
   ============================================================ */
(function () {
  'use strict';
  var MIN_MS = 2000;
  var startTime = Date.now();

  function hide() {
    var el = document.getElementById('preloader');
    if (!el || el.classList.contains('preloader--hidden')) return;
    var elapsed = Date.now() - startTime;
    var wait = Math.max(0, MIN_MS - elapsed);
    setTimeout(function () {
      el.classList.add('preloader--hidden');
      var remove = function () { if (el && el.parentNode) el.parentNode.removeChild(el); };
      el.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 800);
    }, wait);
  }

  if (document.readyState === 'complete') hide();
  else window.addEventListener('load', hide);

  setTimeout(hide, 10000); // safety: never let the preloader stick
})();
