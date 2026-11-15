// App shell entry (/app.html): auth guard, shell, routing, offline banner, service worker.
import { supabase, requireSession, authHashInfo, stashSharedLink, takeSharedLink, onAuthChange, signOut } from './supabase.js';
import { getState, subscribe, set, load, refresh, activeGoal } from './state.js';
import { TABS, current, navigate, onRoute, sharedParams, clearSharedParams } from './router.js';
import { extractUrl } from './core/linkedin.js';
import { icon } from './ui/icons.js';
import { brand, logo } from './ui/logo.js';
import { esc, initial } from './ui/dom.js';
import { toast } from './ui/toast.js';
import { closeSheet, isSheetOpen } from './ui/sheet.js';
import { resyncPush } from './push.js';
import * as today from './views/today.js';
import * as goals from './views/goals.js';
import * as history from './views/history.js';
import * as settings from './views/settings.js';
import * as onboarding from './views/onboarding.js';
import { openLog } from './views/log.js';

const VIEWS = { today, goals, history, settings, onboarding };
const LIVE = new Set(['today', 'goals', 'history']); // re-render on data changes
const app = document.getElementById('app');
let main;
let shown = null;

// Capture the install prompt early (Chrome/Edge/Android).
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
});

boot();

async function boot() {
  // A shared link arrives as ?url= / ?text=. Keep it through sign-in.
  const shared = sharedParams();
  if (shared) stashSharedLink(extractUrl(shared) || shared);

  const hashInfo = authHashInfo();
  try {
    await supabase(); // parses #access_token=… if present
  } catch (err) {
    return fatal(err.message);
  }
  if (hashInfo?.error) {
    location.replace(`/login.html#error=${encodeURIComponent(hashInfo.error)}`);
    return;
  }
  const session = await requireSession();
  if (!session) return;
  if (hashInfo || shared) clearSharedParams('today');

  onAuthChange((event) => {
    if (event === 'SIGNED_OUT') location.replace('/login.html');
  });

  await load();
  const s = getState();
  if (s.status === 'error') return fatal(s.error);

  shell();
  subscribe(onStore);
  onRoute(route);
  wireOnline();
  registerSW();
  resyncPush();

  const pending = takeSharedLink();
  if (!s.profile?.onboarded_at) {
    if (pending) stashSharedLink(pending); // keep it until onboarding is done
    navigate('onboarding', { replace: true });
  } else if (pending) {
    navigate('today', { replace: true });
    openLog({ prefill: pending, onClose: () => navigate('today', { replace: true }) });
  } else {
    route(current());
  }

  // Keep data fresh when the app comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isSheetOpen()) refresh();
  });
}

function fatal(message) {
  app.innerHTML = `
    <div class="center-page">
      <div class="card auth-card stack">
        ${logo({ size: 'lg' })}
        <h1>Something went wrong</h1>
        <p class="muted">${esc(message || 'Could not load LinkedInStreak.')}</p>
        <div class="row">
          <button type="button" class="btn btn--primary" data-retry>Try again</button>
          <button type="button" class="btn" data-out>Sign out</button>
        </div>
      </div>
    </div>`;
  app.querySelector('[data-retry]').addEventListener('click', () => location.reload());
  app.querySelector('[data-out]').addEventListener('click', async () => {
    await signOut().catch(() => null);
    location.replace('/login.html');
  });
}

function navLinks(cls, r) {
  return TABS.map(
    (t) => `<a class="${cls}" href="#/${t.route}" ${t.route === r ? 'aria-current="page"' : ''} data-route="${t.route}">${icon(t.icon, { size: cls === 'tab' ? 'lg' : '' })}<span>${t.label}</span></a>`,
  ).join('');
}

function shell() {
  const s = getState();
  app.innerHTML = `
    <div class="banner" data-offline hidden role="status">${icon('wifiOff', { size: 'sm', cls: 'inline' })} You're offline. Changes will need a connection.</div>
    <div class="app">
      <header class="appbar">
        ${brand()}
        <div class="menu-wrap">
          <button type="button" class="avatar-btn" data-avatar aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">
            <span class="avatar" aria-hidden="true">${initial(s.profile, s.user)}</span>
          </button>
          <div class="menu" role="menu" data-menu hidden>
            <p class="menu__head">${esc(s.user?.email || '')}</p>
            <a class="menu__item" role="menuitem" href="#/settings">${icon('settings')}Settings</a>
            <button type="button" class="menu__item menu__item--danger" role="menuitem" data-signout>${icon('logout')}Sign out</button>
          </div>
        </div>
      </header>
      <aside class="sidebar" aria-label="Main">
        ${brand()}
        <nav class="nav" aria-label="Main" data-side>${navLinks('nav-item', current())}</nav>
        <div class="sidebar__goal" data-sidegoal></div>
      </aside>
      <main class="main" id="main" tabindex="-1"></main>
      <nav class="tabbar" aria-label="Main">
        <div class="tabbar__list" data-tabs>${navLinks('tab', current())}</div>
      </nav>
    </div>`;
  main = app.querySelector('#main');

  const btn = app.querySelector('[data-avatar]');
  const menu = app.querySelector('[data-menu]');
  const closeMenu = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.menu__item')?.focus();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.menu-wrap')) closeMenu();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      btn.focus();
    }
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('.menu__item')) closeMenu();
  });
  app.querySelector('[data-signout]').addEventListener('click', async () => {
    await signOut();
    location.replace('/login.html');
  });
  sideGoal();
}

function sideGoal() {
  const el = app.querySelector('[data-sidegoal]');
  if (!el) return;
  const g = activeGoal();
  el.innerHTML = g ? `<span class="faint">Active goal</span><strong>${esc(g.name)}</strong>` : '<span class="faint">No active goal</span>';
}

function markNav(r) {
  app.querySelectorAll('[data-route]').forEach((a) => {
    if (a.dataset.route === r) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const hide = r === 'onboarding';
  app.querySelector('.tabbar').hidden = hide;
  app.querySelector('[data-side]').hidden = hide;
  app.querySelector('[data-sidegoal]').hidden = hide;
}

const TITLES = { today: 'Today', goals: 'Goals', history: 'History', settings: 'Settings', onboarding: 'Welcome', log: 'Log a post' };

function route(r) {
  const s = getState();
  if (!s.profile?.onboarded_at && r !== 'onboarding') r = 'onboarding';
  if (s.profile?.onboarded_at && r === 'onboarding') r = 'today';

  if (r === 'log') {
    if (shown !== 'today') show('today');
    if (!isSheetOpen()) openLog({ onClose: () => navigate('today', { replace: true }) });
    document.title = `${TITLES.log} · LinkedInStreak`;
    return;
  }
  if (isSheetOpen()) closeSheet();
  show(r);
  // A link shared before onboarding finished.
  if (r === 'today' && s.profile?.onboarded_at) {
    const pending = takeSharedLink();
    if (pending) openLog({ prefill: pending, onClose: () => navigate('today', { replace: true }) });
  }
}

function show(r) {
  const changed = shown !== r;
  shown = r;
  markNav(r);
  document.title = `${TITLES[r]} · LinkedInStreak`;
  VIEWS[r].render(main, { navigate });
  if (changed) {
    window.scrollTo({ top: 0 });
    main.focus({ preventScroll: true });
  }
}

function onStore() {
  sideGoal();
  const av = app.querySelector('.avatar');
  if (av) av.innerHTML = initial(getState().profile, getState().user);
  if (shown && LIVE.has(shown)) VIEWS[shown].render(main, { navigate });
}

function wireOnline() {
  const banner = app.querySelector('[data-offline]');
  const update = () => {
    const online = navigator.onLine;
    banner.hidden = online;
    if (getState().online !== online) {
      set({ online });
      if (online) refresh();
    }
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      const offerUpdate = (worker) =>
        toast('Update available', {
          duration: 0,
          action: { label: 'Reload', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
        });
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });
    })
    .catch(() => null);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  // Notification click while the app is open: go to the log sheet.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'NAVIGATE' && e.data.route) navigate(e.data.route);
  });
}
