// Runs before the page paints (tiny, no dependencies): skip the splash if it was already shown in this browser session.
try { if (sessionStorage.getItem('rl-splash')) document.documentElement.classList.add('no-splash'); } catch { /* storage blocked: the splash simply shows */ }
