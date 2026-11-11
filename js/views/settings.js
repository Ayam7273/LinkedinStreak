// Settings: profile, start date, reminders + push, appearance, account, danger zone, debug.
import { getState, subscribe, saveSettings, eraseAllPosts, clearCache } from '../state.js';
import { parseProfileUrl, parsePostUrl, decodeId } from '../linkedin.js';
import { checkNewPost } from '../streak.js';
import { formatInstant, londonDate, formatDay, weekdayName, hmToMinutes } from '../time.js';
import { pushStatus, STATUS_TEXT, enablePush, disablePush, sendTest, isIOS } from '../push.js';
import { signOut } from '../supabase.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { getTheme, setTheme } from '../theme.js';

const isTime = (v) => /^\d{2}:\d{2}$/.test(v) && !Number.isNaN(hmToMinutes(v));

function iosGuide() {
  return `<div class="note stack-sm">
    <p><b>Install LinkedStreak to get reminders.</b></p>
    <p class="aside">On iPhone, notifications only work from the Home Screen app (iOS 16.4 or later).</p>
    <ol>
      <li>Tap ${icon('share', { size: 'sm', cls: 'inline-icon' })} <b>Share</b> in Safari's toolbar.</li>
      <li>Choose ${icon('addSquare', { size: 'sm', cls: 'inline-icon' })} <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open LinkedStreak from your Home Screen and come back here.</li>
    </ol>
  </div>`;
}

async function renderPush(box) {
  const st = await pushStatus();
  const cls = st === 'on' ? ' status-value--on' : st === 'blocked' ? ' status-value--warn' : '';
  let controls = '';
  if (st === 'ios-install') controls = iosGuide();
  else if (st === 'blocked') {
    controls = `<p class="field__help">Notifications are blocked for this site. ${
      isIOS() ? 'Open iPhone Settings → Notifications → LinkedStreak and allow them.' : 'Allow them in your browser\'s site settings, then reload.'
    }</p>`;
  } else if (st === 'off') {
    controls = `<button type="button" class="btn btn--block" data-push="on">${icon('bell', { size: 'sm' })} Turn on notifications</button>`;
  } else if (st === 'on') {
    controls = `<div class="row">
      <button type="button" class="btn" data-push="test">Send test notification</button>
      <button type="button" class="btn btn--text" data-push="off">Turn off on this device</button>
    </div>`;
  }
  box.innerHTML = `
    <div class="status-line"><span class="label">This device</span><span class="status-value${cls}">${STATUS_TEXT[st]}</span></div>
    <div class="stack-sm">${controls}<p class="field__help" data-push-msg aria-live="polite"></p></div>`;

  const msg = box.querySelector('[data-push-msg]');
  box.querySelectorAll('[data-push]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const what = btn.dataset.push;
      btn.disabled = true;
      msg.textContent = '';
      try {
        if (what === 'on') await enablePush();
        if (what === 'off') await disablePush();
        if (what === 'test') {
          const r = await sendTest();
          msg.textContent = r.ok ? `Sent to ${r.sent} ${r.sent === 1 ? 'device' : 'devices'}. It should arrive in a few seconds.` : r.message;
          btn.disabled = false;
          return;
        }
      } catch (err) {
        msg.textContent = err.message || 'That didn\'t work.';
      }
      await renderPush(box);
    }),
  );
}

function debugPanel() {
  return `<section class="section stack debug" aria-labelledby="debug-h">
    <h2 class="label" id="debug-h">Debug · link checker</h2>
    <div class="field">
      <label class="label field__label" for="dbg-url">Any LinkedIn link</label>
      <input class="input" id="dbg-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://www.linkedin.com/…" />
    </div>
    <pre id="dbg-out" aria-live="polite">Paste a link to see how it's read.</pre>
  </section>`;
}

function runDebug(value) {
  const s = getState();
  const p = parsePostUrl(value);
  const out = { parse: p };
  if (p.ok && p.activityId) {
    const d = decodeId(p.activityId);
    out.decode = d.ok
      ? { ms: d.publishedAt, utc: new Date(d.publishedAt).toISOString(), london: formatInstant(d.publishedAt), londonDay: londonDate(d.publishedAt) }
      : d;
    if (d.ok) {
      out.rules = checkNewPost({ activityId: p.activityId, publishedAt: d.publishedAt, now: Date.now(), startDate: s.settings?.start_date, posts: s.posts });
    }
    out.slugMatch = p.slug ? p.slug === s.settings?.profile_slug : 'n/a (no author in URL)';
  }
  return JSON.stringify(out, null, 2);
}

function view(root) {
  const s = getState();
  if (s.status !== 'ready' || !s.settings) {
    root.innerHTML = `<h1 class="view-title">Settings</h1><div aria-busy="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton skeleton--short"></span></div>`;
    return false;
  }
  const st = s.settings;
  const times = Array.isArray(st.reminder_times) ? st.reminder_times : ['09:00', '18:00', '21:30'];
  const debug = new URLSearchParams(location.search).get('debug') === '1';
  const theme = getTheme();

  root.innerHTML = `
    <h1 class="view-title">Settings</h1>

    <section class="section stack" aria-labelledby="h-profile">
      <h2 class="label" id="h-profile">Profile</h2>
      <div class="field">
        <label class="label field__label" for="f-name">Display name</label>
        <input class="input" id="f-name" type="text" autocomplete="name" value="${esc(st.display_name || '')}" />
        <span class="field__help">Used to recognise your posts when a link carries no author.</span>
      </div>
      <div class="field">
        <label class="label field__label" for="f-profile">LinkedIn profile link</label>
        <input class="input" id="f-profile" type="url" inputmode="url" autocomplete="url" spellcheck="false"
          placeholder="https://www.linkedin.com/in/yourname" value="${esc(st.profile_url || '')}" aria-describedby="f-slug" />
        <span id="f-slug" aria-live="polite"></span>
      </div>
    </section>

    <section class="section stack" aria-labelledby="h-start">
      <h2 class="label" id="h-start">Start date</h2>
      <div class="field">
        <label class="visually-hidden" for="f-start">Start date</label>
        <input class="input" id="f-start" type="date" value="${esc(st.start_date || '')}" aria-describedby="f-start-help" />
        <span class="field__help" id="f-start-help">Days before this date don't count, either way.</span>
      </div>
    </section>

    <section class="section stack" aria-labelledby="h-rem">
      <h2 class="label" id="h-rem">Reminders</h2>
      <label class="switch">
        <span>Send reminders on Friday, Saturday and Sunday</span>
        <input type="checkbox" id="f-rem" ${st.reminders_enabled ? 'checked' : ''} />
      </label>
      <fieldset class="stack-sm">
        <legend class="label">Reminder times <span class="aside">(London)</span></legend>
        <div class="times">
          ${times.map((t, i) => `<label class="field"><span class="visually-hidden">Reminder ${i + 1}</span>
            <input class="input input--time" type="time" data-time="${i}" value="${esc(t)}" /></label>`).join('')}
        </div>
        <span class="field__help">The last one is the "last call".</span>
      </fieldset>
      <div class="field">
        <label class="label field__label" for="f-grace">Next-morning reminder</label>
        <input class="input input--time" id="f-grace" type="time" value="${esc(st.grace_reminder_time || '10:00')}" />
        <span class="field__help">If yesterday isn't logged. Logging closes at 12:00.</span>
      </div>
      <div data-push-box><span class="skeleton"></span></div>
    </section>

    <section class="section stack" aria-labelledby="h-look">
      <h2 class="label" id="h-look">Appearance</h2>
      <div class="segmented" role="radiogroup" aria-labelledby="h-look">
        ${['system', 'light', 'dark']
          .map((t) => `<label><input type="radio" name="theme" value="${t}" ${theme === t ? 'checked' : ''} />${t[0].toUpperCase() + t.slice(1)}</label>`)
          .join('')}
      </div>
    </section>

    <section class="section stack" aria-labelledby="h-acct">
      <h2 class="label" id="h-acct">Account</h2>
      <div class="status-line"><span class="label">Signed in as</span><span class="status-value">${esc(s.user?.email || '')}</span></div>
      <button type="button" class="btn" id="f-signout">Sign out</button>
    </section>

    <section class="section stack danger" aria-labelledby="h-danger">
      <h2 class="label" id="h-danger">Danger zone</h2>
      <p class="aside">Erase every logged post. Settings stay. This can't be undone.</p>
      <div class="field">
        <label class="label field__label" for="f-erase">Type ERASE to confirm</label>
        <input class="input" id="f-erase" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      </div>
      <button type="button" class="btn btn--danger" id="f-erase-go" disabled>Erase all posts</button>
    </section>

    ${debug ? debugPanel() : ''}`;

  // ---- profile
  const name = root.querySelector('#f-name');
  const prof = root.querySelector('#f-profile');
  const slugOut = root.querySelector('#f-slug');
  const showSlug = () => {
    const v = prof.value.trim();
    if (!v) {
      slugOut.innerHTML = '<span class="field__help">Required. Posts are matched to this.</span>';
      prof.removeAttribute('aria-invalid');
      return null;
    }
    const slug = parseProfileUrl(v);
    if (slug) {
      slugOut.innerHTML = `<span class="field__ok">Matching posts by <b>@${esc(slug)}</b></span>`;
      prof.removeAttribute('aria-invalid');
    } else {
      slugOut.innerHTML = '<span class="field__error">That isn\'t a LinkedIn profile link. It should look like linkedin.com/in/yourname.</span>';
      prof.setAttribute('aria-invalid', 'true');
    }
    return slug;
  };
  showSlug();
  prof.addEventListener('input', showSlug);

  const save = async (patch, msg = 'Saved.') => {
    try {
      await saveSettings(patch);
      toast(msg, { duration: 1800 });
    } catch (err) {
      toast(err.message || 'Could not save.');
    }
  };

  name.addEventListener('change', () => save({ display_name: name.value.trim() }));
  prof.addEventListener('change', () => {
    const slug = showSlug();
    if (!slug) return;
    save({ profile_url: prof.value.trim(), profile_slug: slug });
  });

  // ---- start date
  const start = root.querySelector('#f-start');
  start.addEventListener('change', () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start.value)) return;
    save({ start_date: start.value }, `Start date set to ${weekdayName(start.value)} ${formatDay(start.value, { weekday: false })}.`);
  });

  // ---- reminders
  root.querySelector('#f-rem').addEventListener('change', (e) => save({ reminders_enabled: e.target.checked }, e.target.checked ? 'Reminders on.' : 'Reminders off.'));
  root.querySelectorAll('[data-time]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const vals = [...root.querySelectorAll('[data-time]')].map((x) => x.value);
      if (!vals.every(isTime)) return;
      save({ reminder_times: [...vals].sort() });
    }),
  );
  const grace = root.querySelector('#f-grace');
  grace.addEventListener('change', () => {
    if (isTime(grace.value)) save({ grace_reminder_time: grace.value });
  });
  renderPush(root.querySelector('[data-push-box]'));

  // ---- theme
  root.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => setTheme(r.value)));

  // ---- account
  root.querySelector('#f-signout').addEventListener('click', async () => {
    clearCache();
    await signOut();
  });

  // ---- danger
  const erase = root.querySelector('#f-erase');
  const eraseGo = root.querySelector('#f-erase-go');
  erase.addEventListener('input', () => (eraseGo.disabled = erase.value.trim() !== 'ERASE'));
  eraseGo.addEventListener('click', async () => {
    if (erase.value.trim() !== 'ERASE') return;
    eraseGo.disabled = true;
    eraseGo.textContent = 'Erasing…';
    try {
      await eraseAllPosts();
      erase.value = '';
      toast('All posts erased.');
    } catch (err) {
      toast(err.message || 'Could not erase.');
    }
    eraseGo.textContent = 'Erase all posts';
  });

  // ---- debug
  if (debug) {
    const dbg = root.querySelector('#dbg-url');
    const out = root.querySelector('#dbg-out');
    dbg.addEventListener('input', () => (out.textContent = dbg.value.trim() ? runDebug(dbg.value.trim()) : "Paste a link to see how it's read."));
  }
  return true;
}

export function mount(root) {
  // Render once when data is ready; don't re-render on every tick (it would wipe inputs).
  let rendered = view(root);
  const unsub = subscribe(() => {
    if (!rendered) rendered = view(root);
  });
  return unsub;
}
