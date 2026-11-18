// Runs before the page paints (tiny, no dependencies). Skip the splash if it was already shown in this browser session.
// Open the site with ?splash=1 to force it to play again (ignores the once-per-session rule and the reduced-motion setting).
const root = document.documentElement;
try {
  if (/[?&]splash=1\b/.test(location.search)) { root.classList.add('force-splash'); sessionStorage.removeItem('rl-splash'); }
  else if (sessionStorage.getItem('rl-splash')) root.classList.add('no-splash');
} catch { /* storage blocked: the splash simply shows */ }
