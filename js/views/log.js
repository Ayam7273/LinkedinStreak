// Log-a-post sheet (#/log). Also where Android shares land.
import { sheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon, checkDraw } from '../ui/icons.js';
import { esc, busy } from '../ui/dom.js';
import { readPost, slugMatches } from '../core/linkedin.js';
import { formatInstant } from '../core/time.js';
import { getState, activeGoal, versionNow, profileTz, logPost, summaryFor, currentUnitFor } from '../state.js';

const PROFILE_CODES = new Set(['NO_PROFILE']);

export function openLog({ prefill = '', onClose } = {}) {
  return sheet({
    title: 'Log a post',
    initialFocus: prefill ? '[data-submit]' : '#post-url',
    onClose,
    body: (el, api) => {
      const goal = activeGoal();
      if (!goal) {
        el.innerHTML = `
          <div class="empty">
            ${icon('goals')}
            <p>You need an active goal before you can log posts.</p>
            <a class="btn btn--primary" href="#/goals" data-go>Go to goals</a>
          </div>`;
        el.querySelector('[data-go]').addEventListener('click', () => api.close({ silent: true }));
        return null;
      }
      const s = getState();
      const tz = versionNow(goal.id)?.timezone || profileTz();
      const slug = s.profile?.linkedin_slug || null;
      const canPaste = !!navigator.clipboard?.readText;

      el.innerHTML = `
        <form class="stack" novalidate>
          ${slug ? '' : `<div class="notice notice--warn">${icon('alert')}<div>Add your LinkedIn profile link first, so we can confirm posts are yours. <a href="#/settings" data-go>Open settings</a></div></div>`}
          <div class="field">
            <label class="label" for="post-url">Link to your post</label>
            <div class="input-group">
              <input class="input" id="post-url" name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
                placeholder="https://www.linkedin.com/posts/…" aria-describedby="post-hint post-preview">
              <button type="button" class="btn" data-paste>${icon('paste')}Paste</button>
            </div>
            <p class="field__hint" id="post-hint">In LinkedIn, open the post's menu and choose "Copy link to post".</p>
            <div id="post-preview" aria-live="polite"></div>
          </div>
          <div class="field">
            <label class="label" for="post-note">Note <span class="faint">(optional)</span></label>
            <textarea class="textarea" id="post-note" name="note" maxlength="280" rows="2" placeholder="What was it about?"></textarea>
          </div>
          <div class="field__error" data-error hidden></div>
          <button type="submit" class="btn btn--primary btn--lg btn--block" data-submit>${icon('check')}Verify and log</button>
        </form>`;

      const form = el.querySelector('form');
      const input = el.querySelector('#post-url');
      const preview = el.querySelector('#post-preview');
      const errorEl = el.querySelector('[data-error]');
      const pasteBtn = el.querySelector('[data-paste]');
      el.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', () => api.close({ silent: true })));

      const showError = (msg, html = false) => {
        errorEl.hidden = !msg;
        errorEl.innerHTML = msg ? `${icon('alert')}<span>${html ? msg : esc(msg)}</span>` : '';
      };

      const update = () => {
        showError('');
        const v = input.value.trim();
        if (!v) {
          preview.innerHTML = '';
          input.removeAttribute('aria-invalid');
          return null;
        }
        const p = readPost(v);
        if (!p.ok) {
          input.setAttribute('aria-invalid', 'true');
          preview.innerHTML = `<p class="preview preview--error mt-2">${icon('alert')}<span>${esc(p.message)}</span></p>`;
          return null;
        }
        if (slug && slugMatches(p, slug) === false) {
          input.setAttribute('aria-invalid', 'true');
          preview.innerHTML = `<p class="preview preview--error mt-2">${icon('alert')}<span>This post belongs to @${esc(p.slug)}, not @${esc(slug)}.</span></p>`;
          return null;
        }
        input.removeAttribute('aria-invalid');
        const text =
          p.kind === 'short'
            ? "Short link. We'll open it to find the post when you verify."
            : `Published ${formatInstant(p.publishedAt, tz)}${p.slug ? ` · @${p.slug}` : ''}`;
        preview.innerHTML = `<p class="preview mt-2">${icon(p.kind === 'short' ? 'link' : 'calendar')}<span>${esc(text)}</span></p>`;
        return p;
      };

      input.addEventListener('input', update);
      if (prefill) {
        input.value = prefill;
        update();
      }

      pasteBtn.addEventListener('click', async () => {
        if (!canPaste) {
          input.focus();
          toast('Press and hold in the box, then choose Paste.');
          return;
        }
        try {
          const text = await navigator.clipboard.readText();
          if (!text) {
            toast('Your clipboard is empty. Copy the post link first.');
            return;
          }
          input.value = text.trim();
          update();
          el.querySelector('[data-submit]').focus();
        } catch {
          input.focus();
          toast('Paste was blocked. Press and hold in the box, then choose Paste.');
        }
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const parsed = update();
        if (!parsed) {
          if (!input.value.trim()) showError('Paste the link to your post.');
          input.focus();
          return;
        }
        const btn = el.querySelector('[data-submit]');
        const restore = busy(btn, 'Checking…');
        const r = await logPost({ url: input.value.trim(), note: el.querySelector('#post-note').value.trim() || undefined });
        if (!r.ok) {
          restore();
          if (PROFILE_CODES.has(r.code)) {
            showError(`${esc(r.message)} <a href="#/settings" data-go2>Open settings</a>`, true);
            errorEl.querySelector('[data-go2]')?.addEventListener('click', () => api.close({ silent: true }));
          } else {
            showError(r.message || 'Something went wrong. Try again.');
          }
          return;
        }
        done(el, api, r);
      });

      return null;
    },
  });
}

function done(el, api, r) {
  const goal = activeGoal();
  const sum = summaryFor(goal);
  const n = sum?.current ?? r.streak?.current ?? 0;
  const word = sum?.unit === 'weeks' ? 'week' : 'day';
  let line = `Logged — ${n}-${word} streak`;
  if (sum?.mode === 'weekly') {
    const unit = currentUnitFor(goal);
    if (unit && unit.state !== 'complete') line = `Logged — ${Math.min(unit.count, unit.needed)} of ${unit.needed} this week`;
  }
  const verified = r.author === 'verified';
  el.innerHTML = `
    <div class="check-draw">
      ${checkDraw()}
      <h3>${esc(line)}</h3>
      <p class="small muted">${verified ? 'Verified as your post.' : "Logged. We couldn't confirm the author automatically, so it's marked unconfirmed."}</p>
    </div>
    <button type="button" class="btn btn--primary btn--lg btn--block" data-done>Done</button>`;
  el.querySelector('[data-done]').addEventListener('click', () => api.close());
  el.querySelector('[data-done]').focus();
  toast(line);
}
