// Small DOM and copy helpers shared by the views.
import { describeSchedule } from '../core/schedule.js';
import { formatDay, weekdayLabel } from '../core/time.js';
import { icon } from './icons.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Set a button into its busy state with a new label; returns a restore function. */
export function busy(btn, label) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  if (label) btn.textContent = label;
  return () => {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-busy');
    btn.innerHTML = html;
  };
}

/** 'Fri, Sat and Sun · ongoing' style summary for a goal + version. */
export function describeGoal(goal, version) {
  if (!goal) return '';
  const d = describeSchedule(
    {
      mode: goal.mode,
      days_of_week: version?.days_of_week || [],
      weekly_target: version?.weekly_target || 1,
      start_date: goal.start_date,
      end_date: goal.end_date,
    },
    { formatDay, weekdayLabel },
  );
  const what = d.what.charAt(0).toUpperCase() + d.what.slice(1);
  return { what, span: d.span, from: d.from, line: `${what} · ${d.span}` };
}

export const STATUS = {
  active: { label: 'Active', cls: 'chip--blue', icon: 'play' },
  scheduled: { label: 'Starts soon', cls: 'chip--outline', icon: 'calendar' },
  paused: { label: 'Paused', cls: 'chip--paused', icon: 'pause' },
  completed: { label: 'Completed', cls: 'chip--complete', icon: 'check' },
  archived: { label: 'Archived', cls: 'chip--paused', icon: 'x' },
};

export function statusChip(status) {
  const s = STATUS[status] || STATUS.paused;
  return `<span class="chip ${s.cls}">${icon(s.icon)}${s.label}</span>`;
}

export const STATE_TEXT = {
  complete: 'Done',
  open: 'Due today',
  grace: 'Grace',
  missed: 'Missed',
  paused: 'Paused',
  upcoming: 'Due',
  'before-start': 'Not started',
  'after-end': 'Ended',
};

export const STATE_ICON = {
  complete: 'check',
  open: 'clock',
  grace: 'clock',
  missed: 'x',
  paused: 'pause',
  upcoming: 'calendar',
};

/** Initials for the avatar (first letter of name or email). */
export function initial(profile, user) {
  const s = (profile?.display_name || user?.email || '?').trim();
  return esc(s.charAt(0).toLocaleUpperCase('en-GB'));
}
