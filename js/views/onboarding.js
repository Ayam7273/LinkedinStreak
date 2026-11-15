// First-run flow: profile → timezone → first goal → reminders.
import { getState, saveProfile } from '../state.js';
import { detectTimeZone, isValidTimeZone } from '../core/time.js';
import { pushStatus, enablePush } from '../push.js';
import { icon } from '../ui/icons.js';
import { esc, busy } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { goalEditor, tzOptions } from './goal-editor.js';
import { slugFeedback, installGuide, wireInstall } from './settings.js';

const TITLES = ['About you', 'Your timezone', 'Your first goal', 'Reminders'];

export function render(root, { navigate }) {
  const s = getState();
  const p = s.profile || {};
  // Resume where the user left off.
  let step = !p.linkedin_slug ? 0 : s.goals.length ? 3 : 1;

  const frame = (inner) => `
    <div class="view">
      <div class="col-8 stack">
        <p class="small muted">Step ${step + 1} of 4</p>
        <div class="steps" aria-hidden="true">${TITLES.map((_, i) => `<span class="steps__item ${i <= step ? 'is-done' : ''}"></span>`).join('')}</div>
        <h1>${TITLES[step]}</h1>
        <div class="card" data-body>${inner}</div>
      </div>
    </div>`;

  const draw = () => {
    if (step === 0) about();
    else if (step === 1) zone();
    else if (step === 2) goal();
    else reminders();
    root.querySelector('h1')?.setAttribute('tabindex', '-1');
    root.querySelector('h1')?.focus({ preventScroll: false });
  };

  function errorBox(el, msg) {
    const e = el.querySelector('[data-error]');
    e.hidden = !msg;
    e.innerHTML = msg ? `${icon('alert')}<span>${esc(msg)}</span>` : '';
  }

  function about() {
    root.innerHTML = frame(`
      <form class="stack" novalidate>
        <p class="muted">We use your LinkedIn profile link to check that the posts you log are yours. We never ask for your LinkedIn password.</p>
        <div class="field">
          <label class="label" for="ob-name">Your name</label>
          <input class="input" id="ob-name" maxlength="80" autocomplete="name" value="${esc(p.display_name || '')}">
        </div>
        <div class="field">
          <label class="label" for="ob-li">LinkedIn profile link</label>
          <input class="input" id="ob-li" type="url" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://www.linkedin.com/in/your-name" value="${esc(p.linkedin_url || '')}" aria-describedby="ob-li-hint ob-slug">
          <p class="field__hint" id="ob-li-hint">On LinkedIn, open your profile and copy the address. It looks like linkedin.com/in/your-name.</p>
          <div id="ob-slug" aria-live="polite">${slugFeedback(p.linkedin_url || '').html}</div>
        </div>
        <div class="field__error" data-error hidden></div>
        <button type="submit" class="btn btn--primary btn--lg btn--block">Continue${icon('arrowRight')}</button>
      </form>`);
    const li = root.querySelector('#ob-li');
    li.addEventListener('input', () => {
      root.querySelector('#ob-slug').innerHTML = slugFeedback(li.value).html;
    });
    root.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fb = slugFeedback(li.value);
      if (!fb.ok) return errorBox(root, 'Add your LinkedIn profile link, like linkedin.com/in/your-name.');
      const restore = busy(e.submitter, 'Saving…');
      const r = await saveProfile({ display_name: root.querySelector('#ob-name').value.trim() || null, linkedin_url: li.value.trim(), linkedin_slug: fb.slug });
      restore();
      if (!r.ok) return errorBox(root, r.message);
      step = 1;
      draw();
    });
  }

  function zone() {
    const detected = detectTimeZone();
    const current = p.timezone && p.timezone !== 'UTC' ? p.timezone : detected;
    root.innerHTML = frame(`
      <form class="stack" novalidate>
        <p class="muted">Days start and end at midnight in this timezone. We detected <strong>${esc(detected.replace(/_/g, ' '))}</strong>.</p>
        <div class="field">
          <label class="label" for="ob-tz">Timezone</label>
          <select class="select" id="ob-tz">${tzOptions(current)}</select>
        </div>
        <fieldset class="field">
          <legend class="label">Week starts on</legend>
          <div class="seg">
            <label><input type="radio" name="ws" value="mon" ${getState().profile?.week_start !== 'sun' ? 'checked' : ''}>Monday</label>
            <label><input type="radio" name="ws" value="sun" ${getState().profile?.week_start === 'sun' ? 'checked' : ''}>Sunday</label>
          </div>
        </fieldset>
        <div class="field__error" data-error hidden></div>
        <div class="sheet__foot">
          <button type="button" class="btn" data-back>${icon('arrowLeft')}Back</button>
          <button type="submit" class="btn btn--primary">Continue${icon('arrowRight')}</button>
        </div>
      </form>`);
    root.querySelector('[data-back]').addEventListener('click', () => {
      step = 0;
      draw();
    });
    root.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const tz = root.querySelector('#ob-tz').value;
      if (!isValidTimeZone(tz)) return errorBox(root, "That timezone isn't recognised.");
      const restore = busy(e.submitter, 'Saving…');
      const r = await saveProfile({ timezone: tz, week_start: root.querySelector('input[name="ws"]:checked').value });
      restore();
      if (!r.ok) return errorBox(root, r.message);
      step = getState().goals.length ? 3 : 2;
      draw();
    });
  }

  function goal() {
    root.innerHTML = frame('');
    const body = root.querySelector('[data-body]');
    goalEditor(body, {
      inline: true,
      submitLabel: 'Create goal',
      onSaved: () => {
        step = 3;
        draw();
      },
    });
  }

  async function reminders() {
    root.innerHTML = frame(`
      <div class="stack">
        <p class="muted">We'll nudge you on posting days at the times in your goal. Nothing is sent between 22:00 and 07:00.</p>
        <div data-push><span class="skeleton skeleton--half"></span></div>
        <div class="sheet__foot">
          <button type="button" class="btn" data-skip>Skip for now</button>
          <button type="button" class="btn btn--primary" data-finish>Finish${icon('arrowRight')}</button>
        </div>
      </div>`);
    const finish = async (btn) => {
      const restore = busy(btn, 'Finishing…');
      const r = await saveProfile({ onboarded_at: new Date().toISOString() });
      restore();
      if (!r.ok) return toast(r.message);
      navigate('today', { replace: true });
    };
    root.querySelector('[data-skip]').addEventListener('click', (e) => finish(e.currentTarget));
    root.querySelector('[data-finish]').addEventListener('click', (e) => finish(e.currentTarget));

    const box = root.querySelector('[data-push]');
    const status = await pushStatus();
    if (status === 'ios-install') {
      box.innerHTML = `<div class="notice notice--blue">${icon('phone')}<div>On iPhone, reminders need the app on your home screen first.</div></div><div class="mt-4">${installGuide()}</div>`;
      wireInstall(box);
    } else if (status === 'on') {
      box.innerHTML = `<p class="field__ok">${icon('check')}<span>Reminders are on for this device.</span></p>`;
    } else if (status === 'blocked' || status === 'unsupported') {
      box.innerHTML = `<p class="small muted">${status === 'blocked' ? 'Notifications are blocked in this browser. You can allow them later in its site settings.' : "This browser can't show push notifications."}</p>`;
    } else {
      box.innerHTML = `<button type="button" class="btn btn--primary btn--block" data-on>${icon('bell')}Turn on reminders</button>`;
      box.querySelector('[data-on]').addEventListener('click', async (e) => {
        const restore = busy(e.currentTarget, 'Turning on…');
        try {
          const r = await enablePush();
          if (r === 'on') {
            box.innerHTML = `<p class="field__ok">${icon('check')}<span>Reminders are on for this device.</span></p>`;
            return;
          }
          toast(r === 'blocked' ? 'Notifications were blocked.' : 'Reminders stay off for now.');
        } catch (err) {
          toast(err?.message || 'Could not turn on reminders.');
        }
        restore();
      });
    }
  }

  draw();
}
