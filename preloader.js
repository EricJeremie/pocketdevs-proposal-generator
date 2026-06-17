/* ============================================================
   PocketDevs — site-wide preloader
   The #preloader overlay is inlined in each page's <body> so it shows
   instantly. This script fades it out once the page has fully loaded, then
   removes it from the DOM. A safety timeout guarantees it never gets stuck if
   a resource hangs.
   ============================================================ */
(function () {
  'use strict';
  function hide() {
    var el = document.getElementById('preloader');
    if (!el || el.classList.contains('preloader--hidden')) return;
    el.classList.add('preloader--hidden');
    var remove = function () { if (el && el.parentNode) el.parentNode.removeChild(el); };
    el.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 800); // fallback if transitionend doesn't fire
  }

  if (document.readyState === 'complete') hide();
  else window.addEventListener('load', hide);

  setTimeout(hide, 6000); // safety: never let the preloader stick
})();
