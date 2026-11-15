// Today: streak hero, this period, primary action, active goal.
import { getState, activeGoal, summaryFor, versionsOf, pausesOf, versionNow, weekStart, goalStatus, goalAction, set } from '../state.js';
import { weekStrip, currentUnit, graceLabel } from '../core/streak.js';
import { weekdayName, formatDay, daysBetween } from '../core/time.js';
import { icon } from '../ui/icons.js';
import { esc, plural, describeGoal, STATE_TEXT, STATE_ICON, reducedMotion, busy } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { openGoalEditor } from './goal-editor.js';

export function render(root, { navigate }) {
  const s = getState();
  const goal = activeGoal();

  if (!s.goals.length) {
    root.innerHTML = `
      <div class="view">
        <div class="card empty">
          ${icon('goals')}
          <h2>Set your first goal</h2>
          <p>Choose the days you want to post, or a number of posts a week. We'll keep score.</p>
          <button type="button" class="btn btn--primary btn--lg" data-new>${icon('plus')}Create a goal</button>
        </div>
      </div>`;
    root.querySelector('[data-new]').addEventListener('click', () => openGoalEditor({}));
    return;
  }

  if (!goal) {
    const paused = s.goals.filter((g) => g.status === 'paused');
    const latest = paused[paused.length - 1];
    root.innerHTML = `
      <div class="view">
        <div class="card empty">
          ${icon('pause')}
          <h2>No active goal</h2>
          <p>${latest ? `“${esc(latest.name)}” is paused. Paused days never break your streak.` : 'Your goals have ended. Start a new one to keep going.'}</p>
          ${
            latest && goalStatus(latest) !== 'completed'
              ? `<button type="button" class="btn btn--primary btn--lg" data-resume="${latest.id}">${icon('play')}Resume “${esc(latest.name)}”</button>`
              : `<button type="button" class="btn btn--primary btn--lg" data-new>${icon('plus')}New goal</button>`
          }
        </div>
      </div>`;
    root.querySelector('[data-new]')?.addEventListener('click', () => openGoalEditor({}));
    root.querySelector('[data-resume]')?.addEventListener('click', async (e) => {
      const restore = busy(e.currentTarget, 'Resuming…');
      const r = await goalAction({ action: 'resume', id: e.currentTarget.dataset.resume });
      if (!r.ok) {
        restore();
        toast(r.message || 'Could not resume the goal.');
      }
    });
    return;
  }

  const sum = summaryFor(goal);
  if (!sum) {
    root.innerHTML = `<div class="view"><span class="skeleton skeleton--card"></span></div>`;
    return;
  }
  const ws = weekStart();
  const version = versionNow(goal.id);
  const unitWord = sum.unit === 'weeks' ? 'week' : 'day';
  const rate = sum.completionRate == null ? null : Math.round(sum.completionRate * 100);
  const meta = [`Best ${sum.best}`, rate == null ? 'No results yet' : `${rate}% completion`].join(' · ');
  const scheduled = goalStatus(goal) === 'scheduled';

  root.innerHTML = `
    <div class="view">
      <section class="card hero-card col-7" aria-labelledby="streak-label">
        <span class="label" id="streak-label">Current streak</span>
        <div class="streak">
          <span class="streak__num ${sum.current > 0 ? 'is-live' : ''}" data-num>${sum.current}</span>
          <span class="streak__unit">${sum.current === 1 ? unitWord : `${unitWord}s`}</span>
          ${icon('flame', { cls: `flame ${sum.current > 0 ? '' : 'is-cold'}` })}
        </div>
        <p class="streak__meta">${meta}</p>
      </section>

      <section class="card col-5" aria-labelledby="period-title">
        <div class="card__head">
          <h2 class="card__title" id="period-title">This week</h2>
        </div>
        ${sum.mode === 'weekly' ? weeklyPeriod(sum, ws) : pills(sum, goal, ws)}
      </section>

      <div class="col-7" data-action>${scheduled ? startsSoon(goal) : primaryAction(sum, goal, ws)}</div>

      <section class="card col-5" aria-labelledby="goal-title">
        <div class="card__head">
          <span class="label" id="goal-title">Active goal</span>
          <button type="button" class="link-btn" data-edit>Edit</button>
        </div>
        <p class="goal-card__name">${esc(goal.name)}</p>
        <p class="small muted">${esc(describeGoal(goal, version).line)}</p>
      </section>
    </div>`;

  root.querySelector('[data-edit]').addEventListener('click', () => openGoalEditor({ goal }));
  root.querySelector('[data-log]')?.addEventListener('click', () => navigate('log'));

  // Count the streak up after a successful log.
  const bump = s.bump;
  if (bump) {
    set({ bump: null });
    const el = root.querySelector('[data-num]');
    if (el && !reducedMotion()) countUp(el, bump.from, bump.to);
  }
}

function countUp(el, from, to) {
  el.classList.add('bump');
  const steps = Math.max(1, Math.abs(to - from));
  const each = Math.min(120, 600 / steps);
  let n = from;
  el.textContent = String(n);
  const tick = () => {
    n += to > n ? 1 : -1;
    el.textContent = String(n);
    if (n !== to) setTimeout(tick, each);
  };
  setTimeout(tick, each);
}

function pills(sum, goal, ws) {
  const strip = weekStrip(sum, goal, versionsOf(goal.id), pausesOf(goal.id), ws);
  const items = strip
    .map((d) => {
      const state = d.required ? d.state : d.state === 'paused' ? 'paused' : null;
      const cls = !d.required && state !== 'paused' ? 'pill--off' : `pill--${state}`;
      const text = !d.required && state !== 'paused' ? 'Rest day' : stateText(d);
      const ic = d.required || state === 'paused' ? STATE_ICON[state] : null;
      const label = `${weekdayName(d.date)} ${formatDay(d.date, { weekday: false })}: ${text}`;
      return `<li class="pill ${cls} ${d.isToday ? 'is-today' : ''}" aria-label="${esc(label)}" ${d.isToday ? 'aria-current="date"' : ''}>
          <span class="pill__day" aria-hidden="true">${weekdayName(d.date, true)}</span>
          <span class="pill__date" aria-hidden="true">${Number(d.date.slice(8))}</span>
          ${ic ? icon(ic) : '<span class="icon icon--sm" aria-hidden="true"></span>'}
        </li>`;
    })
    .join('');

  // Chips for the open and grace days, so state is never colour alone.
  const chips = strip
    .filter((d) => d.required && (d.state === 'open' || d.state === 'grace'))
    .map((d) =>
      d.state === 'open'
        ? `<span class="chip chip--blue">${icon('clock')}Due today</span>`
        : `<span class="chip chip--accent">${icon('clock')}${esc(weekdayName(d.date))}: ${esc(graceLabel(d.unit))}</span>`,
    )
    .join('');

  return `<ol class="pills" aria-label="This week">${items}</ol>${chips ? `<div class="row mt-3">${chips}</div>` : ''}`;
}

function stateText(d) {
  if (d.state === 'grace') return graceLabel(d.unit);
  if (d.state === 'open' && !d.isToday) return 'Due';
  return STATE_TEXT[d.state] || 'Due';
}

function weeklyPeriod(sum, ws) {
  const unit = currentUnit(sum, ws);
  if (!unit) {
    return `<p class="muted small">This week isn't part of the goal. ${sum.units.length ? '' : 'The goal starts soon.'}</p>`;
  }
  const done = Math.min(unit.count, unit.needed);
  const left = Math.max(0, daysBetween(sum.today, unit.last) + 1);
  const segs = Array.from({ length: unit.needed }, (_, i) => `<span class="progress__seg ${i < done ? 'is-done' : ''}"></span>`).join('');
  const stateLine =
    unit.state === 'complete'
      ? `<span class="chip chip--complete">${icon('check')}Target reached</span>`
      : unit.state === 'paused'
        ? `<span class="chip chip--paused">${icon('pause')}Paused</span>`
        : `<span class="chip chip--blue">${icon('clock')}${plural(left, 'day')} left</span>`;
  return `
    <div class="row row--between mb-3">
      <span class="num">${done} of ${unit.needed} this week</span>
      ${stateLine}
    </div>
    <div class="progress" role="img" aria-label="${done} of ${unit.needed} posts logged this week">${segs}</div>`;
}

function logButton(label) {
  return `<button type="button" class="btn btn--primary btn--lg btn--block" data-log>${icon('plus')}${esc(label)}</button>`;
}

function calm(title, sub) {
  return `<div class="card card--calm">
    <div class="row">${icon('check', { size: 'lg' })}<div><p class="card__title">${esc(title)}</p>${sub ? `<p class="small muted">${esc(sub)}</p>` : ''}</div></div>
  </div>`;
}

function nextDue(sum) {
  const next = sum.units.find((u) => u.state === 'upcoming');
  if (!next) return null;
  const days = daysBetween(sum.today, next.first);
  return `Next post due ${weekdayName(next.first)} · ${days === 1 ? 'tomorrow' : `in ${days} days`}`;
}

function primaryAction(sum, goal, ws) {
  if (sum.ended) return calm('This goal has finished', 'Have a look at your history, or start a new goal.');

  if (sum.mode === 'weekly') {
    const unit = currentUnit(sum, ws);
    const grace = sum.units.find((u) => u.state === 'grace');
    if (grace) return `${logButton("Log last week's post")}<p class="small muted mt-2">${esc(graceLabel(grace))}</p>`;
    if (!unit || unit.state === 'paused') return calm('Nothing due this week', nextDue(sum));
    if (unit.state === 'complete') return calm("This week's target is done", 'Extra posts still show up in your history.') + `<div class="mt-3">${logButton('Log another post')}</div>`;
    return logButton("Log today's post");
  }

  const today = sum.units.find((u) => u.key === sum.today);
  const grace = sum.units.find((u) => u.state === 'grace');
  if (grace) {
    return `${logButton(`Log ${weekdayName(grace.first)}'s post`)}<p class="small muted mt-2">${esc(graceLabel(grace))}</p>`;
  }
  if (today?.state === 'open') return logButton("Log today's post");
  if (today?.state === 'complete') return calm("Today's post is logged", nextDue(sum) || 'Nice work. See you next time.');
  if (today?.state === 'paused') return calm('Today is paused', nextDue(sum));
  return calm('No post due today', nextDue(sum) || 'Enjoy the day off.');
}

function startsSoon(goal) {
  return calm(`Starts ${formatDay(goal.start_date)}`, 'You can log posts from the first day of the goal.');
}
