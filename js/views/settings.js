// Settings: profile, notifications, install, account, legal. ?debug=1 adds a diagnostics card.
import { getState, saveProfile } from '../state.js';
import { parseProfileUrl } from '../core/linkedin.js';
import { isValidTimeZone } from '../core/time.js';
import { pushStatus, STATUS_TEXT, enablePush, disablePush, sendTest, isIOS, isStandalone } from '../push.js';
import { signOut, apiBlob, api } from '../supabase.js';
import { icon } from '../ui/icons.js';
import { esc, busy } from '../ui/dom.js';
import { sheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { tzOptions } from './goal-editor.js';

/** Live slug feedback under a LinkedIn URL field. Shared with onboarding. */
export function slugFeedback(value) {
  if (!value.trim()) return { ok: false, html: '' };
  const slug = parseProfileUrl(value);
  if (!slug) {
    return { ok: false, html: `<p class="field__error">${icon('alert')}<span>Use your profile link, like linkedin.com/in/your-name.</span></p>` };
  }
  return { ok: true, slug, html: `<p class="field__ok">${icon('check')}<span>Your profile: @${esc(slug)}</span></p>` };
}

export function installGuide() {
  if (isStandalone()) return `<p class="field__ok">${icon('check')}<span>LinkedInStreak is installed on this device.</span></p>`;
  if (isIOS()) {
    return `<ol class="guide">
        <li><span>Open this page in Safari.</span></li>
        <li><span>Tap the Share button ${icon('share', { size: 'sm' })} at the bottom of the screen.</span></li>
        <li><span>Choose “Add to Home Screen”, then tap Add.</span></li>
        <li><span>Open LinkedInStreak from your home screen to turn on reminders.</span></li>
      </ol>`;
  }
  return `<p class="small muted">Install LinkedInStreak for one-tap logging, reminders and sharing straight from the LinkedIn app.</p>
    ${window.__installPrompt ? `<button type="button" class="btn btn--primary mt-3" data-install>${icon('download')}Install app</button>` : '<p class="small muted mt-2">Use your browser menu and choose “Install app” or “Add to Home screen”.</p>'}`;
}

export function wireInstall(root) {
  root.querySelector('[data-install]')?.addEventListener('click', async () => {
    const p = window.__installPrompt;
    if (!p) return;
    window.__installPrompt = null;
    p.prompt();
    await p.userChoice.catch(() => null);
  });
}

export function render(root) {
  const s = getState();
  const p = s.profile || {};
  const debug = new URLSearchParams(location.search).has('debug');

  root.innerHTML = `
    <div class="view">
      <div class="view-head"><h1>Settings</h1></div>

      <section class="card col-8" aria-labelledby="profile-title">
        <h2 class="section-title" id="profile-title">Profile</h2>
        <form class="stack" data-profile novalidate>
          <div class="field">
            <label class="label" for="set-name">Name</label>
            <input class="input" id="set-name" maxlength="80" autocomplete="name" value="${esc(p.display_name || '')}">
          </div>
          <div class="field">
            <label class="label" for="set-li">LinkedIn profile link</label>
            <input class="input" id="set-li" type="url" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://www.linkedin.com/in/your-name" value="${esc(p.linkedin_url || '')}" aria-describedby="li-hint li-slug">
            <p class="field__hint" id="li-hint">We use it to check that posts you log are yours. We never ask for your LinkedIn password.</p>
            <div id="li-slug" aria-live="polite">${slugFeedback(p.linkedin_url || '').html}</div>
          </div>
          <div class="field">
            <label class="label" for="set-tz">Timezone</label>
            <select class="select" id="set-tz">${tzOptions(p.timezone)}</select>
            <p class="field__hint">Each goal keeps its own timezone. You can change it in the goal editor.</p>
          </div>
          <fieldset class="field">
            <legend class="label">Week starts on</legend>
            <div class="seg">
              <label><input type="radio" name="ws" value="mon" ${p.week_start !== 'sun' ? 'checked' : ''}>Monday</label>
              <label><input type="radio" name="ws" value="sun" ${p.week_start === 'sun' ? 'checked' : ''}>Sunday</label>
            </div>
          </fieldset>
          <div class="field__error" data-error hidden></div>
          <div class="row row--end"><button type="submit" class="btn btn--primary">Save profile</button></div>
        </form>
      </section>

      <section class="card col-8" aria-labelledby="notif-title">
        <h2 class="section-title" id="notif-title">Notifications</h2>
        <div data-push><span class="skeleton skeleton--half"></span></div>
      </section>

      <section class="card col-8" aria-labelledby="install-title">
        <h2 class="section-title" id="install-title">Install the app</h2>
        ${installGuide()}
      </section>

      <section class="card col-8" aria-labelledby="account-title">
        <h2 class="section-title" id="account-title">Account</h2>
        <div class="card__row"><span class="small muted">Signed in as</span><span class="small">${esc(s.user?.email || '')}</span></div>
        <div class="card__row"><span class="small">Download everything we hold about you</span><button type="button" class="btn btn--sm" data-export>${icon('download')}Export data</button></div>
        <div class="card__row"><span class="small">Sign out of this device</span><button type="button" class="btn btn--sm" data-signout>${icon('logout')}Sign out</button></div>
        <div class="card__row"><span class="small">Delete your account and all your data</span><button type="button" class="btn btn--sm btn--danger" data-delete>${icon('trash')}Delete account</button></div>
      </section>

      <p class="small muted col-8"><a href="/privacy.html">Privacy policy</a> · <a href="/terms.html">Terms of use</a></p>
      ${debug ? `<section class="card col-8"><h2 class="section-title">Diagnostics</h2><dl class="dl" data-debug></dl></section>` : ''}
    </div>`;

  // Profile
  const li = root.querySelector('#set-li');
  li.addEventListener('input', () => {
    root.querySelector('#li-slug').innerHTML = slugFeedback(li.value).html;
  });
  root.querySelector('[data-profile]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = root.querySelector('[data-error]');
    const fb = slugFeedback(li.value);
    const tz = root.querySelector('#set-tz').value;
    const fail = (m) => {
      err.hidden = false;
      err.innerHTML = `${icon('alert')}<span>${esc(m)}</span>`;
    };
    err.hidden = true;
    if (li.value.trim() && !fb.ok) return fail('Check your LinkedIn profile link.');
    if (!isValidTimeZone(tz)) return fail("That timezone isn't recognised.");
    const restore = busy(e.submitter || root.querySelector('[data-profile] [type=submit]'), 'Saving…');
    const r = await saveProfile({
      display_name: root.querySelector('#set-name').value.trim() || null,
      linkedin_url: li.value.trim() || null,
      linkedin_slug: fb.ok ? fb.slug : null,
      timezone: tz,
      week_start: root.querySelector('input[name="ws"]:checked')?.value || 'mon',
    });
    restore();
    if (!r.ok) return fail(r.message);
    toast('Profile saved');
  });

  // Notifications
  drawPush(root.querySelector('[data-push]'));
  wireInstall(root);

  // Account
  root.querySelector('[data-export]').addEventListener('click', async (e) => {
    const restore = busy(e.currentTarget, 'Preparing…');
    try {
      const blob = await apiBlob('/api/account/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `LinkedInStreak-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      toast('Could not export your data. Try again.');
    }
    restore();
  });
  root.querySelector('[data-signout]').addEventListener('click', async () => {
    await signOut();
    location.replace('/login.html');
  });
  root.querySelector('[data-delete]').addEventListener('click', openDelete);

  if (debug) drawDebug(root.querySelector('[data-debug]'));
}

async function drawPush(el) {
  const status = await pushStatus();
  const s = getState();
  const anyReminders = s.goals.some((g) => g.status === 'active');
  el.innerHTML = `
    <div class="card__row"><span class="small">Status on this device</span><span class="chip ${status === 'on' ? 'chip--complete' : status === 'blocked' ? 'chip--missed' : 'chip--paused'}">${icon(status === 'on' ? 'bell' : 'info')}${STATUS_TEXT[status]}</span></div>
    ${
      status === 'ios-install'
        ? `<p class="small muted">On iPhone and iPad, reminders work once LinkedInStreak is on your home screen. See “Install the app” below.</p>`
        : status === 'blocked'
          ? `<p class="small muted">Notifications are blocked for this site. Allow them in your browser's site settings, then come back.</p>`
          : status === 'unsupported'
            ? `<p class="small muted">This browser can't show push notifications.</p>`
            : ''
    }
    <div class="row mt-3">
      ${status === 'off' ? `<button type="button" class="btn btn--primary" data-on>${icon('bell')}Turn on reminders</button>` : ''}
      ${status === 'on' ? `<button type="button" class="btn" data-test>Send a test</button><button type="button" class="btn btn--ghost" data-off>Turn off on this device</button>` : ''}
    </div>
    ${anyReminders ? '<p class="field__hint mt-3">Reminder times are set per goal, in the goal editor.</p>' : ''}`;
  el.querySelector('[data-on]')?.addEventListener('click', async (e) => {
    const restore = busy(e.currentTarget, 'Turning on…');
    try {
      const r = await enablePush();
      if (r === 'on') toast('Reminders are on');
      else if (r === 'blocked') toast('Notifications were blocked. Allow them in your browser settings.');
    } catch (err) {
      toast(err?.message || 'Could not turn on reminders.');
    }
    restore();
    drawPush(el);
  });
  el.querySelector('[data-off]')?.addEventListener('click', async () => {
    await disablePush().catch(() => null);
    toast('Reminders are off on this device');
    drawPush(el);
  });
  el.querySelector('[data-test]')?.addEventListener('click', async (e) => {
    const restore = busy(e.currentTarget, 'Sending…');
    const r = await sendTest();
    restore();
    toast(r.ok ? 'Test sent. It should arrive in a few seconds.' : r.message || 'Could not send a test.');
  });
}

function openDelete() {
  const PHRASE = 'delete my account';
  sheet({
    title: 'Delete account',
    initialFocus: '#del-confirm',
    body: (el, api_) => {
      el.innerHTML = `
        <form class="stack" novalidate>
          <div class="notice notice--danger">${icon('alert')}<div>This permanently deletes your account, goals, posts and notification settings. It can't be undone. You might want to export your data first.</div></div>
          <div class="field">
            <label class="label" for="del-confirm">Type <strong>${PHRASE}</strong> to confirm</label>
            <input class="input" id="del-confirm" autocomplete="off" spellcheck="false" autocapitalize="off">
          </div>
          <div class="field__error" data-error hidden></div>
          <div class="sheet__foot">
            <button type="button" class="btn" data-cancel>Cancel</button>
            <button type="submit" class="btn btn--danger-solid" data-go disabled>${icon('trash')}Delete forever</button>
          </div>
        </form>`;
      const input = el.querySelector('#del-confirm');
      const go = el.querySelector('[data-go]');
      input.addEventListener('input', () => {
        go.disabled = input.value.trim().toLowerCase() !== PHRASE;
      });
      el.querySelector('[data-cancel]').addEventListener('click', () => api_.close());
      el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (go.disabled) return;
        busy(go, 'Deleting…');
        const r = await api('/api/account/delete', { method: 'POST', body: { confirm: input.value.trim().toLowerCase() } });
        if (!r.ok) {
          go.disabled = false;
          go.innerHTML = `${icon('trash')}Delete forever`;
          const err = el.querySelector('[data-error]');
          err.hidden = false;
          err.innerHTML = `${icon('alert')}<span>${esc(r.message || 'Could not delete your account.')}</span>`;
          return;
        }
        await signOut().catch(() => null);
        location.replace('/?deleted=1');
      });
      return null;
    },
  });
}

async function drawDebug(el) {
  const s = getState();
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  const rows = {
    'User id': s.user?.id,
    'Profile timezone': s.profile?.timezone,
    'Browser timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    'Week start': s.profile?.week_start,
    Goals: s.goals.length,
    Posts: s.posts.length,
    'Service worker': reg ? (reg.active ? 'active' : 'installing') : 'none',
    Standalone: String(isStandalone()),
    Push: await pushStatus(),
  };
  el.innerHTML = Object.entries(rows)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v ?? '—')}</dd>`)
    .join('');
}
