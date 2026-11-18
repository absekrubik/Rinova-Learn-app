// Opening splash: once per browser session. The animation and its own exit are pure CSS; this only handles skipping and cleanup.
const KEY = 'rl-splash';

export function initSplash() {
  const el = document.getElementById('splash'); if (!el) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let seen = false; try { seen = !!sessionStorage.getItem(KEY); } catch { /* ignore */ }
  const force = document.documentElement.classList.contains('force-splash');
  if (!force && (seen || reduced)) { el.remove(); return; }
  try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
  document.documentElement.style.overflow = 'hidden';               // no scrolling behind it
  let done = false;
  const finish = () => { if (done) return; done = true; document.documentElement.style.overflow = ''; el.remove(); document.removeEventListener('keydown', onKey); };
  const leave = () => { if (done || el.classList.contains('is-leaving')) return; el.classList.add('is-leaving'); setTimeout(finish, 480); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') leave(); };
  el.addEventListener('click', leave);
  el.querySelector('.splash-skip')?.addEventListener('click', (e) => { e.stopPropagation(); leave(); });
  document.addEventListener('keydown', onKey);
  el.addEventListener('animationend', (e) => { if (e.animationName === 'splash-out') finish(); });
  setTimeout(finish, 4000);                                          // safety net
}
