(() => {
  "use strict";

  let framed = true;
  try {
    framed = window.top !== window.self;
  } catch (_error) {
    framed = true;
  }
  if (!framed) return;

  document.documentElement.hidden = true;
  document.documentElement.setAttribute("data-frame-blocked", "true");
  try { window.stop(); } catch (_error) { /* The document remains hidden if stopping is unavailable. */ }
})();
