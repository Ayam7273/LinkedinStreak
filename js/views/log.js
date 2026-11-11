// Log-a-post sheet. Also the landing for the Android share target.
import { sheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon, stampMark } from '../ui/icons.js';
import { esc, reducedMotion, plural } from '../ui/dom.js';
import { readPost, extractUrl, slugMatches } from '../linkedin.js';
import { checkNewPost } from '../streak.js';
import { formatInstant, weekdayName, formatDay } from '../time.js';
import { getState, addPost, derived } from '../state.js';
import { api } from '../supabase.js';

const HARD_CLIENT_FAILS = new Set(['BAD_URL', 'NO_TIMESTAMP', 'NOT_REQUIRED_DAY', 'BEFORE_START', 'GRACE_EXPIRED', 'DUPLICATE', 'DAY_ALREADY_LOGGED', 'WRONG_AUTHOR']);

/** Instant, client-side read of a link. */
function localCheck(value) {
  const s = getState();
  const r = readPost(value);
  if (!r.ok) return { kind: 'error', code: r.code, message: r.message };
  if (r.kind === 'short') {
    return { kind: 'info', message: 'Short link. It will be opened on the server when you log it.' };
  }
  const who = r.slug ? `@${r.slug}` : 'author checked on save';
  const preview = `Published ${formatInstant(r.publishedAt)} · ${who}`;
  if (r.slug && s.settings?.profile_slug && slugMatches(r, s.settings.profile_slug) === false) {
    return { kind: 'error', code: 'WRONG_AUTHOR', message: 'This post belongs to someone else.', preview };
  }
  const check = checkNewPost({
    activityId: r.activityId,
    publishedAt: r.publishedAt,
    now: Date.now(),
    startDate: s.settings?.start_date,
    posts: s.posts,
  });
  if (!check.ok) return { kind: 'error', code: check.code, message: check.message, preview };
  return { kind: 'ok', preview, day: check.day };
}

export function openLogSheet({ prefill = '', onClose } = {}) {
  return sheet({
    title: 'Log a post',
    initialFocus: prefill ? '#log-submit' : '#log-url',
    onClose,
    body(el, api$) {
      el.innerHTML = `
        <form class="stack" novalidate>
          <div class="field">
            <label class="label field__label" for="log-url">Post link</label>
            <div class="url-field">
              <input class="input input--url" id="log-url" name="url" type="url" inputmode="url"
                autocomplete="off" autocapitalize="off" spellcheck="false"
                placeholder="linkedin.com/posts/…" aria-describedby="log-feedback" />
              <button type="button" class="btn btn--quiet" id="log-paste">${icon('paste', { size: 'sm' })}<span>Paste</span></button>
            </div>
            <div id="log-feedback" class="preview" aria-live="polite"></div>
          </div>
          <div class="field">
            <label class="label field__label" for="log-note">Note <span class="aside">(optional)</span></label>
            <input class="input" id="log-note" name="note" type="text" maxlength="280" placeholder="What was it about?" />
          </div>
          <button class="btn btn--primary" id="log-submit" type="submit">Verify &amp; log</button>
          <p class="field__help">Use <b>Copy link to post</b> in LinkedIn. Only Friday, Saturday and Sunday posts count, and each day takes one post.</p>
        </form>`;

      const form = el.querySelector('form');
      const input = el.querySelector('#log-url');
      const note = el.querySelector('#log-note');
      const feedback = el.querySelector('#log-feedback');
      const submit = el.querySelector('#log-submit');
      const pasteBtn = el.querySelector('#log-paste');
      let busy = false;

      function renderFeedback() {
        const v = input.value.trim();
        if (!v) {
          feedback.innerHTML = '';
          input.removeAttribute('aria-invalid');
          submit.disabled = false;
          return;
        }
        const r = localCheck(v);
        const preview = r.preview ? `<span class="field__ok">${esc(r.preview)}</span>` : '';
        if (r.kind === 'error') {
          feedback.innerHTML = `${preview}<span class="field__error">${esc(r.message)}</span>`;
          input.setAttribute('aria-invalid', 'true');
          submit.disabled = HARD_CLIENT_FAILS.has(r.code);
        } else {
          feedback.innerHTML = r.kind === 'ok' ? preview : `<span class="field__help">${esc(r.message)}</span>`;
          input.removeAttribute('aria-invalid');
          submit.disabled = false;
        }
      }

      input.addEventListener('input', renderFeedback);
      input.addEventListener('paste', () => setTimeout(() => {
        input.value = extractUrl(input.value);
        renderFeedback();
      }));

      // Paste button with graceful fallback
      if (!navigator.clipboard?.readText) {
        pasteBtn.hidden = true;
      }
      pasteBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          input.value = extractUrl(text);
          renderFeedback();
          submit.focus();
        } catch {
          input.focus();
          feedback.innerHTML = '<span class="field__help">Paste access was blocked. Long-press the field and choose Paste.</span>';
        }
      });

      if (prefill) {
        input.value = extractUrl(prefill);
        renderFeedback();
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const url = input.value.trim();
        if (!url) {
          feedback.innerHTML = '<span class="field__error">Paste the link to your post.</span>';
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        busy = true;
        const before = derived().current;
        submit.disabled = true;
        submit.textContent = 'Checking…';
        feedback.innerHTML = '<span class="checking">Checking the link…</span>';

        const res = await api('/api/verify-post', { method: 'POST', body: { url, note: note.value.trim() || undefined } });
        busy = false;

        if (!res.ok) {
          submit.disabled = false;
          submit.textContent = 'Verify & log';
          feedback.innerHTML = `<span class="field__error">${esc(res.message || 'Could not log that post.')}</span>`;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }

        // Success: stamp, then close and update Today.
        const label = `${weekdayName(res.day)} ${formatDay(res.day, { weekday: false })}`;
        api$.setTitle('Logged');
        el.innerHTML = `
          <div class="stack" aria-live="polite">
            <div class="logged">
              <span class="day__mark${reducedMotion() ? '' : ' is-stamping'}">${stampMark()}</span>
              <div>
                <p>Logged for ${esc(label)}.</p>
                <p class="aside">Published ${esc(formatInstant(res.publishedAt))}</p>
              </div>
            </div>
            ${res.author === 'unconfirmed'
              ? '<p class="field__help">The author couldn\'t be confirmed from this link. Next time, use <b>Copy link to post</b> so the link includes your name.</p>'
              : ''}
          </div>`;

        const wait = reducedMotion() ? 600 : res.author === 'unconfirmed' ? 2600 : 1100;
        setTimeout(() => {
          // Close first so the stamp lands on Today in view, not behind the scrim.
          api$.close();
          setTimeout(() => {
            addPost(res.post, { from: before, to: res.streakAfter });
            toast(`Logged. ${plural(res.streakAfter, 'day', 'days')}.`);
          }, reducedMotion() ? 0 : 200);
        }, wait);
      });

      return null;
    },
  });
}
