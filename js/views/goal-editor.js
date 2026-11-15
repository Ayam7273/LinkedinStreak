// Goal create/edit: three steps (schedule → duration and grace → reminders), live summary.
// Renders into a sheet, or inline (onboarding).
import { sheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { esc, busy, plural } from '../ui/dom.js';
import { describeSchedule, countPlanned } from '../core/schedule.js';
import { DEFAULT_REMINDER_TIMES } from '../core/reminders.js';
import { formatDay, weekdayLabel, isValidTimeZone, isHm } from '../core/time.js';
import { goalAction, versionNow, profileTz, profileToday, weekStart, getState } from '../state.js';

const TEMPLATES = [
  { id: 'weekend', title: 'Fri, Sat and Sun', desc: 'Three posts over the weekend', mode: 'days', days: [5, 6, 0] },
  { id: 'weekdays', title: 'Weekdays', desc: 'Monday to Friday', mode: 'days', days: [1, 2, 3, 4, 5] },
  { id: 'three', title: '3 a week', desc: 'Any three days', mode: 'weekly', target: 3 },
  { id: 'daily', title: 'Every day', desc: 'Seven days a week', mode: 'days', days: [0, 1, 2, 3, 4, 5, 6] },
];

const GRACE = [
  { v: 0, title: 'None', desc: 'Log on the day' },
  { v: 6, title: '6 hours', desc: 'Until 06:00 next day' },
  { v: 12, title: '12 hours', desc: 'Until noon next day' },
  { v: 24, title: '24 hours', desc: 'Until the end of the next day' },
];

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const STEPS = ['Schedule', 'Duration', 'Reminders'];

export function timeZones() {
  try {
    const list = Intl.supportedValuesOf('timeZone');
    if (list?.length) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    /* older browsers */
  }
  return ['UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Africa/Lagos', 'Africa/Nairobi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo'];
}

export function tzOptions(selected) {
  const zones = timeZones();
  if (selected && !zones.includes(selected)) zones.unshift(selected);
  return zones.map((z) => `<option value="${esc(z)}" ${z === selected ? 'selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`).join('');
}

/** Sheet wrapper. */
export function openGoalEditor({ goal = null, onSaved } = {}) {
  return sheet({
    title: goal ? 'Edit goal' : 'New goal',
    initialFocus: '#goal-name',
    body: (el, api) =>
      goalEditor(el, {
        goal,
        onCancel: () => api.close(),
        onSaved: (g) => {
          api.close({ silent: true });
          onSaved?.(g);
        },
      }),
  });
}

/** Render the editor into `el`. Returns a cleanup function. */
export function goalEditor(el, { goal = null, onSaved, onCancel, inline = false, submitLabel } = {}) {
  const editing = !!goal;
  const v = editing ? versionNow(goal.id) : null;
  const today = profileToday();
  const started = editing && goal.start_date <= today;

  const d = {
    name: goal?.name || (editing ? '' : TEMPLATES[0].title),
    mode: goal?.mode || 'days',
    days: v ? [...v.days_of_week] : [5, 6, 0],
    target: v?.weekly_target || 3,
    start: goal?.start_date || today,
    end: goal?.end_date || '',
    hasEnd: !!goal?.end_date,
    grace: v?.grace_hours ?? 12,
    tz: v?.timezone || profileTz(),
    remind: v ? v.reminders_enabled : true,
    times: v ? [...v.reminder_times] : [...DEFAULT_REMINDER_TIMES],
    graceRemind: v ? v.grace_reminder : true,
    template: editing ? null : 'weekend',
  };
  let step = 0;

  function summary() {
    const s = describeSchedule(
      { mode: d.mode, days_of_week: d.days, weekly_target: d.target, start_date: d.start, end_date: d.hasEnd ? d.end : null },
      { formatDay, weekdayLabel },
    );
    const what = d.mode === 'weekly' ? `${d.target === 1 ? 'once' : `${d.target} times`} a week, on any days` : s.what;
    const bits = [`Post <strong>${esc(what)}</strong>`];
    bits.push(d.start > today ? `starting ${esc(formatDay(d.start, { weekday: false }))}` : started ? '' : 'starting today');
    bits.push(d.hasEnd && d.end ? `until ${esc(formatDay(d.end, { weekday: false }))}` : 'with no end date');
    let out = bits.filter(Boolean).join(', ') + '.';
    if (d.hasEnd && d.end) {
      const planned = countPlanned({ mode: d.mode, days_of_week: d.days, weekly_target: d.target, start_date: d.start, end_date: d.end }, weekStart());
      if (planned) out += ` That's ${plural(planned.posts, 'post')}.`;
    }
    out += d.grace ? ` Late posts can be logged for up to ${d.grace} hours.` : ' Posts must be logged on the day.';
    if (step >= 2 || editing) {
      const t = [...d.times].sort();
      out += d.remind && t.length ? ` Reminders at ${esc(listJoin(t))}.` : ' No reminders.';
    }
    return out;
  }

  function stepSchedule() {
    return `
      ${
        editing
          ? ''
          : `<fieldset class="field">
              <legend class="label">Start from a template</legend>
              <div class="options options--2">
                ${TEMPLATES.map(
                  (t) => `<label class="option">
                    <input type="radio" name="tpl" value="${t.id}" ${d.template === t.id ? 'checked' : ''}>
                    <span class="option__title">${t.title}</span><span class="option__desc">${t.desc}</span>
                  </label>`,
                ).join('')}
              </div>
            </fieldset>`
      }
      <div class="field">
        <label class="label" for="goal-name">Goal name</label>
        <input class="input" id="goal-name" maxlength="60" value="${esc(d.name)}" placeholder="Weekend posting" autocomplete="off">
      </div>
      <fieldset class="field">
        <legend class="label">How do you want to post?</legend>
        ${
          editing
            ? `<p class="small muted">${d.mode === 'weekly' ? 'A number of posts each week' : 'On specific days'} (fixed for this goal)</p>`
            : `<div class="seg">
                <label><input type="radio" name="mode" value="days" ${d.mode === 'days' ? 'checked' : ''}>Specific days</label>
                <label><input type="radio" name="mode" value="weekly" ${d.mode === 'weekly' ? 'checked' : ''}>Weekly target</label>
              </div>`
        }
      </fieldset>
      ${
        d.mode === 'days'
          ? `<fieldset class="field">
              <legend class="label">Posting days</legend>
              <div class="daypick">
                ${DAY_ORDER.map(
                  (i) => `<label><input type="checkbox" name="dow" value="${i}" ${d.days.includes(i) ? 'checked' : ''} aria-label="${weekdayLabel(i)}"><span aria-hidden="true">${weekdayLabel(i, true).slice(0, 2)}</span></label>`,
                ).join('')}
              </div>
            </fieldset>`
          : `<div class="field">
              <span class="label" id="target-label">Posts per week</span>
              <div class="row">
                <div class="stepper" role="group" aria-labelledby="target-label">
                  <button type="button" class="btn btn--icon" data-dec aria-label="Fewer">${icon('minus')}</button>
                  <span class="stepper__value" aria-live="polite">${d.target}</span>
                  <button type="button" class="btn btn--icon" data-inc aria-label="More">${icon('plus')}</button>
                </div>
                <span class="small muted">on any days</span>
              </div>
            </div>`
      }`;
  }

  function stepDuration() {
    return `
      <div class="field">
        <label class="label" for="goal-start">Start date</label>
        <input class="input" id="goal-start" type="date" value="${esc(d.start)}" ${started ? 'disabled aria-describedby="start-hint"' : `min="${today}"`}>
        ${started ? '<p class="field__hint" id="start-hint">The start date can\'t change once a goal has started.</p>' : ''}
      </div>
      <fieldset class="field">
        <legend class="label">How long?</legend>
        <div class="seg">
          <label><input type="radio" name="span" value="ongoing" ${d.hasEnd ? '' : 'checked'}>Ongoing</label>
          <label><input type="radio" name="span" value="end" ${d.hasEnd ? 'checked' : ''}>Until a date</label>
        </div>
        ${d.hasEnd ? `<label class="visually-hidden" for="goal-end">End date</label><input class="input mt-2" id="goal-end" type="date" value="${esc(d.end)}" min="${esc(d.start > today ? d.start : today)}">` : ''}
      </fieldset>
      <fieldset class="field">
        <legend class="label">Grace period</legend>
        <div class="options options--2">
          ${GRACE.map(
            (g) => `<label class="option"><input type="radio" name="grace" value="${g.v}" ${d.grace === g.v ? 'checked' : ''}>
              <span class="option__title">${g.title}</span><span class="option__desc">${g.desc}</span></label>`,
          ).join('')}
        </div>
        <p class="field__hint">Posted late at night? The grace period gives you time to log it the next morning. The post must still be published on the day.</p>
      </fieldset>
      <div class="field">
        <label class="label" for="goal-tz">Timezone</label>
        <select class="select" id="goal-tz">${tzOptions(d.tz)}</select>
      </div>`;
  }

  function stepReminders() {
    return `
      <label class="switch"><span><span class="card__title">Reminders</span><br><span class="small muted">Push notifications on posting days</span></span>
        <input type="checkbox" id="goal-remind" ${d.remind ? 'checked' : ''}></label>
      ${
        d.remind
          ? `<fieldset class="field">
              <legend class="label">Reminder times</legend>
              <div class="times">
                ${d.times
                  .map(
                    (t, i) => `<div class="times__row">
                      <label class="visually-hidden" for="rt-${i}">Reminder ${i + 1}</label>
                      <input class="input input--time" id="rt-${i}" type="time" value="${esc(t)}" data-time="${i}">
                      <button type="button" class="btn btn--icon" data-remove="${i}" aria-label="Remove ${esc(t)}">${icon('x')}</button>
                    </div>`,
                  )
                  .join('')}
              </div>
              ${d.times.length < 4 ? `<button type="button" class="btn btn--ghost btn--sm" data-add>${icon('plus')}Add a time</button>` : ''}
              <p class="field__hint">We only send the most recent reminder that's due, and never between 22:00 and 07:00.</p>
            </fieldset>
            <label class="switch"><span><span class="card__title">Grace reminder</span><br><span class="small muted">A morning nudge if yesterday's post isn't logged</span></span>
              <input type="checkbox" id="goal-grace-remind" ${d.graceRemind ? 'checked' : ''}></label>`
          : ''
      }`;
  }

  function validate(at) {
    if (at === 0) {
      if (!d.name.trim()) return 'Give the goal a name.';
      if (d.mode === 'days' && !d.days.length) return 'Pick at least one day.';
    }
    if (at === 1) {
      if (!d.start) return 'Choose a start date.';
      if (d.hasEnd && (!d.end || d.end < d.start)) return 'Choose an end date after the start date.';
      if (d.hasEnd && d.end < today) return "The end date can't be in the past.";
      if (!isValidTimeZone(d.tz)) return "That timezone isn't recognised.";
    }
    if (at === 2) {
      if (d.remind && !d.times.length) return 'Add at least one reminder time, or turn reminders off.';
      if (!d.times.every(isHm)) return 'Use times like 09:00.';
    }
    return null;
  }

  function draw({ focus } = {}) {
    const last = step === STEPS.length - 1;
    el.innerHTML = `
      <form class="stack" novalidate>
        <div>
          <div class="steps" aria-hidden="true">${STEPS.map((_, i) => `<span class="steps__item ${i <= step ? 'is-done' : ''}"></span>`).join('')}</div>
          <p class="small muted">Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}</p>
        </div>
        ${editing ? `<div class="notice notice--blue">${icon('info')}<div>Changes apply from today. Past days keep the schedule they had.</div></div>` : ''}
        ${[stepSchedule, stepDuration, stepReminders][step]()}
        <div class="summary" aria-live="polite" data-summary>${summary()}</div>
        <div class="field__error" data-error hidden></div>
        <div class="sheet__foot">
          ${step > 0 ? `<button type="button" class="btn" data-back>${icon('arrowLeft')}Back</button>` : onCancel && !inline ? '<button type="button" class="btn" data-cancel>Cancel</button>' : ''}
          ${
            last
              ? `<button type="submit" class="btn btn--primary" data-save>${icon('check')}${esc(submitLabel || (editing ? 'Save changes' : 'Create goal'))}</button>`
              : `<button type="submit" class="btn btn--primary">Next${icon('arrowRight')}</button>`
          }
        </div>
      </form>`;
    wire();
    if (focus) el.querySelector(focus)?.focus();
  }

  const refreshSummary = () => {
    const s = el.querySelector('[data-summary]');
    if (s) s.innerHTML = summary();
  };

  function showError(msg) {
    const e = el.querySelector('[data-error]');
    e.hidden = !msg;
    e.innerHTML = msg ? `${icon('alert')}<span>${esc(msg)}</span>` : '';
  }

  function wire() {
    const form = el.querySelector('form');
    const q = (s) => el.querySelector(s);

    q('#goal-name')?.addEventListener('input', (e) => {
      d.name = e.target.value;
    });
    el.querySelectorAll('input[name="tpl"]').forEach((r) =>
      r.addEventListener('change', () => {
        const t = TEMPLATES.find((x) => x.id === r.value);
        d.template = t.id;
        d.mode = t.mode;
        if (t.days) d.days = [...t.days];
        if (t.target) d.target = t.target;
        if (!d.name.trim() || TEMPLATES.some((x) => x.title === d.name)) d.name = t.title;
        draw({ focus: `input[name="tpl"][value="${t.id}"]` });
      }),
    );
    el.querySelectorAll('input[name="mode"]').forEach((r) =>
      r.addEventListener('change', () => {
        d.mode = r.value;
        d.template = null;
        draw({ focus: `input[name="mode"][value="${r.value}"]` });
      }),
    );
    el.querySelectorAll('input[name="dow"]').forEach((c) =>
      c.addEventListener('change', () => {
        const n = Number(c.value);
        d.days = c.checked ? [...new Set([...d.days, n])] : d.days.filter((x) => x !== n);
        d.template = null;
        refreshSummary();
      }),
    );
    const setTarget = (n) => {
      d.target = Math.min(7, Math.max(1, n));
      el.querySelector('.stepper__value').textContent = d.target;
      refreshSummary();
    };
    q('[data-dec]')?.addEventListener('click', () => setTarget(d.target - 1));
    q('[data-inc]')?.addEventListener('click', () => setTarget(d.target + 1));

    q('#goal-start')?.addEventListener('change', (e) => {
      d.start = e.target.value;
      refreshSummary();
    });
    el.querySelectorAll('input[name="span"]').forEach((r) =>
      r.addEventListener('change', () => {
        d.hasEnd = r.value === 'end';
        draw({ focus: d.hasEnd ? '#goal-end' : `input[name="span"][value="ongoing"]` });
      }),
    );
    q('#goal-end')?.addEventListener('change', (e) => {
      d.end = e.target.value;
      refreshSummary();
    });
    el.querySelectorAll('input[name="grace"]').forEach((r) =>
      r.addEventListener('change', () => {
        d.grace = Number(r.value);
        refreshSummary();
      }),
    );
    q('#goal-tz')?.addEventListener('change', (e) => {
      d.tz = e.target.value;
    });

    q('#goal-remind')?.addEventListener('change', (e) => {
      d.remind = e.target.checked;
      if (d.remind && !d.times.length) d.times = [...DEFAULT_REMINDER_TIMES];
      draw({ focus: '#goal-remind' });
    });
    q('#goal-grace-remind')?.addEventListener('change', (e) => {
      d.graceRemind = e.target.checked;
    });
    el.querySelectorAll('[data-time]').forEach((inp) =>
      inp.addEventListener('change', () => {
        d.times[Number(inp.dataset.time)] = inp.value;
        refreshSummary();
      }),
    );
    el.querySelectorAll('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        d.times.splice(Number(b.dataset.remove), 1);
        draw({ focus: d.times.length ? '[data-time]' : '[data-add]' });
      }),
    );
    q('[data-add]')?.addEventListener('click', () => {
      const used = new Set(d.times);
      const next = ['12:00', '15:00', '20:00', '08:00'].find((t) => !used.has(t)) || '12:00';
      d.times.push(next);
      draw({ focus: `[data-time="${d.times.length - 1}"]` });
    });

    q('[data-back]')?.addEventListener('click', () => {
      step -= 1;
      draw({ focus: 'form' });
    });
    q('[data-cancel]')?.addEventListener('click', () => onCancel?.());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = validate(step);
      if (err) return showError(err);
      if (step < STEPS.length - 1) {
        step += 1;
        draw();
        el.querySelector('input:not([disabled]), select, button')?.focus();
        el.closest('.sheet__panel')?.scrollTo({ top: 0 });
        return;
      }
      for (let i = 0; i < STEPS.length; i++) {
        const e2 = validate(i);
        if (e2) {
          step = i;
          draw();
          return showError(e2);
        }
      }
      const restore = busy(q('[data-save]'), editing ? 'Saving…' : 'Creating…');
      const version = {
        days_of_week: d.mode === 'days' ? d.days : [],
        weekly_target: d.target,
        grace_hours: d.grace,
        timezone: d.tz,
        reminders_enabled: d.remind,
        reminder_times: d.remind ? [...new Set(d.times)].sort() : [],
        grace_reminder: d.graceRemind,
      };
      const goalBody = { name: d.name.trim(), end_date: d.hasEnd ? d.end : null };
      if (!started) goalBody.start_date = d.start;
      const r = editing
        ? await goalAction({ action: 'edit', id: goal.id, goal: goalBody, version })
        : await goalAction({ action: 'create', goal: { ...goalBody, mode: d.mode }, version, makeActive: true });
      if (!r.ok) {
        restore();
        return showError(r.message || 'Could not save the goal.');
      }
      toast(editing ? 'Goal updated' : 'Goal created');
      onSaved?.(r.goal || goal);
    });
  }

  draw();
  return null;
}

function listJoin(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const hasGoals = () => getState().goals.length > 0;
