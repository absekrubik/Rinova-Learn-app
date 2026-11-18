// Tiny classic script that runs before first paint. It covers the page in brand blue straight away so there is no flash of the page
// before the splash appears, unless the splash is being skipped (right after the sign-in welcome, which is its own animation).
const root = document.documentElement;
try { if (sessionStorage.getItem('rl-skip-splash')) { sessionStorage.removeItem('rl-skip-splash'); root.classList.add('no-splash'); } } catch { /* storage blocked */ }
if (!root.classList.contains('no-splash')) root.classList.add('has-splash');
