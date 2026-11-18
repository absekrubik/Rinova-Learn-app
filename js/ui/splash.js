// Opening splash: plays on every visit. The animation and its own exit are pure CSS; this only handles skipping and cleanup.
export function initSplash() {
  const el = document.getElementById('splash'); if (!el) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.style.overflow = 'hidden';               // no scrolling behind it
  let done = false;
  const finish = () => { if (done) return; done = true; document.documentElement.style.overflow = ''; el.remove(); document.removeEventListener('keydown', onKey); };
  const leave = () => { if (done || el.classList.contains('is-leaving')) return; el.classList.add('is-leaving'); setTimeout(finish, 480); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') leave(); };
  el.addEventListener('click', leave);
  el.querySelector('.splash-skip')?.addEventListener('click', (e) => { e.stopPropagation(); leave(); });
  document.addEventListener('keydown', onKey);
  el.addEventListener('animationend', (e) => { if (e.animationName === 'splash-out') finish(); });
  setTimeout(reduced ? leave : finish, reduced ? 1500 : 4000);     // calm devices get a still version for 1.5 s; safety net otherwise
}
