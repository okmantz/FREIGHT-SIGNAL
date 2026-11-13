// "Install on this computer": Chrome / Edge can install the site as a desktop app (own window, Start-menu / Dock icon, works offline).
// The browser only offers this at certain moments, so the event is captured here as soon as the app loads.
let deferred = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { deferred = null; });
}
export const isInstalled = () => typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
export const canInstall = () => !!deferred;
/** true when the person accepted the browser's install prompt. */
export async function install() {
  if (!deferred) return false;
  const ev = deferred; deferred = null;
  ev.prompt();
  const r = await ev.userChoice.catch(() => ({ outcome: 'dismissed' }));
  return r.outcome === 'accepted';
}
