// Goals: list, create, edit, pause/resume, make active, delete.
import { getState, summaryFor, versionNow, goalStatus, goalAction, currentUnitFor } from '../state.js';
import { formatDay } from '../core/time.js';
import { icon } from '../ui/icons.js';
import { esc, describeGoal, statusChip, busy } from '../ui/dom.js';
import { sheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { openGoalEditor } from './goal-editor.js';

export function render(root) {
  const s = getState();
  const goals = [...s.goals].sort((a, b) => rank(a) - rank(b) || (b.created_at > a.created_at ? 1 : -1));

  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <h1>Goals</h1>
        <button type="button" class="btn btn--primary" data-new>${icon('plus')}New goal</button>
      </div>
      ${
        goals.length
          ? `<ul class="grid grid--2">${goals.map(card).join('')}</ul>`
          : `<div class="card empty">${icon('goals')}<h2>No goals yet</h2><p>Pick your posting days, or a number of posts each week.</p>
              <button type="button" class="btn btn--primary btn--lg" data-new>${icon('plus')}Create a goal</button></div>`
      }
    </div>`;

  root.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openGoalEditor({})));
  root.querySelectorAll('[data-menu]').forEach((b) =>
    b.addEventListener('click', () => openMenu(s.goals.find((g) => g.id === b.dataset.menu))),
  );
}

const rank = (g) => ({ active: 0, paused: 1, completed: 2, archived: 3 })[g.status] ?? 4;

function card(goal) {
  const v = versionNow(goal.id);
  const sum = summaryFor(goal);
  const status = goalStatus(goal);
  const desc = describeGoal(goal, v);
  const range = goal.end_date ? `${formatDay(goal.start_date, { weekday: false })} – ${formatDay(goal.end_date, { weekday: false, year: true })}` : `From ${formatDay(goal.start_date, { weekday: false })}`;
  let progress = '';
  if (sum) {
    const unit = currentUnitFor(goal);
    if (goal.mode === 'weekly' && unit && status === 'active') {
      const done = Math.min(unit.count, unit.needed);
      progress = `<div class="progress progress--mini" role="img" aria-label="${done} of ${unit.needed} this week">${Array.from({ length: unit.needed }, (_, i) => `<span class="progress__seg ${i < done ? 'is-done' : ''}"></span>`).join('')}</div>`;
    } else if (sum.completionRate != null) {
      const pct = Math.round(sum.completionRate * 100);
      progress = `<div class="bar" role="img" aria-label="${pct}% completion"><div class="bar__fill" style="--w: ${pct}%"></div></div>`;
    }
  }
  const stats = sum
    ? `${sum.current} ${sum.unit === 'weeks' ? 'week' : 'day'} streak · best ${sum.best}${sum.completionRate != null ? ` · ${Math.round(sum.completionRate * 100)}%` : ''}`
    : '';
  return `<li class="card goal-card">
      <div class="goal-card__top">
        <div>
          <h2 class="goal-card__name">${esc(goal.name)}</h2>
          <p class="small muted">${esc(desc.what)}</p>
        </div>
        <button type="button" class="btn btn--icon" data-menu="${goal.id}" aria-label="Options for ${esc(goal.name)}" aria-haspopup="dialog">${icon('more')}</button>
      </div>
      <div class="goal-card__meta">${statusChip(status)}<span>${esc(range)}</span></div>
      ${progress}
      ${stats ? `<p class="small muted tabular">${esc(stats)}</p>` : ''}
    </li>`;
}

function openMenu(goal) {
  if (!goal) return;
  const status = goalStatus(goal);
  const ended = status === 'completed';
  sheet({
    title: goal.name,
    body: (el, api) => {
      el.innerHTML = `
        <div class="nav">
          <button type="button" class="menu__item" data-act="edit">${icon('edit')}Edit</button>
          ${goal.status === 'active' && !ended ? `<button type="button" class="menu__item" data-act="pause">${icon('pause')}Pause</button>` : ''}
          ${goal.status === 'paused' && !ended ? `<button type="button" class="menu__item" data-act="resume">${icon('play')}Resume and make active</button>` : ''}
          ${goal.status !== 'active' && !ended && goal.status !== 'paused' ? `<button type="button" class="menu__item" data-act="activate">${icon('star')}Make active</button>` : ''}
          <button type="button" class="menu__item menu__item--danger" data-act="delete">${icon('trash')}Delete</button>
        </div>
        ${goal.status === 'paused' ? '<p class="field__hint mt-3">Resuming makes this your active goal and pauses any other.</p>' : ''}`;

      el.querySelectorAll('[data-act]').forEach((b) =>
        b.addEventListener('click', async () => {
          const act = b.dataset.act;
          if (act === 'edit') {
            api.close({ silent: true });
            openGoalEditor({ goal });
            return;
          }
          if (act === 'delete') {
            confirmDelete(el, api, goal);
            return;
          }
          const restore = busy(b, act === 'pause' ? 'Pausing…' : 'Resuming…');
          const r = await goalAction({ action: act, id: goal.id });
          if (!r.ok) {
            restore();
            toast(r.message || 'Something went wrong.');
            return;
          }
          api.close({ silent: true });
          toast(act === 'pause' ? 'Goal paused. Paused days never count as missed.' : 'Goal resumed');
        }),
      );
      return null;
    },
  });
}

function confirmDelete(el, api, goal) {
  api.setTitle('Delete goal');
  el.innerHTML = `
    <form class="stack" novalidate>
      <div class="notice notice--danger">${icon('alert')}<div>This deletes the goal, its schedule and its streak. Logged posts stay in your history without a goal. This can't be undone.</div></div>
      <div class="field">
        <label class="label" for="confirm-name">Type <strong>${esc(goal.name)}</strong> to confirm</label>
        <input class="input" id="confirm-name" autocomplete="off" spellcheck="false">
      </div>
      <div class="field__error" data-error hidden></div>
      <div class="sheet__foot">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="submit" class="btn btn--danger-solid" data-go disabled>${icon('trash')}Delete goal</button>
      </div>
    </form>`;
  const input = el.querySelector('#confirm-name');
  const go = el.querySelector('[data-go]');
  input.focus();
  input.addEventListener('input', () => {
    go.disabled = input.value.trim() !== goal.name;
  });
  el.querySelector('[data-cancel]').addEventListener('click', () => api.close());
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input.value.trim() !== goal.name) return;
    const restore = busy(go, 'Deleting…');
    const r = await goalAction({ action: 'delete', id: goal.id, confirmName: input.value.trim() });
    if (!r.ok) {
      restore();
      const err = el.querySelector('[data-error]');
      err.hidden = false;
      err.innerHTML = `${icon('alert')}<span>${esc(r.message || 'Could not delete the goal.')}</span>`;
      return;
    }
    api.close({ silent: true });
    toast('Goal deleted');
  });
}
