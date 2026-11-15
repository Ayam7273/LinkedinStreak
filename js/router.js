// Hash router: #/today, #/goals, #/history, #/settings, #/log (a sheet over Today), #/onboarding.

export const TABS = [
  { route: 'today', label: 'Today', icon: 'today' },
  { route: 'goals', label: 'Goals', icon: 'goals' },
  { route: 'history', label: 'History', icon: 'history' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

const ROUTES = new Set(['today', 'goals', 'history', 'settings', 'log', 'onboarding']);

export function current() {
  const m = /^#\/([a-z-]+)/.exec(location.hash);
  const r = m ? m[1] : 'today';
  return ROUTES.has(r) ? r : 'today';
}

export function navigate(route, { replace = false } = {}) {
  const hash = `#/${route}`;
  if (location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if (replace) {
    history.replaceState(history.state, '', `${location.pathname}${hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

export function onRoute(fn) {
  const handler = () => fn(current());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

/** Link shared to the app (Android share target): ?url=… or ?text=… */
export function sharedParams() {
  const q = new URLSearchParams(location.search);
  const raw = q.get('url') || q.get('text') || q.get('title') || '';
  return raw.trim() || null;
}

/** Drop the query string so a reload doesn't reopen the share. */
export function clearSharedParams(route = 'log') {
  history.replaceState(history.state, '', `${location.pathname}#/${route}`);
}
