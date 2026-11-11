// Boot, router, view mounting.
import { applyTheme } from './theme.js';
import { getSession, onAuthChange } from './supabase.js';
import { load, set, getState, clearLegacy, clearCache } from './state.js';
import { resyncPush } from './push.js';
import { extractUrl } from './linkedin.js';
import { londonDate, weekdayName, formatDay } from './time.js';
import { toast } from './ui/toast.js';
import { icon } from './ui/icons.js';
import { esc } from './ui/dom.js';
import { closeSheet, isSheetOpen } from './ui/sheet.js';
import * as Today from './views/today.js';
import * as Ledger from './views/ledger.js';
import * as Settings from './views/settings.js';
import * as SignIn from './views/signin.js';
import { openLogSheet } from './views/log.js';

applyTheme();
clearLegacy();

const ROUTES = { today: Today, ledger: Ledger, settings: Settings };
const TABS = [
  ['today', 'Today'],
  ['ledger', 'Ledger'],
  ['settings', 'Settings'],
];

const app = document.getElementById('app');
let current = { name: null, unmount: null };
let sharePrefill = '';
let booted = false;
let logSheet = null;

// ---- Share target: /share?url=...&text=... -> /#/log with the link filled in
if (location.pathname === '/share') {
  const q = new URLSearchParams(location.search);
  sharePrefill = extractUrl(q.get('url') || '') || extractUrl(q.get('text') || '') || extractUrl(q.get('title') || '');
  history.replaceState(null, '', '/#/log');
}

// ---- Shell ------------------------------------------------------------------
function mastheadDate() {
  const d = londonDate(Date.now());
  return `${weekdayName(d)} ${formatDay(d, { weekday: false, year: true })}`;
}

function shell({ tabs = true } = {}) {
  app.innerHTML = `
    <div class="shell">
      <header class="masthead frame">
        <div class="masthead__inner">
          <a class="wordmark" href="#/today">LinkedStreak</a>
          <span class="label masthead__date" data-date>${esc(mastheadDate())}</span>
        </div>
      </header>
      <main class="content frame${tabs ? '' : ' content--bare'}" id="view" tabindex="-1"></main>
      ${tabs ? `<nav class="tabbar" aria-label="Main">
        <ul class="tabbar__list">
          ${TABS.map(([k, t]) => `<li><a class="tab" href="#/${k}" data-tab="${k}">${icon(k)}<span>${t}</span></a></li>`).join('')}
        </ul>
      </nav>` : ''}
    </div>`;
}

function setActiveTab(name) {
  app.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// ---- Router -----------------------------------------------------------------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const name = h.split(/[?/]/)[0] || 'today';
  return name;
}

function mountView(name) {
  const view = document.getElementById('view');
  if (!view) return;
  if (current.name === name) return;
  current.unmount?.();
  current = { name, unmount: ROUTES[name].mount(view) };
  setActiveTab(name);
  const titles = { today: 'Today', ledger: 'Ledger', settings: 'Settings' };
  document.title = name === 'today' ? 'LinkedStreak' : `${titles[name]} · LinkedStreak`;
}

function route() {
  if (!getState().user) return;
  const name = parseRoute();

  if (name === 'log') {
    if (current.name !== 'today') mountView('today');
    if (!logSheet) {
      const prefill = sharePrefill;
      sharePrefill = '';
      logSheet = openLogSheet({
        prefill,
        onClose: () => {
          logSheet = null;
          if (parseRoute() === 'log') location.hash = '#/today';
        },
      });
    }
    return;
  }

  if (logSheet) {
    const s = logSheet;
    logSheet = null;
    s.close({ silent: true });
  } else if (isSheetOpen()) {
    closeSheet();
  }

  if (!ROUTES[name]) {
    location.replace('#/today');
    return;
  }
  const changed = current.name !== name;
  mountView(name);
  if (changed) {
    window.scrollTo(0, 0);
    if (booted) document.getElementById('view')?.focus({ preventScroll: true });
  }
}

window.addEventListener('hashchange', route);

// ---- Auth -------------------------------------------------------------------
function showSignIn() {
  current.unmount?.();
  current = { name: 'signin', unmount: null };
  shell({ tabs: false });
  document.title = 'Sign in · LinkedStreak';
  current.unmount = SignIn.mount(document.getElementById('view'));
}

function showSetupError(err) {
  shell({ tabs: false });
  document.getElementById('view').innerHTML = `
    <h1 class="view-title">Not set up yet</h1>
    <p class="aside">${esc(err.message || 'The app could not reach its server.')}</p>
    <p class="field__help">See the README: Supabase, then environment variables in Vercel.</p>`;
}

async function enter(session) {
  const user = session.user;
  if (getState().user?.id === user.id && current.name && current.name !== 'signin') return;
  current = { name: null, unmount: null };
  shell();
  set({ user });
  if (!location.hash || /access_token|error_description/.test(location.hash)) {
    history.replaceState(null, '', sharePrefill ? '/#/log' : '/#/today');
  }
  route();
  booted = true;
  await load(user);
  resyncPush();
}

async function boot() {
  let session;
  try {
    session = await getSession();
  } catch (err) {
    if (!navigator.onLine) {
      showSetupError({ message: "You're offline and this device hasn't signed in yet." });
    } else {
      showSetupError(err);
    }
    return;
  }

  if (session) await enter(session);
  else {
    showSignIn();
    // A failed magic link comes back as #error=…&error_description=…
    const params = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
    const desc = params.get('error_description');
    if (desc) {
      history.replaceState(null, '', '/');
      toast(/expired|invalid/i.test(desc) ? 'That sign-in link has expired or was already used. Send a new one.' : desc, { duration: 8000 });
    }
  }

  onAuthChange((s) => {
    if (s) enter(s);
    else {
      clearCache();
      set({ user: null, settings: null, posts: [], status: 'idle' });
      showSignIn();
    }
  });
}

// ---- Ticking clock: re-derive states every minute, refresh on focus ----------
setInterval(() => {
  const d = app.querySelector('[data-date]');
  if (d) d.textContent = mastheadDate();
  if (getState().status === 'ready') set({});
}, 60 * 1000);

document.addEventListener('visibilitychange', () => {
  const { user } = getState();
  if (document.visibilityState === 'visible' && user) {
    load(user);
    resyncPush();
  }
});

// ---- Offline banner ---------------------------------------------------------
const banner = document.getElementById('offline');
function onNetwork() {
  const online = navigator.onLine;
  if (banner) banner.hidden = online;
  set({ online });
}
window.addEventListener('online', () => {
  onNetwork();
  const { user } = getState();
  if (user) load(user);
});
window.addEventListener('offline', onNetwork);
onNetwork();

// ---- Service worker + update flow -------------------------------------------
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const offer = (worker) =>
        toast('Update available', {
          duration: 0,
          action: { label: 'Reload', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      // Check for updates when the app comes back into view.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch {
      /* SW is an enhancement */
    }
  });
}

boot();
