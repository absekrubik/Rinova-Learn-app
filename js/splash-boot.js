// The opening splash now plays on every visit to the landing page; nothing to decide before first paint.
// (Kept as a tiny file so index.html does not change; ?splash=1 is still accepted and does nothing special.)
document.documentElement.classList.add('has-splash');
